export const ZERO_INDEXER_ENDPOINT = {
  id: 'zero-indexer',
  label: 'ZeroIndexer',
  url: 'https://tee.unsafe.zec.rocks'
} as const

export const ZERO_INDEXER_TESTNET_URL = 'https://tee.testnet.unsafe.zec.rocks'

const zeroIndexerOrigin = new URL(ZERO_INDEXER_ENDPOINT.url).origin

export function isZeroIndexerEndpoint(endpoint: { id: string; url: string }): boolean {
  return (
    endpoint.id === ZERO_INDEXER_ENDPOINT.id || new URL(endpoint.url).origin === zeroIndexerOrigin
  )
}
