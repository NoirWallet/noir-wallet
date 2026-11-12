export interface ShieldSourceTokenRow<T> {
  readonly item: T
  readonly availableRaw: string
}

export function partitionShieldSourceTokenRows<T>(
  rows: readonly ShieldSourceTokenRow<T>[]
): Readonly<{ funded: readonly T[]; lowBalance: readonly T[] }> {
  const funded: T[] = []
  const lowBalance: T[] = []
  for (const row of rows) {
    try {
      if (BigInt(row.availableRaw) > 0n) funded.push(row.item)
      else lowBalance.push(row.item)
    } catch {
      lowBalance.push(row.item)
    }
  }
  return Object.freeze({ funded, lowBalance })
}
