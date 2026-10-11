export const ZERO_INDEXER_MAINNET_URL = 'https://tee.unsafe.zec.rocks'
export const ZERO_INDEXER_TESTNET_URL = 'https://tee.testnet.unsafe.zec.rocks'

const zeroIndexerOrigins = new Set([
  new URL(ZERO_INDEXER_MAINNET_URL).origin,
  new URL(ZERO_INDEXER_TESTNET_URL).origin
])

export function isZeroIndexerEndpoint(endpoint: { id: string; url: string }): boolean {
  if (endpoint.id === 'zero-indexer') return true
  try {
    return zeroIndexerOrigins.has(new URL(endpoint.url).origin)
  } catch {
    return false
  }
}

export interface ZeroIndexerOptions {
  urls: string[]
  sendTimeoutMs?: number
}
