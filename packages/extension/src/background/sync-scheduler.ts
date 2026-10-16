import { isZcashHardwareKeySource } from '@/core/wallet/hardware-wallet-data'
import { backgroundZcashWalletRuntime } from './zcash-wallet-runtime'
import { credentialSession } from './credential-session'
import { logger } from '@/lib/logger'
import { syncJobStore } from '@/lib/sync-job-store'
import { getWalletPersistenceQuarantine } from '@/lib/indexed-db'
import { clearSyncAbort, signalSyncAbort } from '@/lib/sync-abort'
import { isRetryableWalletRpcError } from '@/core/zcash/wallet-core'
import { WALLET_CONFIG } from '@/config/wallet'
import { prepareWalletStoreForUse, useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import type { SyncOutcome } from './zcash-wallet-runtime'
import { hasPendingZcashTxForWallet } from '../core/wallet/pending-zcash-tx'
import { recordRpcFailure, recordRpcSuccess } from '@/infrastructure/chains/rpc-failover'
import { shouldSchedulePassiveSync } from './passive-sync-policy'
import { isRpcEndpointError } from '@/lib/errors'
import type { ZcashBalance } from '@/types'

export type SyncStateSnapshot = {
  isSyncing: boolean
  syncProgress: number
  currentHeight?: number
  latestHeight?: number
  walletId?: string
  accountId?: string
  etaMs?: number | null
  balance?: ZcashBalance | null
}

export const SYNC_KEEPALIVE_ALARM = 'sync-keepalive'

function getWalletSyncKey(walletId?: string): string {
  return walletId || '_'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class SyncScheduler {
  private syncStates = new Map<string, SyncStateSnapshot>()
  private syncAbortFlags = new Map<string, boolean>()
  private cancelledPreflightWalletIds = new Set<string>()
  private preflightWalletIds = new Set<string>()
  private activeSyncPromises = new Map<string, Promise<void>>()
  private running = false
  private pendingRetrigger = false
  private foregroundWalletId: string | null = null
  private runningWalletId: string | null = null
  private removedWalletIds = new Set<string>()
  private txPauseDepth = 0

  constructor() {
    backgroundZcashWalletRuntime.onSyncRequested = () => this.onRequestSync()
    backgroundZcashWalletRuntime.onSyncAbortRequested = walletId => this.abortSync(walletId)
    backgroundZcashWalletRuntime.onSyncProgress = data => {
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
    const { currentWalletId, currentAccountId } = useWalletStore.getState()
    const targetWalletId = walletId ?? currentWalletId
    const targetAccountId = accountId ?? currentAccountId
    const key = getWalletSyncKey(targetWalletId ?? undefined)
    const cached = this.syncStates.get(key) || { isSyncing: false, syncProgress: 0 }
    return {
      isSyncing: cached.isSyncing ?? false,
      syncProgress: cached.syncProgress ?? 0,
      currentHeight: cached.currentHeight ?? 0,
      latestHeight: cached.latestHeight ?? 0,
      etaMs: cached.etaMs ?? null,
      walletId: targetWalletId ?? undefined,
      accountId: targetAccountId ?? undefined,
      ...(targetWalletId && targetAccountId
        ? {
            balance: useAccountDataStore
              .getState()
              .getBalance(
                backgroundZcashWalletRuntime.getNetwork(),
                targetWalletId,
                targetAccountId
              )
          }
        : {})
    }
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
      ...(message.etaMs !== undefined ? { etaMs: message.etaMs } : {})
    })
  }

  abortSync(walletId?: string): void {
    const foregroundWalletId = this.getForegroundWalletId()
    if (!walletId || walletId === foregroundWalletId) {
      this.pendingRetrigger = false
      if (foregroundWalletId) {
        this.cancelledPreflightWalletIds.add(foregroundWalletId)
        backgroundZcashWalletRuntime.finishSyncPreflight(foregroundWalletId)
      }
    }
    if (walletId) {
      const key = getWalletSyncKey(walletId)
      this.syncAbortFlags.set(key, true)
      this.cancelledPreflightWalletIds.add(walletId)
      backgroundZcashWalletRuntime.finishSyncPreflight(walletId)
      signalSyncAbort(walletId).catch(() => {})
      logger.log(`Sync abort requested for ${key}`, walletId)
    } else {
      for (const k of this.activeSyncPromises.keys()) {
        this.syncAbortFlags.set(k, true)
        this.cancelledPreflightWalletIds.add(k)
        backgroundZcashWalletRuntime.finishSyncPreflight(k)
        signalSyncAbort(k).catch(() => {})
      }
      if (this.runningWalletId) {
        const runningKey = getWalletSyncKey(this.runningWalletId)
        this.syncAbortFlags.set(runningKey, true)
        this.cancelledPreflightWalletIds.add(this.runningWalletId)
        backgroundZcashWalletRuntime.finishSyncPreflight(this.runningWalletId)
        signalSyncAbort(this.runningWalletId).catch(() => {})
      }
      logger.log('Sync abort requested for all')
    }
  }

  abortAllSyncsForTx(): void {
    this.abortSync()
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
    if (!(await this.waitForWalletSyncIdle(walletId, 15_000))) {
      throw new Error('Wallet sync did not stop before removal')
    }
  }

  async prepareMetadataOnlyWalletRemoval(walletId: string): Promise<void> {
    this.removedWalletIds.add(walletId)
    if (this.foregroundWalletId === walletId) {
      this.foregroundWalletId = null
    }
    this.abortSync(walletId)
    if (!(await this.waitForWalletSyncIdle(walletId, 15_000))) {
      throw new Error('Wallet sync did not stop before removal')
    }
  }

  async cancelWalletRemoval(walletId: string): Promise<void> {
    this.removedWalletIds.delete(walletId)
    this.syncAbortFlags.delete(getWalletSyncKey(walletId))
    await clearSyncAbort(walletId).catch(() => {})
  }

  async prepareAccountRemoval(walletId: string): Promise<void> {
    this.abortSync(walletId)
    const [schedulerIdle, walletIdle] = await Promise.all([
      this.waitForActiveSyncIdle(15_000),
      this.waitForWalletSyncIdle(walletId, 15_000)
    ])
    if (!schedulerIdle || !walletIdle) {
      throw new Error('Wallet sync did not stop before account removal')
    }
  }

  pauseForTx(): void {
    this.txPauseDepth++
  }

  resumeAfterTx(): void {
    if (this.txPauseDepth > 0) {
      this.txPauseDepth--
    }
    if (this.txPauseDepth === 0 && this.pendingRetrigger) {
      this.scheduleRun()
    }
  }

  isTxPaused(): boolean {
    return this.txPauseDepth > 0
  }

  async waitForActiveSyncIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.activeSyncPromises.size === 0 && !this.running) return true
      await sleep(200)
    }
    logger.warn('Timed out waiting for active sync to idle before tx')
    return false
  }

  async waitForWalletSyncIdle(walletId: string, timeoutMs: number): Promise<boolean> {
    const key = getWalletSyncKey(walletId)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const schedulerActive = this.activeSyncPromises.has(key)
      const accountSyncing = backgroundZcashWalletRuntime.isWalletSyncing(walletId)
      if (!schedulerActive && !accountSyncing) return true
      await sleep(200)
    }
    logger.warn('Timed out waiting for wallet sync to idle before tx', walletId)
    return false
  }

  async quiesceWalletForMutation(
    walletId: string,
    timeoutMs = WALLET_CONFIG.SYNC.MAX_BLOCKING_WAIT_MS
  ): Promise<boolean> {
    this.abortSync(walletId)
    await signalSyncAbort(walletId).catch(() => {})
    return this.waitForWalletSyncIdle(walletId, timeoutMs)
  }

  onAccountSwitched(walletId: string): void {
    if (this.foregroundWalletId && this.foregroundWalletId !== walletId) {
      backgroundZcashWalletRuntime.finishSyncPreflight(this.foregroundWalletId)
    }
    this.cancelledPreflightWalletIds.delete(walletId)
    for (const key of this.activeSyncPromises.keys()) {
      if (key !== getWalletSyncKey(walletId)) {
        backgroundZcashWalletRuntime.abortSyncForWallet(key)
      }
    }
    this.abortNonCurrentSyncs(walletId)
    this.pendingRetrigger = true
    this.foregroundWalletId = walletId
    backgroundZcashWalletRuntime.notifySyncStarting(walletId)
    this.preflightWalletIds.add(walletId)
    this.scheduleRun()
  }

  onZcashAccountUnavailable(): void {
    this.abortSync()
    this.foregroundWalletId = null
    this.pendingRetrigger = false
  }

  onRequestSync(): void {
    const { currentWalletId } = useWalletStore.getState()
    if (currentWalletId) {
      this.foregroundWalletId = currentWalletId
      this.cancelledPreflightWalletIds.delete(currentWalletId)
    }
    this.scheduleRun()
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
    this.scheduleRun()
    return true
  }

  async resumeInterrupted(): Promise<void> {
    const network = backgroundZcashWalletRuntime.getNetwork()

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
    const activeJobs = remaining.filter(j => Date.now() - j.updatedAt < staleMs)
    if (activeJobs.length === 0) return

    const { currentWalletId } = useWalletStore.getState()
    const fgWalletId = this.foregroundWalletId || currentWalletId
    if (!fgWalletId) return

    const hasCurrentWalletInterrupted = activeJobs.some(j => j.walletId === fgWalletId)
    if (!hasCurrentWalletInterrupted) return

    this.scheduleRun()
  }

  private abortNonCurrentSyncs(currentWalletId: string): void {
    const currentKey = getWalletSyncKey(currentWalletId)
    for (const key of this.activeSyncPromises.keys()) {
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

  private scheduleRun(): void {
    if (this.txPauseDepth > 0) {
      this.pendingRetrigger = true
      return
    }
    if (this.running) {
      this.pendingRetrigger = true
      return
    }
    this.run().catch(err => {
      console.warn('[SyncScheduler] run failed:', err)
    })
  }

  private yieldToTxPause(): boolean {
    if (this.txPauseDepth === 0) return false
    this.pendingRetrigger = true
    return true
  }

  private async blockQuarantinedSync(walletId: string): Promise<boolean> {
    const network = backgroundZcashWalletRuntime.getNetwork()
    const quarantine = await getWalletPersistenceQuarantine(`${network}_${walletId}`)
    if (!quarantine?.snapshotQuarantined && !quarantine?.journalQuarantined) return false

    backgroundZcashWalletRuntime.finishSyncPreflight(walletId)
    this.preflightWalletIds.delete(walletId)
    this.syncStates.set(getWalletSyncKey(walletId), {
      ...(this.syncStates.get(getWalletSyncKey(walletId)) || { syncProgress: 0 }),
      isSyncing: false,
      syncProgress: 0,
      etaMs: null
    })
    useAccountDataStore.getState().setWalletSyncStateFor(network, walletId, {
      isSyncing: false,
      syncProgress: 0,
      etaMs: null,
      syncReason: 'wallet_state_error'
    })
    chrome.runtime
      .sendMessage({
        type: 'SYNC_PROGRESS',
        walletId,
        isSyncing: false,
        syncProgress: 0,
        etaMs: null,
        syncReason: 'wallet_state_error'
      })
      .catch(() => {})
    return true
  }

  async run(): Promise<void> {
    if (this.running) {
      this.pendingRetrigger = true
      return
    }
    this.running = true
    chrome.alarms.create(SYNC_KEEPALIVE_ALARM, { periodInMinutes: 0.4 })

    try {
      do {
        if (this.yieldToTxPause()) return
        this.pendingRetrigger = false

        await prepareWalletStoreForUse()
        const { currentWalletId: scheduledWalletId } = useWalletStore.getState()
        if (
          scheduledWalletId &&
          !this.removedWalletIds.has(scheduledWalletId) &&
          (await this.blockQuarantinedSync(scheduledWalletId))
        ) {
          continue
        }

        await backgroundZcashWalletRuntime.initialize()
        if (this.yieldToTxPause()) return

        if (!(await credentialSession.hasUnlockSession())) {
          if (!backgroundZcashWalletRuntime.isLocked()) await backgroundZcashWalletRuntime.lock()
          return
        }
        if (backgroundZcashWalletRuntime.isLocked()) {
          const { currentWalletId, currentAccountId } = useWalletStore.getState()
          if (currentWalletId && (await this.blockQuarantinedSync(currentWalletId))) continue
          const wallet = currentWalletId
            ? useWalletStore.getState().getWallet(currentWalletId)
            : null
          if (
            !currentWalletId ||
            isZcashHardwareKeySource(wallet?.keySource) ||
            !(await credentialSession.bindZcashCredential(currentWalletId)) ||
            !(await backgroundZcashWalletRuntime.restoreFromCredentialSession(
              currentWalletId,
              currentAccountId || undefined
            ))
          ) {
            logger.error('Sync: failed to restore the credential session')
            return
          }
        }
        if (this.yieldToTxPause()) return

        const { currentWalletId, currentAccountId, wallets } = useWalletStore.getState()
        const fgWalletId = this.foregroundWalletId || currentWalletId
        const syncTarget = fgWalletId && !this.removedWalletIds.has(fgWalletId) ? fgWalletId : null

        if (syncTarget && this.cancelledPreflightWalletIds.has(syncTarget)) continue

        if (syncTarget) {
          const ready = await backgroundZcashWalletRuntime.waitForWalletReady(
            syncTarget,
            WALLET_CONFIG.SYNC.INIT_READY_TIMEOUT_MS
          )
          if (!ready) {
            logger.warn('Wallet not ready yet, scheduling sync retry', syncTarget)
            this.running = false
            chrome.alarms.clear(SYNC_KEEPALIVE_ALARM)
            setTimeout(() => this.scheduleRun(), WALLET_CONFIG.SYNC.INIT_RETRY_DELAY_MS)
            return
          }
        }
        if (this.yieldToTxPause()) return

        if (syncTarget) {
          if (
            this.cancelledPreflightWalletIds.has(syncTarget) ||
            syncTarget !== this.getForegroundWalletId()
          ) {
            continue
          }
          if (await this.blockQuarantinedSync(syncTarget)) continue
          const wallet = wallets.find(w => w.id === syncTarget)
          if (wallet && wallet.accounts.length > 0) {
            const accountId =
              syncTarget === currentWalletId && currentAccountId
                ? currentAccountId
                : wallet.accounts[0].id

            this.abortNonCurrentSyncs(syncTarget)
            logger.log(`Sync foreground: ${logger.getWalletLabel(syncTarget)}`)
            await this.runSyncForWallet(syncTarget, accountId)
          }
        }
      } while (this.pendingRetrigger)
    } finally {
      for (const walletId of this.preflightWalletIds) {
        backgroundZcashWalletRuntime.finishSyncPreflight(walletId)
      }
      this.preflightWalletIds.clear()
      this.running = false
      chrome.alarms.clear(SYNC_KEEPALIVE_ALARM)
    }
  }

  private async runSyncForWallet(walletId: string, accountId: string): Promise<void> {
    const key = getWalletSyncKey(walletId)
    if (this.activeSyncPromises.has(key)) {
      await this.activeSyncPromises.get(key)
      return
    }

    this.syncAbortFlags.set(key, false)
    clearSyncAbort(walletId).catch(() => {})
    const promise = this.executeSync(walletId, accountId)
      .then(() => undefined)
      .finally(() => {
        this.activeSyncPromises.delete(key)
      })

    this.activeSyncPromises.set(key, promise)
    await promise
  }

  private async executeSync(walletId: string, accountId: string): Promise<SyncOutcome['status']> {
    this.runningWalletId = walletId
    try {
      await backgroundZcashWalletRuntime.ensureWalletReadyForSync(
        walletId,
        accountId,
        this.preflightWalletIds.has(walletId)
      )

      const ready = await backgroundZcashWalletRuntime.waitForWalletReady(
        walletId,
        WALLET_CONFIG.SYNC.INIT_READY_TIMEOUT_MS
      )
      if (!ready) {
        logger.warn('Sync skipped: wallet WASM not ready', walletId, accountId)
        return 'skipped'
      }

      const syncKey = getWalletSyncKey(walletId)
      const pendingOnChainTx = await hasPendingZcashTxForWallet(walletId)
      const syncResult = await backgroundZcashWalletRuntime.syncBlocks(
        () => this.syncAbortFlags.get(syncKey) === true,
        walletId,
        accountId,
        {
          force: true,
          priority: 'foreground',
          waitForTipAdvance: pendingOnChainTx
        }
      )

      if (syncResult.status === 'completed' || syncResult.status === 'partial') {
        const { currentWalletId } = useWalletStore.getState()
        const fgWalletId = this.foregroundWalletId || currentWalletId
        if (walletId === fgWalletId) {
          await backgroundZcashWalletRuntime.refreshBalances(walletId, true).catch(() => {})
          await backgroundZcashWalletRuntime
            .refreshWalletTransactionHistoriesFromWasm(walletId)
            .catch(() => {})
        }
      }

      await this.handleRpcEndpointHealth(syncResult)

      return syncResult.status
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (isRetryableWalletRpcError(msg)) {
        logger.warn(`Sync skipped (retryable): ${msg}`, walletId, accountId)
        return 'skipped'
      }
      if (isRpcEndpointError(error)) {
        logger.warn(`Sync RPC failed before returning an outcome: ${msg}`, walletId, accountId)
        await this.handleRpcEndpointHealth({
          status: 'failed',
          error: msg,
          reason: 'network_error',
          rpcFailureCount: 1
        })
        return 'failed'
      }
      logger.error(`Sync failed:`, walletId, accountId)
      return 'failed'
    } finally {
      if (this.runningWalletId === walletId) {
        this.runningWalletId = null
      }
    }
  }

  private async handleRpcEndpointHealth(syncResult: SyncOutcome): Promise<void> {
    if (backgroundZcashWalletRuntime.getNetwork() !== 'mainnet') return

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

    logger.warn(
      `[RPC FAILOVER] ${transition.reason}: ${transition.fromEndpointId} -> ${transition.toEndpointId}`
    )
    try {
      await backgroundZcashWalletRuntime.applyAutomaticRpcEndpointChange(transition.reason)
      this.pendingRetrigger = true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`[RPC FAILOVER] runtime reload failed: ${message}`)
    }
  }
}

export const syncScheduler = new SyncScheduler()
