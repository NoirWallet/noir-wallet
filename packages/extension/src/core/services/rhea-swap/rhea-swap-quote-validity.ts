export const RHEA_SWAP_MAX_QUOTE_AGE_MS = 30_000

export function getRheaSwapQuoteDeadline(quote: {
  readonly receivedAt: number
  readonly expiresAt: number | null
}): number {
  if (
    !Number.isSafeInteger(quote.receivedAt) ||
    quote.receivedAt < 0 ||
    (quote.expiresAt !== null &&
      (!Number.isSafeInteger(quote.expiresAt) || quote.expiresAt < quote.receivedAt))
  ) {
    throw new Error('Invalid RHEA Swap quote validity')
  }
  const ageDeadline = quote.receivedAt + RHEA_SWAP_MAX_QUOTE_AGE_MS
  return quote.expiresAt === null ? ageDeadline : Math.min(ageDeadline, quote.expiresAt)
}

export function isRheaSwapQuoteFresh(
  quote: { readonly receivedAt: number; readonly expiresAt: number | null },
  now = Date.now()
): boolean {
  if (!Number.isSafeInteger(now) || now < quote.receivedAt) return false
  try {
    return now < getRheaSwapQuoteDeadline(quote)
  } catch {
    return false
  }
}
