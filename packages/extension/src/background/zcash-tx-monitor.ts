import { transactionRecorder } from './transaction-recorder'
import { WALLET_CONFIG, WASM_SELECTION_CONFIRMATIONS } from '@/config/wallet'
import { getNetworkConfig } from '@/config/networks'
import { lookupTransaction, getBlockCount, type TxLookup } from '@/lib/zcash-node-rpc'
import {
  decideMonitorSignal,
  isExpiredAtTip,
  shouldRefreshSpendability,
  type MonitorAction
} from './tx-monitor-policy'
import { DEFAULT_EXPIRY_DELTA_BLOCKS } from '@/config/fee'
import {
  finalizeTxCatchUp,
  markWalletNeedsCatchUp,
  parseAccountKey,
  runScheduledTxCatchUp
} from './tx-sync'
import { accountManager } from '@/core/wallet/account-manager'
import { isWalletSettlementComplete } from '@/lib/wallet-settlement'
import { loadTransactions } from '@/lib/indexed-db'
import type { TransactionStatusUpdatedMessage } from '@/types/transaction-messages'
import { getRequiredConfirmations, type ZcashConfirmation } from '@/lib/transaction-status'
import type { TransactionType } from '@/types'
import { isIntentsSettledTransaction } from '@/lib/cross-chain-transaction'
import { getZcashConfirmationNotificationCopy } from '@/lib/transaction-status-copy'
import { scheduleSpendabilityCatchUp } from '@/lib/spendability-catch-up'
import { logger } from '@/lib/logger'

export interface PendingZcashTx {
  txHash: string
  accountKey: string
  transactionId: string
  amount?: string
  type?: TransactionType
  startTime: number
  expiryHeight?: number
  settlementPending?: boolean
  requiredScanHeight?: number
  /** A durable catch-up job has been persisted once funds reach the spendability threshold. */
  spendabilityCatchUpScheduled?: boolean
  notificationPending?: boolean
}

/**
 * Best-effort expiry height for a freshly-sent tx: chain tip + ZIP-317 expiry
 * delta. Returns undefined when the tip is unavailable, so the monitor falls
 * back to the wall-clock timeout instead of mis-declaring expiry.
 */
export async function computeExpiryHeight(
  getTip: () => Promise<number>
): Promise<number | undefined> {
  try {
    return (await getTip()) + DEFAULT_EXPIRY_DELTA_BLOCKS
  } catch {
    return undefined
  }
}

const STORAGE_KEY = 'pending_zcash_transactions'
const ALARM_NAME = 'zcash-tx-monitor-alarm'
const TAG = '[ZcashTxMonitor]'

const { TX_MONITOR_POLL_MS, TIMEOUT_MS, EXPIRY_BUFFER_BLOCKS } = WALLET_CONFIG.ZCASH_TX_MONITOR

const POLL_DELAY_MIN = TX_MONITOR_POLL_MS / 60000

export class ZcashTxMonitor {
  private pendingTxs: Map<string, PendingZcashTx> = new Map()
  private finalizing = new Set<string>()
  private storageWrite: Promise<void> = Promise.resolve()

  async init() {
    await this.loadFromStorage()
    this.scheduleNextCheck()
  }

