import { getAssetMarketMappings } from '@/core/prices/asset-market-mappings'
import {
  createAssetRegistry,
  createInitialProductChainRegistry,
  getBundledInitialProductAssetDefinitions
} from '@/core/chains/registry'
import type { MarketAssetId } from '@/core/prices'
import type { Network } from '@/types'

const PRODUCT_NETWORKS = Object.freeze(['mainnet', 'testnet'] as const satisfies readonly Network[])
const bundledAssetIds = new Set<string>()
const bundledMarketAssetIds = new Map<string, MarketAssetId>()

for (const network of PRODUCT_NETWORKS) {
  const bundledAssets = createAssetRegistry(
    createInitialProductChainRegistry(network),
    getBundledInitialProductAssetDefinitions(network)
  )
  for (const entry of bundledAssets.list()) bundledAssetIds.add(entry.asset.id)
  for (const mapping of getAssetMarketMappings(network, bundledAssets)) {
    bundledMarketAssetIds.set(mapping.assetId, mapping.marketAssetId)
  }
}

export function isBundledWalletAsset(assetId: string): boolean {
  return bundledAssetIds.has(assetId)
}

export function findBundledWalletMarketAssetId(assetId: string): MarketAssetId | null {
  return bundledMarketAssetIds.get(assetId) ?? null
}
