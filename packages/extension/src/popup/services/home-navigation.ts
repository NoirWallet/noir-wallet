export type HomeDefaultTab = 'assets' | 'activity'

export function resolveHomeDefaultTab(search: string): HomeDefaultTab {
  return new URLSearchParams(search).get('tab') === 'activity' ? 'activity' : 'assets'
}

export function clearHomeTransactionFocus(search: string): string | null {
  const params = new URLSearchParams(search)
  if (!params.has('transactionId')) return null
  params.delete('transactionId')
  const remaining = params.toString()
  return remaining ? `/?${remaining}` : '/'
}
