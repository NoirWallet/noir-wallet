import { mutateTransactions } from '@/lib/indexed-db'
import type { Transaction } from '@/types'
import { isDuplicateWasmRow, localTxHashSet } from '@/lib/tx-history-dedup'
import {
  mergeTransactionUpdate,
  synchronizeInternalTransferConfirmations,
  type ZcashConfirmation
} from '@/lib/transaction-status'
import { logger } from '@/lib/logger'

export interface AddTransactionRequest {
  accountKey: string
  transaction: Omit<Transaction, 'id'>
}

export class TransactionRecorder {
  async addTransaction(req: AddTransactionRequest): Promise<Transaction> {
    const { accountKey, transaction } = req

    const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const newTx: Transaction = { ...transaction, id }

    await mutateTransactions(accountKey, existingTxs => [...existingTxs, newTx])

    logger.log(`[TransactionRecorder] Transaction added (${transaction.type})`)
    console.log('[TransactionRecorder] Transaction added:', {
      accountKey,
      txId: id,
      type: transaction.type,
      amount: transaction.amount
    })

    this.broadcastTransactionAdded(accountKey)

    return newTx
  }

  async updateTransaction(
    accountKey: string,
    transactionId: string,
    updates: Partial<Transaction>
  ): Promise<void> {
    await mutateTransactions(accountKey, txs => {
      const updatedTxs = txs.map(tx =>
        tx.id === transactionId ? mergeTransactionUpdate(tx, updates) : tx
      )
      const synchronizedTxs = synchronizeInternalTransferConfirmations(updatedTxs)
      const localHashes = localTxHashSet(synchronizedTxs)
      return synchronizedTxs.filter(tx => !isDuplicateWasmRow(tx, localHashes))
    })

    logger.log('[TransactionRecorder] Transaction updated')
    console.log('[TransactionRecorder] Transaction updated:', {
      accountKey,
      transactionId,
      updates
    })

    this.broadcastTransactionUpdated(accountKey, transactionId)
  }

  async updateTerminalTransaction(
    accountKey: string,
    transactionId: string,
    updates: Partial<Transaction> & { status: 'success' | 'failed' },
    confirmation?: ZcashConfirmation
  ): Promise<{ found: boolean; shouldNotify: boolean; statusMatches: boolean }> {
    let found = false
    let shouldNotify = false
    let statusMatches = false
    await mutateTransactions(accountKey, txs => {
      const updatedTxs = txs.map(tx => {
        if (tx.id !== transactionId) return tx
        found = true
        const { txHash: monitoredHash, ...statusUpdates } = updates
        const mergedUpdates = {
          ...statusUpdates,
          ...(!tx.txHash && monitoredHash ? { txHash: monitoredHash } : {})
        }
        const updated = mergeTransactionUpdate(tx, mergedUpdates, confirmation)
        statusMatches = updated.status === updates.status
        shouldNotify = statusMatches && (!tx.notified || updated.status !== tx.status)
        return updated
      })
      return synchronizeInternalTransferConfirmations(updatedTxs)
    })
    if (found) this.broadcastTransactionUpdated(accountKey, transactionId)
    return { found, shouldNotify, statusMatches }
  }

  async markTerminalNotified(
    accountKey: string,
    transactionId: string,
    status: 'success' | 'failed'
  ): Promise<{ found: boolean; newlyNotified: boolean }> {
    let found = false
    let newlyNotified = false
    await mutateTransactions(accountKey, txs =>
      txs.map(tx => {
        if (tx.id !== transactionId) return tx
        found = true
        if (tx.status !== status || tx.notified) return tx
        newlyNotified = true
        return { ...tx, notified: true }
      })
    )
    return { found, newlyNotified }
  }

  private broadcastTransactionAdded(accountKey: string) {
    console.log('[TransactionRecorder] Broadcasting TRANSACTION_ADDED:', accountKey)
    chrome.runtime
      .sendMessage({
        type: 'TRANSACTION_ADDED',
        accountKey
      })
      .then(() => {
        console.log('[TransactionRecorder] TRANSACTION_ADDED sent successfully')
      })
      .catch(err => {
        console.log(
          '[TransactionRecorder] TRANSACTION_ADDED failed (popup may be closed):',
          err.message
        )
      })
  }

  private broadcastTransactionUpdated(accountKey: string, transactionId: string) {
    console.log('[TransactionRecorder] Broadcasting TRANSACTION_UPDATED:', {
      accountKey,
      transactionId
    })
    chrome.runtime
      .sendMessage({
        type: 'TRANSACTION_UPDATED',
        accountKey,
        transactionId
      })
      .then(() => {
        console.log('[TransactionRecorder] TRANSACTION_UPDATED sent successfully')
      })
      .catch(err => {
        console.log(
          '[TransactionRecorder] TRANSACTION_UPDATED failed (popup may be closed):',
          err.message
        )
      })
  }
}

export const transactionRecorder = new TransactionRecorder()
