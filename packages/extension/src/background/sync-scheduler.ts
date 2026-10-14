import { accountManager } from '../core/wallet/account-manager'
import { SecureStorage } from '../core/wallet/secure-storage'
import { logger } from '@/lib/logger'
import { syncJobStore } from '@/lib/sync-job-store'
import { clearSyncAbort, signalSyncAbort } from '@/lib/sync-abort'
import {
  isRetryableWalletRpcError,
  isStaleWalletRpcError,
  isSyncBusyError
} from '@/core/zcash/wallet-core'
import { WALLET_CONFIG } from '@/config/wallet'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import type { SyncOutcome } from '../core/wallet/account-manager'
import { hasPendingZcashTxForWallet } from '../core/wallet/pending-zcash-tx'
import {
  recordRpcFailure,
  recordRpcSuccess,
  type RpcFailoverTransition
} from '@/config/rpc-failover'
import { shouldResumeInterruptedSync, shouldSchedulePassiveSync } from './passive-sync-policy'
import { getVisibleSyncReason } from './sync-status-policy'
import { isRpcEndpointError } from '@/lib/errors'
import { KeyedTaskCoordinator } from '@/lib/keyed-task-coordinator'
import type { SyncReason, SyncTrigger } from '@/types'

export type SyncStateSnapshot = {
  isSyncing: boolean
  /** True while a sync task owns the wallet, including silent catch-up. */
  isActive?: boolean
  syncProgress: number
  currentHeight?: number
  latestHeight?: number
  walletId?: string
  accountId?: string
  etaMs?: number | null
  syncReason?: SyncReason | null
}

export const SYNC_KEEPALIVE_ALARM = 'sync-keepalive'

function getWalletSyncKey(walletId?: string): string {
  return walletId || '_'
}

