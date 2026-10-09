const DEFAULT_QUOTE_VALIDITY_MS = 10 * 60 * 1000
const SLOW_CHAIN_QUOTE_VALIDITY_MS = 30 * 60 * 1000
const SLOW_CHAINS = new Set(['btc', 'bitcoin', 'zec', 'zcash'])

export function getIntentsQuoteValidityMs(originChain: string, destinationChain: string): number {
  const usesSlowChain = [originChain, destinationChain].some(chain =>
    SLOW_CHAINS.has(chain.trim().toLowerCase())
  )
  return usesSlowChain ? SLOW_CHAIN_QUOTE_VALIDITY_MS : DEFAULT_QUOTE_VALIDITY_MS
}

export function createIntentsDeadline(
  originChain: string,
  destinationChain: string,
  now = Date.now()
): string {
  return new Date(now + getIntentsQuoteValidityMs(originChain, destinationChain)).toISOString()
}
