export async function findWasmAccountIdByHdIndex(
  accountBalances: unknown,
  accountIndex: number,
  getHdIndex: (accountId: number) => Promise<number | null | undefined>
): Promise<number | null> {
  if (!Array.isArray(accountBalances)) return null
  for (const entry of accountBalances) {
    if (!Array.isArray(entry)) continue
    const accountId = entry[0]
    if (typeof accountId !== 'number' || !Number.isSafeInteger(accountId) || accountId < 0) continue
    if ((await getHdIndex(accountId)) === accountIndex) return accountId
  }
  return null
}
