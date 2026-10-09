import type { FundingSource, Transaction, TransactionType } from '@/types'
import { WASM_SELECTION_CONFIRMATIONS } from '@/config/wallet'
import { getRequiredConfirmations } from './transaction-status'

export type UnconfirmedTransactionKind =
  | 'untrusted'
  | 'incoming'
  | 'outgoing'
  | 'both'
  | 'generic'
  | 'none'

export interface UnconfirmedTransactionSummary {
  kind: UnconfirmedTransactionKind
  hasSpendableUntrustedIncoming: boolean
  hasIncoming: boolean
  hasOutgoing: boolean
}

const INCOMING_TYPES = new Set<TransactionType>(['receive', 'withdraw', 'claim'])

function isAwaitingConfirmations(transaction: Transaction): boolean {
  if (transaction.status === 'failed') return false

  const required =
    transaction.requiredConfirmations ?? getRequiredConfirmations(transaction.type ?? 'send')

  if (transaction.confirmations != null) {
    return transaction.confirmations < required
  }

  return (
    transaction.status === 'pending' ||
    transaction.status === 'confirming' ||
    transaction.status === 'relay_confirmed'
  )
}

function isSpendableUntrustedIncoming(transaction: Transaction): boolean {
  if (!INCOMING_TYPES.has(transaction.type ?? 'send') || transaction.confirmations == null) {
    return false
  }

  const required =
    transaction.requiredConfirmations ?? getRequiredConfirmations(transaction.type ?? 'send')
  return (
    required > WASM_SELECTION_CONFIRMATIONS &&
    transaction.confirmations >= WASM_SELECTION_CONFIRMATIONS &&
    transaction.confirmations < required
  )
}

export function summarizeUnconfirmedTransactions(
  transactions: Transaction[],
  hasPendingBalance: boolean,
  fundingSource?: FundingSource
): UnconfirmedTransactionSummary {
  let hasSpendableUntrustedIncoming = false
  let hasIncoming = false
  let hasOutgoing = false

  for (const transaction of transactions) {
    if (fundingSource && transaction.fromType !== fundingSource) continue
    if (!isAwaitingConfirmations(transaction)) continue

    if (INCOMING_TYPES.has(transaction.type ?? 'send')) {
      hasIncoming = true
      if (isSpendableUntrustedIncoming(transaction)) {
        hasSpendableUntrustedIncoming = true
      }
    } else {
      hasOutgoing = true
    }
  }

  const kind: UnconfirmedTransactionKind = hasSpendableUntrustedIncoming
    ? 'untrusted'
    : hasIncoming
      ? hasOutgoing
        ? 'both'
        : 'incoming'
      : hasOutgoing
        ? 'outgoing'
        : hasPendingBalance
          ? 'generic'
          : 'none'

  return { kind, hasSpendableUntrustedIncoming, hasIncoming, hasOutgoing }
}