  /** Restores persisted transactions that need an on-chain check. */
  async restoreStuckWithdrawals(accountKeys: string[]): Promise<void> {
    await this.storageWrite
    const alreadyMonitored = new Set(this.pendingTxs.keys())
    let added = 0

    for (const accountKey of accountKeys) {
      try {
        const txs = await loadTransactions(accountKey)
        for (const tx of txs) {
          if (
            !tx.id.startsWith('wasm_') &&
            (tx.type === 'send' ||
              tx.type === 'shield' ||
              tx.type === 'supply' ||
              tx.type === 'swap' ||
              (tx.type === 'receive' && tx.status === 'failed')) &&
            (tx.status === 'pending' ||
              tx.status === 'confirming' ||
              (tx.status === 'failed' &&
                (tx.type === 'send' || tx.type === 'shield' || tx.type === 'receive'))) &&
            tx.txHash?.trim() &&
            !alreadyMonitored.has(tx.txHash)
          ) {
            this.pendingTxs.set(tx.txHash, {
              txHash: tx.txHash,
              accountKey,
              transactionId: tx.id,
              amount: tx.amount,
              type: tx.type,
              startTime: tx.timestamp,
              expiryHeight: tx.expiryHeight
            })
            alreadyMonitored.add(tx.txHash)
            added++
          }
          if (
            (tx.type === 'withdraw' || tx.type === 'claim' || tx.type === 'swap') &&
            (tx.status === 'relay_confirmed' || tx.status === 'confirming') &&
            tx.destinationTxHash &&
            !alreadyMonitored.has(tx.destinationTxHash)
          ) {
            const entry: PendingZcashTx = {
              txHash: tx.destinationTxHash,
              accountKey,
              transactionId: tx.id,
              amount: tx.amount,
              type: tx.type === 'swap' ? 'receive' : tx.type,
              startTime: Date.now()
            }
            this.pendingTxs.set(tx.destinationTxHash, entry)
            alreadyMonitored.add(tx.destinationTxHash)
            added++
          }
        }
      } catch {
        // Skip keys whose IDB data is unavailable
      }
    }

    if (added > 0) {
      try {
        await this.saveToStorage()
      } finally {
        this.scheduleNextCheck()
      }
      console.log(TAG, `Restored ${added} transaction monitor(s)`)
    }
  }

  async addTransaction(
    tx: Omit<PendingZcashTx, 'startTime'>,
    options?: { checkImmediately?: boolean }
  ) {
    const entry: PendingZcashTx = { ...tx, startTime: Date.now() }
    this.pendingTxs.set(tx.txHash, entry)
    try {
      await this.saveToStorage()
    } finally {
      this.scheduleNextCheck()
    }
    logger.log(`${TAG} Added transaction for monitoring`)
    console.log(TAG, 'Added tx for monitoring:', tx.txHash)

    if (options?.checkImmediately) {
      await this.checkTx(entry)
    }
  }

  async handleAlarm() {
    await this.loadFromStorage()
    if (this.pendingTxs.size === 0) {
      chrome.alarms.clear(ALARM_NAME)
      return
    }
    await this.runCheck()
    this.scheduleNextCheck()
  }

  async recheckNow() {
    await this.loadFromStorage()
    if (this.pendingTxs.size === 0) return
    await this.runCheck()
  }

  async hasPendingTransactions(): Promise<boolean> {
    await this.loadFromStorage()
    return this.pendingTxs.size > 0
  }

