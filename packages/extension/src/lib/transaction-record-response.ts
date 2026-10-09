export function isValidAddTransactionResponse(response: unknown): boolean {
  if (typeof response !== 'object' || response === null) return false
  const candidate = response as Record<string, unknown>
  if (candidate.success !== true) return false
  if (typeof candidate.transaction !== 'object' || candidate.transaction === null) return false
  const transaction = candidate.transaction as Record<string, unknown>
  return (
    typeof transaction.id === 'string' &&
    transaction.id.trim().length > 0 &&
    typeof transaction.timestamp === 'number' &&
    Number.isFinite(transaction.timestamp)
  )
}
