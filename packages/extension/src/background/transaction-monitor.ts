import { fetchSwapStatus, type SwapStatus } from '@/core/services/intents-api'
import { transactionRecorder } from './transaction-recorder'
import { zcashTxMonitor } from './zcash-tx-monitor'
import { formatChainName } from '@/lib/format'
import { loadTransactions } from '@/lib/indexed-db'
import { safeBig } from '@/lib/big'
import { ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics'
import {
  getCrossChainCompletionStatus,
  isZcashDestination,
  needsRelayStatusRecovery
} from '@/lib/cross-chain-transaction'
import type { QuoteBinding, Transaction } from '@/types'
import {
  applyIntentsProgressStatus,
  INTENTS_PROGRESS_STORAGE_KEY,
  getZcashDestinationCatchUpThreshold,
  INTENTS_PROGRESS_STALE_MS,
  isIntentsProgressStale,
  isTerminalIntentsStatus,
  needsZcashDestinationConfirmations,
  normalizeIntentsProgressEntry,
  registerIntentsProgress,
  shouldAutoRefreshIntentsProgress,
  type IntentsProgressEntry,
  type IntentsProgressInput
} from '@/lib/intents-progress'
import { getIntentsStatusCopy } from '@/lib/transaction-status-copy'
import { logger } from '@/lib/logger'
import { getNetworkConfig } from '@/config/networks'
import { getBlockCount, lookupTransaction } from '@/lib/zcash-node-rpc'
import { getRequiredConfirmations } from '@/lib/transaction-status'
import { accountManager } from '@/core/wallet/account-manager'
import { markWalletNeedsCatchUp, parseAccountKey, runScheduledTxCatchUp } from './tx-sync'

export type PendingTransaction = IntentsProgressEntry

const STORAGE_KEY = INTENTS_PROGRESS_STORAGE_KEY

const ALARM_NAME = 'transaction-monitor-alarm'
const POLL_DELAY_MIN = 0.5 // Chrome production minimum: 30 seconds

export class TransactionMonitor {
  private pendingTransactions: Map<string, PendingTransaction> = new Map()
  private refreshes = new Map<string, Promise<IntentsProgressEntry>>()
  private loadPromise: Promise<void> | null = null

  async init() {
    await this.ensureLoaded()
    this.scheduleNextCheck()
  }

  async addTransaction(tx: IntentsProgressInput) {
    await this.ensureLoaded()
    const entry = registerIntentsProgress(tx, this.pendingTransactions.get(tx.depositAddress))
    this.pendingTransactions.set(tx.depositAddress, entry)
    await this.saveToStorage()
    this.scheduleNextCheck()
    this.notifyProgressUpdated(entry.accountKey)
  }

  async removeTransaction(depositAddress: string) {
    await this.ensureLoaded()
    const entry = this.pendingTransactions.get(depositAddress)
    if (entry?.kind === 'swap') return
    if (!entry || !this.pendingTransactions.delete(depositAddress)) return
    await this.saveToStorage()
    this.scheduleNextCheck()
    this.notifyProgressUpdated(entry.accountKey)
  }

  async getProgress(accountKey: string): Promise<IntentsProgressEntry[]> {
    await this.ensureLoaded()
    return Array.from(this.pendingTransactions.values())
      .filter(entry => entry.accountKey === accountKey)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async refreshProgress(accountKey: string, depositAddress: string): Promise<IntentsProgressEntry> {
    await this.ensureLoaded()
    const entry = this.pendingTransactions.get(depositAddress)
    if (!entry || entry.kind !== 'swap' || entry.accountKey !== accountKey) {
      throw new Error('Swap progress entry not found')
    }

    return this.refreshTransaction(entry, true)
  }

  async removeProgressForAccounts(accountKeys: string[]): Promise<void> {
    await this.ensureLoaded()
    const keys = new Set(accountKeys)
    let changed = false
    for (const [depositAddress, entry] of this.pendingTransactions) {
      if (keys.has(entry.accountKey)) {
        this.pendingTransactions.delete(depositAddress)
        changed = true
      }
    }
    if (changed) await this.saveToStorage()
    this.scheduleNextCheck()
  }

  async clearProgress(): Promise<void> {
    await this.ensureLoaded()
    this.pendingTransactions.clear()
    await this.saveToStorage()
    this.scheduleNextCheck()
  }

  async restorePendingWithdrawals(accountKeys: string[]): Promise<void> {
    await this.ensureLoaded()
    const alreadyMonitored = new Set(this.pendingTransactions.keys())
    let added = 0

    for (const accountKey of accountKeys) {
      try {
        const transactions = await loadTransactions(accountKey)
        for (const transaction of transactions) {
          const depositAddress = transaction.depositAddress
          if (
            !needsRelayStatusRecovery(transaction) ||
            !depositAddress ||
            Date.now() - transaction.timestamp >= INTENTS_PROGRESS_STALE_MS ||
            alreadyMonitored.has(depositAddress)
          ) {
            continue
          }

          const restored = registerIntentsProgress(
            {
              depositAddress,
              tokenInSymbol: 'ZEC',
              tokenOutSymbol: 'ZEC',
              amountIn: transaction.amount,
              amountOut: transaction.amount,
              kind: transaction.type === 'claim' ? 'claim' : 'withdraw',
              actionName: transaction.type === 'claim' ? 'Claim' : 'Withdraw',
              accountKey,
              transactionId: transaction.id,
              originChain: 'near',
              destinationChain: 'zec'
            },
            this.pendingTransactions.get(depositAddress),
            transaction.timestamp
          )
          this.pendingTransactions.set(depositAddress, restored)
          alreadyMonitored.add(depositAddress)
          added++
        }
      } catch {
        // Skip account keys whose transaction store is unavailable.
      }
    }

    if (added > 0) {
      await this.saveToStorage()
      this.scheduleNextCheck()
      console.log('[TransactionMonitor]', `Restored ${added} pending withdraw monitor(s)`)
    }
  }

  async restoreSwapProgress(accountKeys: string[]): Promise<void> {
    await this.ensureLoaded()
    const alreadyMonitored = new Set(this.pendingTransactions.keys())
    let added = 0

    for (const accountKey of accountKeys) {
      try {
        const transactions = await loadTransactions(accountKey)
        for (const transaction of transactions) {
          if (transaction.type !== 'swap' || !transaction.txHash) continue
          const depositAddress =
            transaction.depositAddress || transaction.quoteBinding?.depositAddress
          if (!depositAddress || alreadyMonitored.has(depositAddress)) continue

          const symbols = transaction.memo?.match(/^Swap\s+(\S+)\s+→\s+(\S+)/)
          const status =
            transaction.status === 'success'
              ? 'SUCCESS'
              : transaction.status === 'failed'
                ? 'FAILED'
                : 'KNOWN_DEPOSIT_TX'
          const restored = registerIntentsProgress(
            {
              kind: 'swap',
              direction: 'from_zcash',
              depositAddress,
              tokenInSymbol: symbols?.[1] || 'ZEC',
              tokenOutSymbol: symbols?.[2] || 'Asset',
              amountIn: transaction.amount,
              amountOut: transaction.quoteBinding?.minAmountOut || '0',
              actionName: 'Swap',
              accountKey,
              transactionId: transaction.id,
              originChain: 'zec',
              originAsset: transaction.quoteBinding?.originAsset,
              destinationAsset: transaction.quoteBinding?.destinationAsset,
              quoteExpiresAt: transaction.quoteBinding?.deadline
            },
            undefined,
            transaction.timestamp
          )
          this.pendingTransactions.set(depositAddress, {
            ...restored,
            status,
            hasLeftPendingDeposit: true,
            completionHandledAt: isTerminalIntentsStatus(status) ? transaction.timestamp : undefined
          })
          alreadyMonitored.add(depositAddress)
          added++
        }
      } catch {
        // Skip account keys whose transaction store is unavailable.
      }
    }

    if (added > 0) {
      await this.saveToStorage()
      this.scheduleNextCheck()
      console.log('[TransactionMonitor]', `Restored ${added} swap progress record(s)`)
    }
  }

  async recheckNow() {
    await this.ensureLoaded()
    if (!this.hasAutoRefreshableTransactions()) return
    await this.runCheck()
  }

  async hasPendingTransactions(): Promise<boolean> {
    await this.ensureLoaded()
    return this.hasAutoRefreshableTransactions()
  }

  async handleAlarm() {
    await this.ensureLoaded()
    if (!this.hasAutoRefreshableTransactions()) {
      chrome.alarms.clear(ALARM_NAME)
      return
    }
    await this.runCheck()
    this.scheduleNextCheck()
  }

  private scheduleNextCheck() {
    if (!this.hasAutoRefreshableTransactions()) {
      chrome.alarms.clear(ALARM_NAME)
      return
    }
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: POLL_DELAY_MIN })
  }

  private async runCheck() {
    for (const tx of Array.from(this.pendingTransactions.values()).filter(entry =>
      shouldAutoRefreshIntentsProgress(entry)
    )) {
      await this.refreshTransaction(tx, false)
    }
  }

  private refreshTransaction(
    entry: PendingTransaction,
    manual: boolean
  ): Promise<IntentsProgressEntry> {
    const refreshKey = `${entry.accountKey}:${entry.depositAddress}`
    const existing = this.refreshes.get(refreshKey)
    if (existing) return existing

    const refresh = this.checkTransactionStatus(entry, { manual }).finally(() => {
      this.refreshes.delete(refreshKey)
    })
    this.refreshes.set(refreshKey, refresh)
    return refresh
  }

  private hasAutoRefreshableTransactions(): boolean {
    return Array.from(this.pendingTransactions.values()).some(entry =>
      shouldAutoRefreshIntentsProgress(entry)
    )
  }

  private ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromStorage()
    }
    return this.loadPromise
  }

  private async loadFromStorage() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      this.pendingTransactions.clear()
      let migrated = false
      if (Array.isArray(result[STORAGE_KEY])) {
        for (const value of result[STORAGE_KEY]) {
          const entry = normalizeIntentsProgressEntry(value)
          if (entry) {
            this.pendingTransactions.set(entry.depositAddress, entry)
            if (
              typeof value !== 'object' ||
              value === null ||
              typeof (value as Record<string, unknown>).createdAt !== 'number' ||
              typeof (value as Record<string, unknown>).lastStatusChangeAt !== 'number' ||
              typeof (value as Record<string, unknown>).lastCheckedAt !== 'number' ||
              typeof (value as Record<string, unknown>).kind !== 'string'
            ) {
              migrated = true
            }
          }
        }
      }
      if (migrated) await this.saveToStorage()
    } catch (error) {
      console.error('[TransactionMonitor] Failed to load pending transactions:', error)
    }
  }

  private async saveToStorage() {
    try {
      const txs = Array.from(this.pendingTransactions.values())
      await chrome.storage.local.set({ [STORAGE_KEY]: txs })
    } catch (error) {
      console.error('[TransactionMonitor] Failed to save pending transactions:', error)
      throw error
    }
  }

  private async checkTransactionStatus(
    tx: PendingTransaction,
    options: { manual?: boolean } = {}
  ): Promise<IntentsProgressEntry> {
    try {
      if (needsZcashDestinationConfirmations(tx)) {
        return await this.checkZcashDestinationConfirmations(tx)
      }

      // NOTE: Intents API is still used for Supply and Swap cross-chain mechanics
      const status = await fetchSwapStatus(tx.depositAddress)
      const current = this.pendingTransactions.get(tx.depositAddress)
      if (!current || current.accountKey !== tx.accountKey) {
        if (options.manual) throw new Error('Swap progress entry no longer exists')
        return tx
      }

      if (!status) {
        const checked = { ...current, lastCheckedAt: Date.now() }
        this.pendingTransactions.set(current.depositAddress, checked)
        await this.saveToStorage()
        if (current.kind !== 'swap' && isIntentsProgressStale(checked)) {
          await this.handleStale(checked)
        }
        if (options.manual) throw new Error('No current status is available for this swap')
        return checked
      }

      const updated = applyIntentsProgressStatus(current, status)
      this.pendingTransactions.set(current.depositAddress, updated)
      await this.saveToStorage()
      this.notifyProgressUpdated(current.accountKey)

      if (isTerminalIntentsStatus(updated.status)) {
        const effectiveStatus =
          updated.status === status.status ? status : { ...status, status: updated.status }
        await this.handleCompletion(updated, effectiveStatus)
      } else if (updated.kind !== 'swap' && isIntentsProgressStale(updated)) {
        await this.handleStale(updated)
      }
      return this.pendingTransactions.get(current.depositAddress) || updated
    } catch (error) {
      console.error(`[TransactionMonitor] Failed to check status for ${tx.depositAddress}:`, error)
      if (options.manual) throw error
      return this.pendingTransactions.get(tx.depositAddress) || tx
    }
  }

  private async checkZcashDestinationConfirmations(
    tx: PendingTransaction
  ): Promise<IntentsProgressEntry> {
    const current = this.pendingTransactions.get(tx.depositAddress)
    if (!current || current.accountKey !== tx.accountKey) return tx
    if (!needsZcashDestinationConfirmations(current)) return current

    const txHash = current.destinationChainTxHashes?.[0]?.hash
    if (!txHash) return current

    const network = current.accountKey.startsWith('testnet_') ? 'testnet' : 'mainnet'
    const rpcUrl = getNetworkConfig(network).nodeRpcUrl
    if (!rpcUrl) return current

    const lookup = await lookupTransaction(rpcUrl, txHash)
    const observedConfirmations =
      lookup.status === 'confirmed' ? lookup.confirmations : lookup.status === 'mempool' ? 0 : null
    const requiredConfirmations = getRequiredConfirmations('receive')
    const confirmations =
      observedConfirmations == null
        ? current.destinationConfirmations
        : Math.max(current.destinationConfirmations ?? 0, observedConfirmations)
    const updated: IntentsProgressEntry = {
      ...current,
      lastCheckedAt: Date.now(),
      destinationRequiredConfirmations: requiredConfirmations,
      ...(confirmations != null ? { destinationConfirmations: confirmations } : {})
    }

    this.pendingTransactions.set(current.depositAddress, updated)
    await this.saveToStorage()
    this.notifyProgressUpdated(current.accountKey)
    if (observedConfirmations != null && observedConfirmations > 0) {
      await this.scheduleZcashDestinationCatchUp(updated, rpcUrl)
    }
    return this.pendingTransactions.get(current.depositAddress) || updated
  }

  private async scheduleZcashDestinationCatchUp(entry: IntentsProgressEntry, rpcUrl: string) {
    const threshold = getZcashDestinationCatchUpThreshold(
      entry.destinationConfirmations ?? 0,
      entry.destinationRequiredConfirmations
    )
    if (threshold <= (entry.destinationCatchUpConfirmations ?? 0)) return
    const account = parseAccountKey(entry.accountKey)
    if (!account) return
    const requiredHeight = await getBlockCount(rpcUrl)
    if (requiredHeight == null) return

    const needsScan = accountManager.getWalletScannedHeight(account.walletId) < requiredHeight
    if (needsScan) {
      await markWalletNeedsCatchUp(account.walletId, account.accountId)
    } else {
      const refreshed = await accountManager.refreshTransactionHistoryFromWasm(
        account.walletId,
        account.accountId
      )
      if (!refreshed) return
    }

    const current = this.pendingTransactions.get(entry.depositAddress)
    if (!current || current.accountKey !== entry.accountKey) return
    const scheduled = { ...current, destinationCatchUpConfirmations: threshold }
    this.pendingTransactions.set(entry.depositAddress, scheduled)
    try {
      await this.saveToStorage()
    } catch (error) {
      this.pendingTransactions.set(entry.depositAddress, current)
      throw error
    }
    if (needsScan) {
      void runScheduledTxCatchUp(entry.accountKey).catch(() => {
        logger.warn(
          'Destination wallet catch-up could not start',
          account.walletId,
          account.accountId
        )
      })
    }
  }

  private async handleCompletion(pendingTx: PendingTransaction, status: SwapStatus) {
    if (pendingTx.completionHandledAt) return

    logger.log(`[TransactionMonitor] Handling completion (${status.status})`)
    console.log('[TransactionMonitor] Handling completion:', {
      depositAddress: pendingTx.depositAddress,
      accountKey: pendingTx.accountKey,
      transactionId: pendingTx.transactionId,
      status: status.status
    })

    const originChain = pendingTx.originChain || 'zcash'
    const destinationChain = pendingTx.destinationChain || ''

    const newChainHashes: { hash: string; chain: string }[] = []
    status.swapDetails?.originChainTxHashes?.forEach(tx => {
      newChainHashes.push({ hash: tx.hash, chain: formatChainName(originChain) })
    })
    status.swapDetails?.destinationChainTxHashes?.forEach(tx => {
      newChainHashes.push({ hash: tx.hash, chain: formatChainName(destinationChain) })
    })

    const accountKey = pendingTx.accountKey
    const transactionId = pendingTx.transactionId
    let tx: Transaction | undefined

    try {
      if (transactionId) {
        const txs = await loadTransactions(accountKey)
        tx = txs.find(item => item.id === transactionId)
        if (!tx) console.warn('[TransactionMonitor] Transaction not found:', transactionId)
      }

      if (tx && transactionId) {
        const chainHashes = [...(tx.chainHashes || []), ...newChainHashes].filter(
          (entry, index, entries) =>
            entries.findIndex(
              candidate => candidate.hash === entry.hash && candidate.chain === entry.chain
            ) === index
        )

        console.log('[TransactionMonitor] Updating transaction:', {
          id: transactionId,
          type: tx.type
        })

        let updates: Partial<Transaction> = {}
        if (status.status === 'SUCCESS') {
          const bindingFailed =
            !!tx.quoteBinding && !this.isStatusBoundToQuote(tx.quoteBinding, status)
          if (bindingFailed) {
            console.warn(
              '[TransactionMonitor] Quote binding below estimate but relay succeeded',
              transactionId
            )
          }

          const realAmount = status.swapDetails?.amountOutFormatted
          const shouldUpdateAmount = (tx.type === 'withdraw' || tx.type === 'claim') && realAmount

          const destHashes = status.swapDetails?.destinationChainTxHashes
          const zecHash = destHashes?.[0]?.hash

          const completionStatus = getCrossChainCompletionStatus(tx.type, {
            destinationAsset: status.destinationAsset,
            destinationChain: pendingTx.destinationChain
          })
          updates = {
            status: completionStatus,
            ...(shouldUpdateAmount ? { amount: realAmount } : {}),
            ...(zecHash ? { destinationTxHash: zecHash } : {}),
            notified: completionStatus === 'success',
            chainHashes
          }

          // A Zcash destination is not final until its transaction hash is available.
          if (completionStatus === 'relay_confirmed' && !zecHash) {
            console.log(
              '[TransactionMonitor] Relay SUCCESS but no dest hash yet, will keep polling',
              transactionId
            )
            await transactionRecorder.updateTransaction(accountKey, transactionId, updates)
            return
          }
        } else if (status.status === 'FAILED') {
          updates = { status: 'failed' as const, notified: true, chainHashes }
        } else if (status.status === 'REFUNDED') {
          updates = {
            status: 'failed' as const,
            memo: 'Refunded',
            notified: true,
            chainHashes
          }
        }

        await transactionRecorder.updateTransaction(accountKey, transactionId, updates)
        if (status.status === 'SUCCESS') {
          await this.registerZcashDestinationMonitor(tx, pendingTx, status)
        }
        console.log('[TransactionMonitor] Transaction updated:', { transactionId, updates })
      }

      const destinationHash = status.swapDetails?.destinationChainTxHashes?.[0]?.hash
      const waitsForDestinationHash =
        status.status === 'SUCCESS' &&
        isZcashDestination({
          destinationAsset: status.destinationAsset,
          destinationChain: pendingTx.destinationChain
        }) &&
        !destinationHash
      if (waitsForDestinationHash) {
        return
      }
    } catch (error) {
      console.error('[TransactionMonitor] Failed to update transaction:', error)
      return
    }

    const currentEntry = this.pendingTransactions.get(pendingTx.depositAddress) ?? pendingTx
    const completedEntry = { ...pendingTx, completionHandledAt: Date.now() }
    if (pendingTx.kind === 'swap') {
      this.pendingTransactions.set(pendingTx.depositAddress, completedEntry)
    } else {
      this.pendingTransactions.delete(pendingTx.depositAddress)
    }
    try {
      await this.saveToStorage()
    } catch (error) {
      this.pendingTransactions.set(pendingTx.depositAddress, currentEntry)
      this.scheduleNextCheck()
      throw error
    }
    this.notifyProgressUpdated(pendingTx.accountKey)

    if (needsZcashDestinationConfirmations(completedEntry)) {
      await this.checkZcashDestinationConfirmations(completedEntry)
    }

    trackEvent(ANALYTICS_EVENTS.SWAP_COMPLETED, {
      hasTransaction: transactionId ? 1 : 0,
      inputAmount: pendingTx.amountIn,
      inputSymbol: pendingTx.tokenInSymbol,
      outputAmount: status.swapDetails?.amountOutFormatted || pendingTx.amountOut,
      outputSymbol: pendingTx.tokenOutSymbol,
      usdAmount: pendingTx.usdAmount,
      extra: {
        status: status.status,
        action: pendingTx.actionName || 'Swap',
        deposit_address: pendingTx.depositAddress
      }
    })

    this.notifyCompletion(pendingTx, status)

    const actionName = pendingTx.actionName || 'Transaction'
    const waitsForZcashConfirmations =
      status.status === 'SUCCESS' &&
      getCrossChainCompletionStatus('swap', {
        destinationAsset: status.destinationAsset,
        destinationChain: pendingTx.destinationChain
      }) === 'relay_confirmed'
    const statusCopy = getIntentsStatusCopy(status.status, {
      actionName,
      hasDestinationTxHash: !!status.swapDetails?.destinationChainTxHashes?.[0]?.hash,
      waitsForZcashConfirmations
    })
    if (!statusCopy.notification) return

    try {
      chrome.notifications.create(
        `tx-${pendingTx.depositAddress}-${Date.now()}`,
        {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: statusCopy.notification.title,
          message: statusCopy.notification.message,
          priority: 1
        },
        notificationId => {
          if (chrome.runtime.lastError) {
            console.error('[TransactionMonitor] Notification error:', chrome.runtime.lastError)
          } else {
            console.log('[TransactionMonitor] Notification shown:', notificationId)
          }
        }
      )
    } catch (error) {
      console.error('[TransactionMonitor] Failed to create notification:', error)
    }
  }

  private async handleStale(pendingTx: PendingTransaction): Promise<void> {
    if (pendingTx.kind === 'swap') {
      this.scheduleNextCheck()
      this.notifyProgressUpdated(pendingTx.accountKey)
      return
    }
    this.pendingTransactions.delete(pendingTx.depositAddress)
    await this.saveToStorage()
    this.scheduleNextCheck()
    this.notifyProgressUpdated(pendingTx.accountKey)
  }

  private notifyProgressUpdated(accountKey: string): void {
    chrome.runtime.sendMessage({ type: 'INTENTS_PROGRESS_UPDATED', accountKey }).catch(() => {})
  }

  private notifyCompletion(pendingTx: PendingTransaction, status: SwapStatus): void {
    chrome.runtime
      .sendMessage({
        type: 'CROSS_CHAIN_STATUS_UPDATED',
        depositAddress: pendingTx.depositAddress,
        transactionId: pendingTx.transactionId,
        accountKey: pendingTx.accountKey,
        status
      })
      .catch(() => {})
  }

  private isStatusBoundToQuote(binding: QuoteBinding, status: SwapStatus): boolean {
    if (binding.originAsset && status.originAsset && status.originAsset !== binding.originAsset) {
      return false
    }

    if (
      binding.destinationAsset &&
      status.destinationAsset &&
      status.destinationAsset !== binding.destinationAsset
    ) {
      return false
    }

    const actualAmount = status.swapDetails?.amountOutFormatted
    if (binding.minAmountOut && actualAmount) {
      if (safeBig(actualAmount).lt(binding.minAmountOut)) {
        return false
      }
    }

    return true
  }

  private async registerZcashDestinationMonitor(
    tx: Transaction,
    pendingTx: PendingTransaction,
    status: SwapStatus
  ): Promise<void> {
    if (
      tx.type !== 'withdraw' &&
      tx.type !== 'claim' &&
      !(
        tx.type === 'swap' &&
        isZcashDestination({
          destinationAsset: status.destinationAsset,
          destinationChain: pendingTx.destinationChain
        })
      )
    ) {
      return
    }

    const destHashes = status.swapDetails?.destinationChainTxHashes
    const zecHash = destHashes?.[0]?.hash
    if (!zecHash || !pendingTx.transactionId) return

    await zcashTxMonitor.addTransaction(
      {
        txHash: zecHash,
        accountKey: pendingTx.accountKey,
        transactionId: pendingTx.transactionId,
        amount: status.swapDetails?.amountOutFormatted || tx.amount,
        type: tx.type === 'swap' ? 'receive' : tx.type
      },
      { checkImmediately: true }
    )
  }
}

export const transactionMonitor = new TransactionMonitor()