  private scheduleNextCheck() {
    if (this.pendingTxs.size === 0) {
      chrome.alarms.clear(ALARM_NAME)
      return
    }
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: POLL_DELAY_MIN })
  }

  private async runCheck() {
    const promises = Array.from(this.pendingTxs.values()).map(tx => this.checkTx(tx))
    await Promise.allSettled(promises)
  }

  private async loadFromStorage() {
    const read = this.storageWrite.then(async () => {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result[STORAGE_KEY]) {
        const txs: PendingZcashTx[] = result[STORAGE_KEY]
        txs.forEach(tx => this.pendingTxs.set(tx.txHash, tx))
      }
    })
    this.storageWrite = read.catch(() => {})
    await read
  }

  private async saveToStorage(change?: () => void, rollback?: () => void) {
    const write = this.storageWrite.then(async () => {
      change?.()
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: Array.from(this.pendingTxs.values()) })
      } catch (error) {
        rollback?.()
        throw error
      }
    })
    this.storageWrite = write.catch(() => {})
    await write
  }

  // ── Single tx check ──────────────────────────────────────────

  private async checkTx(tx: PendingZcashTx) {
    try {
      const records = await loadTransactions(tx.accountKey)
      const record = records.find(candidate => candidate.id === tx.transactionId)
      if (!record) return
      if (record.status === 'failed') {
        const recordHash = record.txHash?.trim().toLowerCase()
        const recoverable =
          !record.id.startsWith('wasm_') &&
          (record.type === 'send' || record.type === 'shield' || record.type === 'receive') &&
          (tx.type == null || record.type === tx.type) &&
          (!recordHash || recordHash === tx.txHash.trim().toLowerCase())
        if (recoverable) {
          const rpcUrl = this.rpcUrlFor(tx)
          const lookup = rpcUrl
            ? await lookupTransaction(rpcUrl, tx.txHash)
            : ({ status: 'error' } as const)
          if (lookup.status === 'confirmed') {
            if (lookup.confirmations >= getRequiredConfirmations(record.type)) {
              await this.finalizeTx(
                tx,
                'success',
                'confirmed',
                lookup.confirmations,
                undefined,
                true,
                {
                  txHash: tx.txHash,
                  confirmations: lookup.confirmations
                }
              )
            }
            return
          }
        }
        if (tx.notificationPending) {
          await this.finalizeTx(
            tx,
            'failed',
            record.failureReason ?? 'timeout',
            record.confirmations,
            undefined,
            true
          )
          return
        }
        await this.removePersistedTask(tx)
        return
      }
      if (
        record.status === 'success' &&
        (tx.notificationPending || !isIntentsSettledTransaction(tx.type))
      ) {
        await this.finalizeTx(tx, record.status, 'confirmed', record.confirmations, undefined, true)
        return
      }
      const rpcUrl = this.rpcUrlFor(tx)
      const lookup: TxLookup = rpcUrl
        ? await lookupTransaction(rpcUrl, tx.txHash)
        : { status: 'error' }

      let expired = false
      if (rpcUrl && lookup.status === 'notfound' && tx.expiryHeight != null) {
        const tip = await getBlockCount(rpcUrl)
        expired = isExpiredAtTip(tip, tx.expiryHeight, EXPIRY_BUFFER_BLOCKS)
      }

      const elapsedMs = Date.now() - tx.startTime
      const confirmedInDb = elapsedMs > TIMEOUT_MS ? await this.isAlreadyConfirmedInDB(tx) : false

      const requiredConfirmations = getRequiredConfirmations(tx.type ?? 'send')
      const action = decideMonitorSignal({
        lookup,
        minConfirmations: requiredConfirmations,
        expired,
        elapsedMs,
        timeoutMs: TIMEOUT_MS,
        hasNode: !!rpcUrl,
        confirmedInDb
      })

      await this.applyMonitorAction(tx, action, lookup, rpcUrl)
    } catch (error) {
      console.error(TAG, `Check failed for ${tx.txHash}:`, error)
    }
  }

  private async applyMonitorAction(
    tx: PendingZcashTx,
    action: MonitorAction,
    lookup: TxLookup,
    rpcUrl?: string
  ) {
    switch (action) {
      case 'confirm':
        console.info(TAG, 'Tx confirmed on-chain:', tx.txHash)
        if (isIntentsSettledTransaction(tx.type)) {
          await this.finalizeIntentsOriginTx(
            tx,
            lookup.status === 'confirmed' ? lookup.confirmations : undefined
          )
          return
        }
        const requiredScanHeight =
          tx.requiredScanHeight ??
          (rpcUrl ? ((await getBlockCount(rpcUrl)) ?? undefined) : undefined)
        await this.finalizeTx(
          tx,
          'success',
          'confirmed',
          lookup.status === 'confirmed' ? lookup.confirmations : undefined,
          requiredScanHeight,
          false,
          lookup.status === 'confirmed'
            ? { txHash: tx.txHash, confirmations: lookup.confirmations }
            : undefined
        )
        return
      case 'expire':
        console.warn(TAG, 'Tx expired past expiry height, marking failed:', tx.txHash)
        await this.finalizeTx(tx, 'failed', 'expired')
        return
      case 'timeout':
        if (lookup.status === 'confirmed' && lookup.confirmations > 0) {
          console.log(
            TAG,
            'Tx mined but immature, extending timeout:',
            tx.txHash,
            lookup.confirmations
          )
          return
        }
        console.warn(TAG, 'Tx timed out:', tx.txHash)
        await this.finalizeTx(tx, 'failed', 'timeout')
        return
      case 'clear':
        console.log(TAG, 'Tx already confirmed in DB, removing from monitor:', tx.txHash)
        await this.removePersistedTask(tx)
        return
      case 'wait':
        if (lookup.status === 'confirmed' && lookup.confirmations > 0) {
          await this.refreshSpendability(tx, lookup.confirmations)
          if (isIntentsSettledTransaction(tx.type)) {
            await this.updateIntentsOriginConfirmations(tx, lookup.confirmations)
          } else {
            await this.updateConfirmingStatus(tx, lookup.confirmations)
          }
        }
        return
    }
  }

  private rpcUrlFor(tx: PendingZcashTx): string | undefined {
    // accountKey format: `${network}_${walletId}_${accountId}`
    const network = tx.accountKey.startsWith('testnet') ? 'testnet' : 'mainnet'
    return getNetworkConfig(network).nodeRpcUrl || undefined
  }

  private async isAlreadyConfirmedInDB(tx: PendingZcashTx): Promise<boolean> {
    try {
      const txs = await loadTransactions(tx.accountKey)
      const record = txs.find(t => t.id === tx.transactionId)
      return record?.status === 'success'
    } catch {
      return false
    }
  }

  /**
   * Supply and swap are not complete when their Zcash deposit transaction is
   * confirmed. Keep the activity non-terminal until Intents reports SUCCESS,
   * FAILED, or REFUNDED.
   */
  private async finalizeIntentsOriginTx(tx: PendingZcashTx, confirmations?: number) {
    const records = await loadTransactions(tx.accountKey)
    if (!records.some(record => record.id === tx.transactionId)) return
    const requiredConfirmations = getRequiredConfirmations(tx.type ?? 'send')
    await transactionRecorder.updateTransaction(tx.accountKey, tx.transactionId, {
      status: 'pending',
      notified: false,
      ...(confirmations != null ? { confirmations, requiredConfirmations } : {})
    })
    const persisted = await loadTransactions(tx.accountKey)
    if (!persisted.some(record => record.id === tx.transactionId)) return
    await this.removePersistedTask(tx)

    void finalizeTxCatchUp(tx.accountKey).catch(err => {
      console.error(TAG, 'Post-confirm catch-up failed:', err)
    })
  }

  private async updateConfirmingStatus(tx: PendingZcashTx, confirmations: number) {
    try {
      const txs = await loadTransactions(tx.accountKey)
      const record = txs.find(t => t.id === tx.transactionId)
      if (!record || record.status === 'success' || record.status === 'failed') return
      if (
        record.status === 'confirming' ||
        record.status === 'relay_confirmed' ||
        record.status === 'pending'
      ) {
        const required = getRequiredConfirmations(tx.type ?? 'send')
        if (
          record.status === 'confirming' &&
          record.confirmations === confirmations &&
          record.requiredConfirmations === required
        ) {
          return
        }
        await transactionRecorder.updateTransaction(tx.accountKey, tx.transactionId, {
          status: 'confirming',
          confirmations,
          requiredConfirmations: required
        })
        console.log(TAG, `Tx ${tx.txHash} confirming (${confirmations}/${required})`)
      }
    } catch (error) {
      console.error(TAG, 'Failed to update confirming status:', error)
    }
  }

  private async updateIntentsOriginConfirmations(tx: PendingZcashTx, confirmations: number) {
    const requiredConfirmations = getRequiredConfirmations(tx.type ?? 'send')
    await transactionRecorder.updateTransaction(tx.accountKey, tx.transactionId, {
      status: 'pending',
      confirmations,
      requiredConfirmations
    })
  }

  private async refreshSpendability(tx: PendingZcashTx, confirmations: number): Promise<void> {
    if (
      !shouldRefreshSpendability(
        confirmations,
        WASM_SELECTION_CONFIRMATIONS,
        tx.spendabilityCatchUpScheduled
      )
    ) {
      return
    }

    try {
      const parsed = parseAccountKey(tx.accountKey)
      if (!parsed) return
      await scheduleSpendabilityCatchUp(
        () => markWalletNeedsCatchUp(parsed.walletId, parsed.accountId),
        async () => {
          tx.spendabilityCatchUpScheduled = true
          this.pendingTxs.set(tx.txHash, tx)
          await this.saveToStorage()
        },
        () => runScheduledTxCatchUp(tx.accountKey)
      )
    } catch (error) {
      console.error(TAG, 'Spendability balance refresh failed:', error)
      tx.spendabilityCatchUpScheduled = false
      this.pendingTxs.set(tx.txHash, tx)
    }
  }

  // ── Finalize (success / failed) ──────────────────────────────

  private async finalizeTx(
    tx: PendingZcashTx,
    status: 'success' | 'failed',
    reason: 'confirmed' | 'expired' | 'timeout' = status === 'success' ? 'confirmed' : 'timeout',
    confirmations?: number,
    requiredScanHeight?: number,
    alreadyTerminal = false,
    confirmation?: ZcashConfirmation
  ) {
    if (this.finalizing.has(tx.txHash)) return
    this.finalizing.add(tx.txHash)
    try {
      if (status === 'success' && !tx.notificationPending && !alreadyTerminal) {
        if (!tx.settlementPending) {
          tx.settlementPending = true
          tx.requiredScanHeight = requiredScanHeight
          this.pendingTxs.set(tx.txHash, tx)
          await this.saveToStorage()
        }

        const caughtUp = await finalizeTxCatchUp(tx.accountKey)
        const parsed = parseAccountKey(tx.accountKey)
        const scannedHeight = parsed ? accountManager.getWalletScannedHeight(parsed.walletId) : 0
        if (!isWalletSettlementComplete(caughtUp, scannedHeight, tx.requiredScanHeight)) {
          console.log(TAG, 'Confirmed tx is waiting for wallet settlement:', {
            txHash: tx.txHash,
            scannedHeight,
            requiredScanHeight: tx.requiredScanHeight
          })
          return
        }
      }

      const { found, shouldNotify, statusMatches } = await this.updateIndexedDB(
        tx,
        status,
        reason,
        confirmations,
        confirmation
      )
      if (!found) return
      if (!statusMatches) {
        await this.removePersistedTask(tx)
        return
      }
      if (shouldNotify && !tx.notificationPending) {
        await this.saveToStorage(
          () => {
            tx.notificationPending = true
            this.pendingTxs.set(tx.txHash, tx)
          },
          () => {
            tx.notificationPending = false
          }
        )
      }
      let canNotify = !shouldNotify
      if (shouldNotify) {
        const notification = await transactionRecorder.markTerminalNotified(
          tx.accountKey,
          tx.transactionId,
          status
        )
        if (!notification.found) return
        canNotify = notification.newlyNotified
      }
      await this.removePersistedTask(tx)
      if (tx.notificationPending && canNotify) {
        this.notifyFrontend(tx, status, reason)
        this.showNotification(tx, status, reason)
      }
    } finally {
      this.finalizing.delete(tx.txHash)
    }
  }

  private async removePersistedTask(tx: PendingZcashTx) {
    await this.saveToStorage(
      () => {
        this.pendingTxs.delete(tx.txHash)
      },
      () => {
        this.pendingTxs.set(tx.txHash, tx)
      }
    )
  }

  private async updateIndexedDB(
    tx: PendingZcashTx,
    status: 'success' | 'failed',
    reason: 'confirmed' | 'expired' | 'timeout',
    confirmations?: number,
    confirmation?: ZcashConfirmation
  ): Promise<{ found: boolean; shouldNotify: boolean; statusMatches: boolean }> {
    const requiredConfirmations = getRequiredConfirmations(tx.type ?? 'send')
    return transactionRecorder.updateTerminalTransaction(
      tx.accountKey,
      tx.transactionId,
      {
        status,
        txHash: tx.txHash,
        ...(status === 'success' && confirmations != null
          ? { confirmations, requiredConfirmations }
          : {}),
        ...(status === 'failed' && reason !== 'confirmed' ? { failureReason: reason } : {})
      },
      confirmation
    )
  }

  private notifyFrontend(
    tx: PendingZcashTx,
    status: 'success' | 'failed',
    reason: 'confirmed' | 'expired' | 'timeout'
  ) {
    const failureReason = status === 'failed' && reason !== 'confirmed' ? reason : undefined
    const message: TransactionStatusUpdatedMessage = {
      type: 'TRANSACTION_STATUS_UPDATED',
      accountKey: tx.accountKey,
      transactionId: tx.transactionId,
      status,
      ...(failureReason ? { failureReason } : {})
    }

    chrome.runtime.sendMessage(message).catch(() => {})
  }

  private showNotification(
    tx: PendingZcashTx,
    status: 'success' | 'failed',
    reason: 'confirmed' | 'expired' | 'timeout'
  ) {
    const copy = getZcashConfirmationNotificationCopy(tx.type, status, reason)

    try {
      chrome.notifications.create(`zcash-confirm-${tx.txHash.slice(0, 8)}-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: copy.title,
        message: copy.message,
        priority: 1
      })
    } catch (error) {
      console.error(TAG, 'Notification error:', error)
    }
  }
}

export const zcashTxMonitor = new ZcashTxMonitor()