const ALL_WALLETS_TX_PAUSE_KEY = '*'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class SyncScheduler {
  private syncStates = new Map<string, SyncStateSnapshot>()
  private syncAbortFlags = new Map<string, boolean>()
  private cancelledPreflightWalletIds = new Set<string>()
  private activeSyncTasks = new KeyedTaskCoordinator<SyncOutcome['status']>()
  private running = false
  private pendingRetrigger = false
  private foregroundWalletId: string | null = null
  private runningWalletId: string | null = null
  private removedWalletIds = new Set<string>()
  private txPauseDepth = 0
  private txPauseTargets = new Map<string, number>()
  private pendingTriggers = new Set<SyncTrigger>()
  private queuedStartupAt: number | null = null

  constructor() {
    accountManager.onSyncProgress = data => {
      const key = getWalletSyncKey(data.walletId)
      const { balance: _balance, ...syncData } = data
      this.syncStates.set(key, {
        ...(this.syncStates.get(key) || { isSyncing: false, syncProgress: 0 }),
        ...syncData
      })
    }
  }

  isRunning(): boolean {
    return this.running
  }

  getForegroundWalletId(): string | null {
    const { currentWalletId } = useWalletStore.getState()
    return this.foregroundWalletId || currentWalletId
  }

  getSyncState(walletId?: string, accountId?: string): SyncStateSnapshot {
    const key = getWalletSyncKey(walletId)
    const cached = this.syncStates.get(key) || { isSyncing: false, syncProgress: 0 }
    const isActive = this.isWalletSyncActive(walletId)
    const persisted = walletId
      ? useAccountDataStore.getState().getWalletSyncState(accountManager.getNetwork(), walletId)
      : undefined
    const syncReason = cached.syncReason !== undefined ? cached.syncReason : persisted?.syncReason
    return {
      isSyncing: cached.isSyncing ?? false,
      isActive,
      syncProgress: cached.syncProgress ?? 0,
      currentHeight: cached.currentHeight ?? 0,
      latestHeight: cached.latestHeight ?? 0,
      etaMs: cached.etaMs ?? null,
      syncReason: getVisibleSyncReason(isActive, syncReason),
      walletId,
      accountId
    }
  }

  isWalletSyncActive(walletId?: string): boolean {
    if (!walletId) return this.running || this.activeSyncTasks.size > 0

    const key = getWalletSyncKey(walletId)
    if (this.activeSyncTasks.has(key) || this.runningWalletId === walletId) return true
    if (accountManager.isWalletSyncing(walletId)) return true

    return (
      this.running && this.runningWalletId === null && this.getForegroundWalletId() === walletId
    )
  }

  applySyncProgressMessage(message: Partial<SyncStateSnapshot> & { walletId?: string }): void {
    const key = getWalletSyncKey(message.walletId)
    const current = this.syncStates.get(key) || { isSyncing: false, syncProgress: 0 }
    this.syncStates.set(key, {
      ...current,
      ...(message.isSyncing !== undefined ? { isSyncing: message.isSyncing } : {}),
      ...(message.syncProgress !== undefined ? { syncProgress: message.syncProgress } : {}),
      ...(message.currentHeight !== undefined ? { currentHeight: message.currentHeight } : {}),
      ...(message.latestHeight !== undefined ? { latestHeight: message.latestHeight } : {}),
      ...(message.walletId !== undefined ? { walletId: message.walletId } : {}),
      ...(message.accountId !== undefined ? { accountId: message.accountId } : {}),
      ...(message.etaMs !== undefined ? { etaMs: message.etaMs } : {}),
      ...(message.syncReason !== undefined ? { syncReason: message.syncReason } : {})
    })
  }

  abortSync(walletId?: string): void {
    const foregroundWalletId = this.getForegroundWalletId()
    if (!walletId || walletId === foregroundWalletId) {
      this.pendingTriggers.clear()
      this.pendingRetrigger = false
    }
    if (walletId) {
      const key = getWalletSyncKey(walletId)
      this.syncAbortFlags.set(key, true)
      this.cancelledPreflightWalletIds.add(walletId)
      signalSyncAbort(walletId).catch(() => {})
      accountManager.finishSyncPreflight(walletId)
      logger.log('Sync abort requested', walletId)
    } else {
      if (foregroundWalletId) {
        this.cancelledPreflightWalletIds.add(foregroundWalletId)
        accountManager.finishSyncPreflight(foregroundWalletId)
      }
      for (const k of this.activeSyncTasks.keys()) {
        this.syncAbortFlags.set(k, true)
        this.cancelledPreflightWalletIds.add(k)
        signalSyncAbort(k).catch(() => {})
        accountManager.finishSyncPreflight(k)
      }
      if (this.runningWalletId) {
        const runningKey = getWalletSyncKey(this.runningWalletId)
        this.syncAbortFlags.set(runningKey, true)
        signalSyncAbort(this.runningWalletId).catch(() => {})
      }
      logger.log('Sync abort requested for all')
    }
  }

  /**
   * Quiesce a wallet before its data is purged. The scheduler owns the running
   * sync loop, so it must stop and forget the wallet before deletion — otherwise
   * a re-trigger would re-init the wallet DB and "resurrect" the deleted wallet.
   */
  async prepareWalletRemoval(walletId: string): Promise<void> {
    this.removedWalletIds.add(walletId)
    if (this.foregroundWalletId === walletId) {
      this.foregroundWalletId = null
    }
    this.abortSync(walletId)
    await this.waitForWalletSyncIdle(walletId, 15_000)
  }

  pauseForTx(walletId?: string): void {
    const key = walletId ?? ALL_WALLETS_TX_PAUSE_KEY
    this.txPauseDepth++
    this.txPauseTargets.set(key, (this.txPauseTargets.get(key) ?? 0) + 1)

    const targetSyncIsActive = walletId
      ? this.activeSyncTasks.has(getWalletSyncKey(walletId)) ||
        this.runningWalletId === walletId ||
        (this.running && this.runningWalletId === null)
      : this.running || this.activeSyncTasks.size > 0
    if (targetSyncIsActive) {
      this.pendingRetrigger = true
    }
  }

  resumeAfterTx(walletId?: string): void {
    const key = walletId ?? ALL_WALLETS_TX_PAUSE_KEY
    const targetDepth = this.txPauseTargets.get(key) ?? 0
    if (targetDepth <= 0) return

    if (targetDepth === 1) {
      this.txPauseTargets.delete(key)
    } else {
      this.txPauseTargets.set(key, targetDepth - 1)
    }
    this.txPauseDepth = Math.max(0, this.txPauseDepth - 1)
    if (this.txPauseDepth === 0 && this.pendingRetrigger) {
      this.scheduleRun()
    }
  }

  isTxPaused(walletId?: string): boolean {
    if (!walletId) return this.txPauseDepth > 0
    return (
      (this.txPauseTargets.get(ALL_WALLETS_TX_PAUSE_KEY) ?? 0) > 0 ||
      (this.txPauseTargets.get(walletId) ?? 0) > 0
    )
  }

  async waitForActiveSyncIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.activeSyncTasks.size === 0 && !this.running) return true
      await sleep(200)
    }
    logger.warn('Timed out waiting for active sync to idle before tx')
    return false
  }

  async waitForWalletSyncIdle(walletId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!this.isWalletSyncActive(walletId)) return true
      await sleep(200)
    }
    logger.warn('Timed out waiting for wallet sync to idle before tx', walletId)
    return false
  }

  onAccountSwitched(walletId: string, accountId: string): void {
    if (this.foregroundWalletId && this.foregroundWalletId !== walletId) {
      accountManager.finishSyncPreflight(this.foregroundWalletId)
    }
    for (const key of this.activeSyncTasks.keys()) {
      if (key !== getWalletSyncKey(walletId)) {
        accountManager.abortSyncForWallet(key)
      }
    }
    this.abortNonCurrentSyncs(walletId)
    this.pendingRetrigger = true
    this.foregroundWalletId = walletId
    accountManager.beginSyncPreflight(walletId, 'wallet-change')
    this.scheduleRun('wallet-change')
  }

  onRequestSync(trigger: SyncTrigger = 'requested'): void {
    const { currentWalletId } = useWalletStore.getState()
    if (currentWalletId) {
      this.foregroundWalletId = currentWalletId
    }
    this.scheduleRun(trigger)
  }

  requestPassiveSync(maxAgeMs: number): boolean {
    const { currentWalletId, currentNetwork } = useWalletStore.getState()
    if (!currentWalletId || this.removedWalletIds.has(currentWalletId)) return false

    const syncState = useAccountDataStore
      .getState()
      .getWalletSyncState(currentNetwork, currentWalletId)
    if (
      !shouldSchedulePassiveSync({
        now: Date.now(),
        lastSyncTime: syncState.lastSyncTime,
        maxAgeMs,
        isSchedulerRunning: this.running
      })
    ) {
      return false
    }

    this.foregroundWalletId = currentWalletId
    this.scheduleRun('periodic')
    return true
  }

  async resumeInterrupted(): Promise<void> {
    const network = accountManager.getNetwork()

    await chrome.runtime
      .sendMessage({ type: 'RECONCILE_WALLET_STATE', walletId: '*', all: true })
      .catch(() => {})

    const allJobs = await chrome.storage.local.get('sync_jobs')
    const jobs: Record<string, any> = allJobs['sync_jobs'] || {}
    for (const [key, job] of Object.entries(jobs)) {
      if (job.status === 'running' && job.network === network) {
        console.log(`[Background] Marking orphaned running job as interrupted: ${key}`)
        job.status = 'interrupted'
        job.updatedAt = Date.now()
      }
    }
    await chrome.storage.local.set({ sync_jobs: jobs })

    const interruptedJobs = await syncJobStore.getInterrupted(network)
    if (interruptedJobs.length === 0) return

    const { wallets } = useWalletStore.getState()
    const activeWalletIds = new Set(wallets.map(w => w.id))
    for (const job of interruptedJobs) {
      if (!activeWalletIds.has(job.walletId)) {
        await syncJobStore.remove(job.walletId, network).catch(() => {})
        logger.log(`Removed orphaned sync job for deleted wallet`, job.walletId)
      }
    }

    const remaining = (await syncJobStore.getInterrupted(network)).filter(j =>
      activeWalletIds.has(j.walletId)
    )
    if (remaining.length === 0) return

    const staleMs = 24 * 60 * 60 * 1000
    const now = Date.now()
    const activeJobs = remaining.filter(j =>
      shouldResumeInterruptedSync({
        now,
        updatedAt: j.updatedAt,
        maxAgeMs: staleMs,
        resumeOnStartup: j.resumeOnStartup
      })
    )
    if (activeJobs.length === 0) return

    const { currentWalletId } = useWalletStore.getState()
    const fgWalletId = this.foregroundWalletId || currentWalletId
    if (!fgWalletId) return

    const hasCurrentWalletInterrupted = activeJobs.some(j => j.walletId === fgWalletId)
    if (!hasCurrentWalletInterrupted) return

    this.scheduleRun('recovery')
  }

  private abortNonCurrentSyncs(currentWalletId: string): void {
    const currentKey = getWalletSyncKey(currentWalletId)
    for (const key of this.activeSyncTasks.keys()) {
      if (key !== currentKey) {
        this.syncAbortFlags.set(key, true)
        signalSyncAbort(key).catch(() => {})
        logger.log('Account switched, preempting other wallet sync', currentWalletId)
      }
    }
    if (this.runningWalletId && this.runningWalletId !== currentWalletId) {
      const runningKey = getWalletSyncKey(this.runningWalletId)
      this.syncAbortFlags.set(runningKey, true)
      signalSyncAbort(this.runningWalletId).catch(() => {})
    }
  }

  private scheduleRun(trigger?: SyncTrigger): void {
    const foregroundWalletId = this.getForegroundWalletId()
    if (trigger && trigger !== 'recovery' && foregroundWalletId) {
      this.cancelledPreflightWalletIds.delete(foregroundWalletId)
    }
    if (trigger) this.pendingTriggers.add(trigger)
    if (trigger && ['wallet-change', 'requested', 'rpc-change'].includes(trigger)) {
      this.queuedStartupAt ??= performance.now()
    }
    if (this.txPauseDepth > 0) {
      this.pendingRetrigger = true
      return
    }
    if (this.running) {
      this.pendingRetrigger = true
      return
    }
    this.run().catch(error => {
      logger.error('Sync scheduler run failed', undefined, undefined, error)
    })
  }

  private consumeTrigger(): SyncTrigger {
    const priority: SyncTrigger[] = [
      'recovery',
      'transaction',
      'wallet-change',
      'rpc-change',
      'requested',
      'periodic'
    ]
    const trigger = priority.find(candidate => this.pendingTriggers.has(candidate)) ?? 'requested'
    this.pendingTriggers.clear()
    return trigger
  }

  async run(): Promise<void> {
    if (this.running) {
      this.pendingRetrigger = true
      return
    }
    this.running = true
    chrome.alarms.create(SYNC_KEEPALIVE_ALARM, { periodInMinutes: 0.4 })
    const visiblePreflightWallets = new Map<string, number>()

    try {
      do {
        this.pendingRetrigger = false
        const trigger = this.consumeTrigger()
        const queuedStartupAt = this.queuedStartupAt
        this.queuedStartupAt = null
        const requestedWalletId =
          this.foregroundWalletId || useWalletStore.getState().currentWalletId
        if (requestedWalletId && this.cancelledPreflightWalletIds.has(requestedWalletId)) {
          continue
        }
        if (requestedWalletId && !this.removedWalletIds.has(requestedWalletId)) {
          const preflightId = accountManager.beginSyncPreflight(requestedWalletId, trigger)
          if (preflightId !== null) {
            visiblePreflightWallets.set(requestedWalletId, preflightId)
          }
          if (queuedStartupAt != null) {
            logger.log(
              `Sync scheduler wait finished in ${Math.round(performance.now() - queuedStartupAt)}ms`,
              requestedWalletId
            )
          }
        }

        await accountManager.initialize()

        if (accountManager.isLocked()) {
          const sessionPassword = await SecureStorage.getSessionPassword()
          if (sessionPassword) {
            const result = await accountManager.unlock(sessionPassword)
            if (!result.success) {
              logger.error('Sync: failed to unlock')
              return
            }
          } else if (trigger !== 'periodic') {
            return
          }
        }

        const { currentWalletId, currentAccountId, wallets } = useWalletStore.getState()
        const fgWalletId = this.foregroundWalletId || currentWalletId
        const syncTarget = fgWalletId && !this.removedWalletIds.has(fgWalletId) ? fgWalletId : null

        if (syncTarget) {
          if (
            this.cancelledPreflightWalletIds.has(syncTarget) ||
            (requestedWalletId && requestedWalletId !== syncTarget)
          ) {
            continue
          }
          const ready = await accountManager.waitForWalletReady(
            syncTarget,
            WALLET_CONFIG.SYNC.INIT_READY_TIMEOUT_MS
          )
          if (!ready) {
            logger.warn('Wallet not ready yet, scheduling sync retry', syncTarget)
            this.running = false
            chrome.alarms.clear(SYNC_KEEPALIVE_ALARM)
            setTimeout(() => this.scheduleRun('recovery'), WALLET_CONFIG.SYNC.INIT_RETRY_DELAY_MS)
            return
          }
        }

        if (syncTarget) {
          if (
            this.cancelledPreflightWalletIds.has(syncTarget) ||
            this.removedWalletIds.has(syncTarget) ||
            syncTarget !== this.getForegroundWalletId()
          ) {
            continue
          }
          // A transaction may pause this wallet while initialization is awaiting.
          // Re-check immediately before registering the sync task so no new batch
          // can slip between pauseForTx() and waitForWalletSyncIdle().
          if (this.isTxPaused(syncTarget)) {
            this.pendingRetrigger = true
            continue
          }

          const wallet = wallets.find(w => w.id === syncTarget)
          if (wallet && wallet.accounts.length > 0) {
            const accountId =
              syncTarget === currentWalletId && currentAccountId
                ? currentAccountId
                : wallet.accounts[0].id

            this.abortNonCurrentSyncs(syncTarget)
            await this.runSyncForWallet(syncTarget, accountId, trigger)
          }
        }
      } while (this.pendingRetrigger && this.txPauseDepth === 0)
    } finally {
      for (const [walletId, preflightId] of visiblePreflightWallets) {
        accountManager.finishSyncPreflight(walletId, preflightId)
      }
      this.running = false
      chrome.alarms.clear(SYNC_KEEPALIVE_ALARM)
      if (this.pendingRetrigger && this.txPauseDepth === 0) {
        this.scheduleRun()
      }
    }
  }

  async runTransactionCatchUp(walletId: string, accountId: string): Promise<SyncOutcome['status']> {
    if (this.removedWalletIds.has(walletId) || accountManager.isLocked()) {
      return 'skipped'
    }
    return this.runSyncForWallet(walletId, accountId, 'transaction')
  }

  private runSyncForWallet(
    walletId: string,
    accountId: string,
    trigger: SyncTrigger
  ): Promise<SyncOutcome['status']> {
    const key = getWalletSyncKey(walletId)
    return this.activeSyncTasks.run(key, async () => {
      this.syncAbortFlags.set(key, false)
      await clearSyncAbort(walletId).catch(() => {})
      return this.executeSync(walletId, accountId, trigger)
    })
  }

  private async executeSync(
    walletId: string,
    accountId: string,
    trigger: SyncTrigger
  ): Promise<SyncOutcome['status']> {
    this.runningWalletId = walletId
    const preflightId = accountManager.beginSyncPreflight(walletId, trigger)
    const measureStartup = ['wallet-change', 'requested', 'rpc-change'].includes(trigger)
    const readinessStartedAt = performance.now()
    try {
      const hasRestoredAccount = await accountManager.ensureWalletReadyForSync(
        walletId,
        accountId,
        trigger === 'wallet-change'
      )
      if (measureStartup) {
        logger.log(
          `Sync account readiness ${hasRestoredAccount ? 'ready' : 'unavailable'} in ${Math.round(performance.now() - readinessStartedAt)}ms`,
          walletId,
          accountId
        )
      }
      if (!hasRestoredAccount) {
        logger.warn('Sync skipped: persisted wallet account is unavailable', walletId, accountId)
        return 'skipped'
      }

      const workerStartedAt = performance.now()
      const ready = await accountManager.waitForWalletReady(
        walletId,
        WALLET_CONFIG.SYNC.INIT_READY_TIMEOUT_MS
      )
      if (measureStartup) {
        logger.log(
          `Sync worker readiness ${ready ? 'ready' : 'unavailable'} in ${Math.round(performance.now() - workerStartedAt)}ms`,
          walletId,
          accountId
        )
      }
      if (!ready) {
        logger.warn('Sync skipped: wallet WASM not ready', walletId, accountId)
        return 'skipped'
      }

      const syncKey = getWalletSyncKey(walletId)
      const pendingOnChainTx = await hasPendingZcashTxForWallet(walletId)
      const syncResult = await accountManager.syncBlocks(
        () => this.syncAbortFlags.get(syncKey) === true || this.isTxPaused(walletId),
        walletId,
        accountId,
        {
          force: true,
          priority: trigger === 'periodic' ? 'background' : 'foreground',
          waitForTipAdvance: pendingOnChainTx,
          trigger,
          ...(trigger === 'periodic'
            ? { maxDurationMs: WALLET_CONFIG.SYNC.BACKGROUND_SYNC_BUDGET_MS }
            : {})
        }
      )

      if (syncResult.status === 'completed' || syncResult.status === 'partial') {
        const { currentWalletId } = useWalletStore.getState()
        const fgWalletId = this.foregroundWalletId || currentWalletId
        if (walletId === fgWalletId) {
          await accountManager.refreshBalances(walletId, true).catch(() => {})
          await accountManager.refreshWalletTransactionHistoriesFromWasm(walletId).catch(() => {})
        }
      }

      await this.handleRpcEndpointHealth(syncResult)

      return syncResult.status
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (isRetryableWalletRpcError(msg)) {
        const reason = isSyncBusyError(msg)
          ? 'sync busy'
          : isStaleWalletRpcError(msg)
            ? 'stale wallet RPC'
            : 'wallet dirty'
        logger.warn(`Sync skipped: ${reason}`, walletId, accountId, error)
        return 'skipped'
      }
      if (isRpcEndpointError(error)) {
        logger.warn(
          'Sync RPC endpoint failed before returning an outcome',
          walletId,
          accountId,
          error
        )
        await this.handleRpcEndpointHealth({
          status: 'failed',
          error: msg,
          reason: 'network_error',
          rpcFailureCount: 1
        })
        return 'failed'
      }
      logger.error('Sync failed before returning an outcome', walletId, accountId, error)
      return 'failed'
    } finally {
      if (preflightId !== null) accountManager.finishSyncPreflight(walletId, preflightId)
      if (this.runningWalletId === walletId) {
        this.runningWalletId = null
      }
    }
  }

  private async handleRpcEndpointHealth(syncResult: SyncOutcome): Promise<void> {
    if (accountManager.getNetwork() !== 'mainnet') return

    const isNetworkFailure =
      (syncResult.status === 'failed' || syncResult.status === 'partial') &&
      syncResult.reason === 'network_error' &&
      (syncResult.rpcFailureCount ?? 0) > 0
    const isNetworkSuccess =
      syncResult.status === 'completed' ||
      (syncResult.status === 'partial' && syncResult.reason !== 'network_error')

    if (!isNetworkFailure && !isNetworkSuccess) return

    const transition = isNetworkFailure ? await recordRpcFailure() : await recordRpcSuccess()
    if (!transition) return

    await this.applyRpcEndpointTransition(transition)
  }

  async failoverRpcEndpoint(error: unknown): Promise<boolean> {
    if (accountManager.getNetwork() !== 'mainnet' || !isRpcEndpointError(error)) return false

    const transition = await recordRpcFailure()
    if (!transition) return false

    return this.applyRpcEndpointTransition(transition)
  }

  private async applyRpcEndpointTransition(transition: RpcFailoverTransition): Promise<boolean> {
    logger.warn(
      `[RPC FAILOVER] ${transition.reason}: ${transition.fromEndpointId} -> ${transition.toEndpointId}`
    )
    try {
      await accountManager.applyAutomaticRpcEndpointChange(transition.reason)
      this.pendingRetrigger = true
      return true
    } catch (error) {
      logger.error(
        `[RPC FAILOVER] ${transition.reason} runtime reload failed`,
        undefined,
        undefined,
        error
      )
      return false
    }
  }
}

export const syncScheduler = new SyncScheduler()
