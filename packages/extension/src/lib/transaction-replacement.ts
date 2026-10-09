import type { Transaction } from '@/types/wallet'
import { safeBig } from '@/lib/big'

export type TransactionRecoveryAction = 'speed_up' | 'retry' | 'none'

/**
 * Eligible = a first-party shielded send the monitor confirmed expired, so its
 * inputs are free again. A successful replacement broadcast permanently closes
 * the retry path on this record; a replacement that never broadcasts does not.
 */
export function canSpeedUp(tx: Transaction | undefined): boolean {
  return !!(
    tx &&
    tx.status === 'failed' &&
    tx.failureReason === 'expired' &&
    tx.type === 'send' &&
    tx.to &&
    !tx.depositAddress &&
    !tx.quoteBinding &&
    !tx.replacedByTransactionId
  )
}

/** Shared recovery action for every transaction surface. */
export function getTransactionRecoveryAction(
  tx: Transaction | undefined
): TransactionRecoveryAction {
  if (!tx || tx.status !== 'failed') return 'none'
  return canSpeedUp(tx) ? 'speed_up' : 'retry'
}

/** Clamp a retry to the amount that remains spendable at its newly selected fee. */
export function resolveSpeedUpAmount(originalAmount: string, maxAmount: string | null): string {
  if (!maxAmount) return originalAmount
  return safeBig(originalAmount).gt(maxAmount) ? safeBig(maxAmount).toFixed() : originalAmount
}

/**
 * Records a successful broadcast and closes the retry path on the expired
 * transaction it replaces. Both updates are returned together for one IndexedDB write.
 */
export function applyTransactionBroadcast(
  transactions: Transaction[],
  transactionId: string,
  txHash: string,
  expiryHeight: number | undefined
): Transaction[] {
  const broadcastTransaction = transactions.find(tx => tx.id === transactionId)
  if (!broadcastTransaction) return transactions

  const replacedTransactionId = broadcastTransaction.replacesTransactionId

  return transactions.map(tx => {
    if (tx.id === transactionId) {
      return {
        ...tx,
        txHash,
        status: 'pending',
        notified: false,
        expiryHeight
      }
    }

    if (replacedTransactionId && tx.id === replacedTransactionId) {
      return {
        ...tx,
        replacedByTransactionId: transactionId,
        replacedByTxHash: txHash
      }
    }

    return tx
  })
}
