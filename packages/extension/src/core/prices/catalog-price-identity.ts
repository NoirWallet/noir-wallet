import type { Network } from '@/types'
import { resolveRheaSwapCanonicalAssetId } from '@/core/services/rhea-swap/rhea-swap-asset-identity'
import { resolveIntentsWalletAsset } from '@/core/services/intents-wallet-assets'
import type { SwapToken } from '@/core/services/intents-api'
import { catalogPriceAssetId, findAssetPrice, type AssetPriceReadModel } from './asset-price'

export function resolveCatalogPriceAssetId(
  token: SwapToken,
  network: Network,
  provider: 'rhea' | 'confidential'
): string {
  const canonical =
    resolveRheaSwapCanonicalAssetId(token.assetId, network) ??
    resolveIntentsWalletAsset(token, network)?.assetId
  if (canonical) return canonical
  const exactId =
    provider === 'rhea' && 'rheaChainId' in token
      ? `${token.rheaChainId}:${token.assetId}`
      : token.assetId
  return catalogPriceAssetId(provider, exactId)
}

export function findCatalogPrice(
  prices: AssetPriceReadModel | null,
  token: SwapToken,
  network: Network,
  provider: 'rhea' | 'confidential' = 'rhea'
) {
  return findAssetPrice(prices, resolveCatalogPriceAssetId(token, network, provider))
}
