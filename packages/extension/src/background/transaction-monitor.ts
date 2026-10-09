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
import type { AccountScope } from '@/core/wallet/account-scope'
import { resolveAccountScope } from '@/core/wallet/account-scope'
import { useWalletStore } from '@/store/wallet-store'
import {
  INTENTS_PROGRESS_STALE_MS,
  isIntentsProgressStale,
  normalizeIntentsProgressEntry,
  registerIntentsProgress,
  updateIntentsProgressStatus,
  type IntentsProgressEntry,
  type IntentsProgressInput
} from '@/lib/intents-progress'
import { getIntentsStatusCopy } from '@/lib/transaction-status-copy'

export type PendingTransaction = IntentsProgressEntry &
  Partial<Pick<AccountScope, 'walletId' | 'accountId'>>

type PendingTransactionInput = IntentsProgressInput &
  Partial<Pick<AccountScope, 'walletId' | 'accountId'>>

const STORAGE_KEY = 'pending_transactions'

const ALARM_NAME = 'transaction-monitor-alarm'
const POLL_DELAY_MIN = 0.5 // Chrome production minimum: 30 seconds

export class TransactionMonitor {
  private pendingTransactions: Map<string, PendingTransaction> = new Map()

  async init() {
    await this.loadFromStorage()
    this.scheduleNextCheck()
  }

  async addTransaction(tx: PendingTransactionInput) {
    const accountScope = resolveAccountScope(tx, useWalletStore.getState().wallets)
    if (!accountScope) {
      throw new Error('Pending transaction requires a valid wallet and account identity')
    }
    const entry = {
      ...registerIntentsProgress(tx, this.pendingTransactions.get(tx.depositAddress)),
      ...accountScope
    }
    this.pendingTransactions.set(tx.depositAddress, entry)
    await this.saveToStorage()
    this.scheduleNextCheck()
    this.notifyProgressUpdated(entry.accountKey)
  }

  async removeTransaction(depositAddress: string) {
    const entry = this.pendingTransactions.get(depositAddress)
    if (!entry || !this.pendingTransactions.delete(depositAddress)) return
    await this.saveToStorage()
    this.scheduleNextCheck()
    this.notifyProgressUpdated(entry.accountKey)
  }

