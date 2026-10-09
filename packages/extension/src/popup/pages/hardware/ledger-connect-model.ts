export const MAX_ZCASH_ACCOUNT_INDEX = 0x7fffffff

export function parseLedgerAccountIndex(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null
  const index = Number(value)
  return Number.isSafeInteger(index) && index <= MAX_ZCASH_ACCOUNT_INDEX ? index : null
}
