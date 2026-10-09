import type { TxFailureReason } from './wallet.ts'

export interface TransactionStatusUpdatedMessage {
  type: 'TRANSACTION_STATUS_UPDATED'
  accountKey: string
  transactionId: string
  status: 'pending' | 'success' | 'failed'
  failureReason?: TxFailureReason
}

export function isTransactionStatusUpdatedMessage(
  value: unknown
): value is TransactionStatusUpdatedMessage {
  if (!value || typeof value !== 'object') return false

  const message = value as Record<string, unknown>
  const validStatus =
    message.status === 'pending' || message.status === 'success' || message.status === 'failed'
  const validFailureReason =
    message.failureReason == null ||
    message.failureReason === 'expired' ||
    message.failureReason === 'timeout'
  const validStatusReasonPair = message.status === 'failed' || message.failureReason == null

  return (
    message.type === 'TRANSACTION_STATUS_UPDATED' &&
    typeof message.accountKey === 'string' &&
    typeof message.transactionId === 'string' &&
    validStatus &&
    validFailureReason &&
    validStatusReasonPair
  )
}