  async getProgress(accountKey: string): Promise<IntentsProgressEntry[]> {
    await this.loadFromStorage()
    return Array.from(this.pendingTransactions.values())
      .filter(entry => entry.accountKey === accountKey)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async removeAccount(walletId: string, accountId?: string): Promise<void> {
    await this.loadFromStorage()
    for (const [depositAddress, transaction] of this.pendingTransactions) {
      const scope = resolveAccountScope(transaction, useWalletStore.getState().wallets)
      if (
        scope?.walletId === walletId &&
        (accountId === undefined || scope.accountId === accountId)
      ) {
        this.pendingTransactions.delete(depositAddress)
      }
    }
    await this.saveToStorage()
    this.scheduleNextCheck()
  }

  async clear(): Promise<void> {
    this.pendingTransactions.clear()
    await this.saveToStorage()
    this.scheduleNextCheck()
  }

  async restorePendingWithdrawals(accountScopes: AccountScope[]): Promise<void> {
    await this.loadFromStorage()
    const alreadyMonitored = new Set(this.pendingTransactions.keys())
    let added = 0

    for (const accountScope of accountScopes) {
      try {
        const { accountKey } = accountScope
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
              actionName: transaction.type === 'claim' ? 'Claim' : 'Withdraw',
              accountKey,
              transactionId: transaction.id,
              originChain: 'near',
              destinationChain: 'zec'
            },
            this.pendingTransactions.get(depositAddress),
            transaction.timestamp
          )
          this.pendingTransactions.set(depositAddress, { ...restored, ...accountScope })
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

  async recheckNow() {
    await this.loadFromStorage()
    if (this.pendingTransactions.size === 0) return
    await this.runCheck()
  }

  async hasPendingTransactions(): Promise<boolean> {
    await this.loadFromStorage()
    return this.pendingTransactions.size > 0
  }

  async handleAlarm() {
    await this.loadFromStorage()
    if (this.pendingTransactions.size === 0) {
      chrome.alarms.clear(ALARM_NAME)
      return
    }
    await this.runCheck()
    this.scheduleNextCheck()
  }

  private scheduleNextCheck() {
    if (this.pendingTransactions.size === 0) {
      chrome.alarms.clear(ALARM_NAME)
      return
    }
    chrome.alarms.create(ALARM_NAME, { delayInMinutes: POLL_DELAY_MIN })
  }

  private async runCheck() {
    for (const tx of Array.from(this.pendingTransactions.values())) {
      await this.checkTransactionStatus(tx)
    }
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
            const accountScope = resolveAccountScope(
              value as Partial<AccountScope>,
              useWalletStore.getState().wallets
            )
            this.pendingTransactions.set(entry.depositAddress, {
              ...entry,
              ...(accountScope ?? {})
            })
            if (
              typeof value !== 'object' ||
              value === null ||
              typeof (value as Record<string, unknown>).createdAt !== 'number' ||
              typeof (value as Record<string, unknown>).lastStatusChangeAt !== 'number'
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

  private async checkTransactionStatus(tx: PendingTransaction) {
    try {
      // NOTE: Intents API is still used for Supply and Swap cross-chain mechanics
      const status = await fetchSwapStatus(tx.depositAddress)

      if (!status) {
        if (isIntentsProgressStale(tx)) await this.handleStale(tx)
        return
      }

      const updated = updateIntentsProgressStatus(tx, status.status)
      const isTerminal =
        status.status === 'SUCCESS' || status.status === 'REFUNDED' || status.status === 'FAILED'
      if (updated !== tx && !isTerminal) {
        this.pendingTransactions.set(tx.depositAddress, updated)
        await this.saveToStorage()
        this.notifyProgressUpdated(tx.accountKey)
      }

      if (isTerminal) {
        await this.handleCompletion(updated, status)
      } else if (isIntentsProgressStale(updated)) {
        await this.handleStale(updated)
      }
    } catch (error) {
      console.error(`[TransactionMonitor] Failed to check status for ${tx.depositAddress}:`, error)
    }
  }

  private async handleCompletion(pendingTx: PendingTransaction, status: SwapStatus) {
    const originChain = pendingTx.originChain || 'zcash'
    const destinationChain = pendingTx.destinationChain || ''

    const newChainHashes: { hash: string; chain: string }[] = []
    status.swapDetails?.originChainTxHashes?.forEach(tx => {
      newChainHashes.push({ hash: tx.hash, chain: formatChainName(originChain) })
    })
    status.swapDetails?.destinationChainTxHashes?.forEach(tx => {
      newChainHashes.push({ hash: tx.hash, chain: formatChainName(destinationChain) })
    })

    try {
      const accountKey = pendingTx.accountKey
      const transactionId = pendingTx.transactionId

      if (!transactionId) {
        this.pendingTransactions.delete(pendingTx.depositAddress)
        await this.saveToStorage()
        this.notifyProgressUpdated(pendingTx.accountKey)
        this.notifyCompletion(pendingTx, status)
        return
      }

      const txs = await loadTransactions(accountKey)
      const tx = txs.find(t => t.id === transactionId)

      if (!tx) {
        console.warn('[TransactionMonitor] Transaction not found:', transactionId)
        this.pendingTransactions.delete(pendingTx.depositAddress)
        await this.saveToStorage()
        this.notifyProgressUpdated(pendingTx.accountKey)
        return
      }

      const chainHashes = [...(tx.chainHashes || []), ...newChainHashes].filter(
        (entry, index, entries) =>
          entries.findIndex(
            candidate => candidate.hash === entry.hash && candidate.chain === entry.chain
          ) === index
      )

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
        const destinationHash = destHashes?.[0]?.hash

        const completionStatus = getCrossChainCompletionStatus(tx.type, {
          destinationAsset: status.destinationAsset,
          destinationChain: pendingTx.destinationChain
        })
        updates = {
          status: completionStatus,
          ...(shouldUpdateAmount ? { amount: realAmount } : {}),
          ...(completionStatus === 'relay_confirmed' && destinationHash
            ? { destinationTxHash: destinationHash }
            : {}),
          notified: completionStatus === 'success',
          chainHashes
        }

        // A Zcash destination is not final until its transaction is available
        // and reaches the required spendability depth.
        if (completionStatus === 'relay_confirmed' && !destinationHash) {
          console.warn(
            '[TransactionMonitor] Relay succeeded without a destination transaction hash; polling will continue',
            transactionId
          )
          await transactionRecorder.updateTransaction(accountKey, transactionId, updates)
          if (isIntentsProgressStale(pendingTx)) await this.handleStale(pendingTx)
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
    } catch (error) {
      console.error('[TransactionMonitor] Failed to update transaction:', error)
      return
    }

    const currentEntry = this.pendingTransactions.get(pendingTx.depositAddress)
    this.pendingTransactions.delete(pendingTx.depositAddress)
    try {
      await this.saveToStorage()
    } catch (error) {
      if (currentEntry) this.pendingTransactions.set(pendingTx.depositAddress, currentEntry)
      this.scheduleNextCheck()
      throw error
    }
    this.notifyProgressUpdated(pendingTx.accountKey)

    trackEvent(ANALYTICS_EVENTS.SWAP_COMPLETED, {
      hasTransaction: 1,
      inputAmount: pendingTx.amountIn,
      inputSymbol: pendingTx.tokenInSymbol,
      outputAmount: status.swapDetails?.amountOutFormatted || pendingTx.amountOut,
      outputSymbol: pendingTx.tokenOutSymbol,
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
        () => {
          if (chrome.runtime.lastError) {
            console.error('[TransactionMonitor] Notification error:', chrome.runtime.lastError)
          }
        }
      )
    } catch (error) {
      console.error('[TransactionMonitor] Failed to create notification:', error)
    }
  }

  private async handleStale(pendingTx: PendingTransaction): Promise<void> {
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
    const accountScope = resolveAccountScope(pendingTx, useWalletStore.getState().wallets)
    if (!accountScope) {
      console.warn(
        '[TransactionMonitor] Cannot monitor Zcash destination with unresolved account identity:',
        pendingTx.transactionId
      )
      return
    }

    await zcashTxMonitor.addTransaction(
      {
        txHash: zecHash,
        ...accountScope,
        transactionId: pendingTx.transactionId,
        amount: status.swapDetails?.amountOutFormatted || tx.amount,
        type: tx.type === 'swap' ? 'receive' : tx.type
      },
      { checkImmediately: true }
    )
  }
}

export const transactionMonitor = new TransactionMonitor()
