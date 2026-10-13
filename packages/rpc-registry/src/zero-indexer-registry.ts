export interface ZeroIndexerRegistryEndpoint {
  id: string
  label: string
  url: string
}

export interface ZeroIndexerRegistryDocument {
  version: 1
  updatedAt: string
  networks: {
    mainnet: ZeroIndexerRegistryEndpoint[]
    testnet: ZeroIndexerRegistryEndpoint[]
  }
}

// Broadcast endpoints have their own registry and are excluded from RPC monitoring.
export const ZERO_INDEXER_REGISTRY: ZeroIndexerRegistryDocument = {
  version: 1,
  updatedAt: '2026-10-11T00:00:00.000Z',
  networks: {
    mainnet: [
      { id: 'zero-indexer-mainnet', label: 'ZeroIndexer', url: 'https://tee.unsafe.zec.rocks' }
    ],
    testnet: [
      {
        id: 'zero-indexer-testnet',
        label: 'ZeroIndexer Testnet',
        url: 'https://tee.testnet.unsafe.zec.rocks'
      }
    ]
  }
}
