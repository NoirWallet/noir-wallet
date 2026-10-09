import type { EvmNetworkConfig } from '@/config/networks'
import type { Network } from '@/types'

import { resolveSwapTokenIconUrl, type SwapToken } from './intents-api'
import { resolveIntentsEvmAssets } from './intents-evm-assets'
import { createIntentsWalletAssetCatalog } from './intents-wallet-assets'

export interface IntentsManagedAsset {
  readonly protocolAssetId: string
  readonly assetId: string
  readonly chainId: string
  readonly namespace: string
  readonly reference: string
  readonly blockchain: string
  readonly symbol: string
  readonly decimals: number
  readonly iconUrl?: string
  readonly management: 'evm' | 'protocol'
}

export function isDefaultVisibleIntentsAsset(asset: Pick<IntentsManagedAsset, 'symbol'>): boolean {
  return asset.symbol.toUpperCase() === 'USDC' || asset.symbol.toUpperCase() === 'USDT'
}

export function resolveManagedIntentsAssets(
  tokens: readonly SwapToken[],
  network: Network,
  evmNetworks: readonly EvmNetworkConfig[]
): readonly IntentsManagedAsset[] {
  const assets = new Map<string, IntentsManagedAsset>()
  const walletCatalog = createIntentsWalletAssetCatalog(tokens, network)

  for (const token of tokens) {
    const iconUrl = resolveSwapTokenIconUrl(token)
    const evmAsset = resolveIntentsEvmAssets([token], evmNetworks)[0]
    if (evmAsset) {
      if (!assets.has(evmAsset.assetId)) {
        assets.set(
          evmAsset.assetId,
          Object.freeze({
            protocolAssetId: token.assetId,
            assetId: evmAsset.assetId,
            chainId: evmAsset.chainId,
            namespace: 'erc20',
            reference: evmAsset.contractAddress,
            blockchain: token.blockchain,
            symbol: token.symbol,
            decimals: token.decimals,
            ...(iconUrl ? { iconUrl } : {}),
            management: 'evm' as const
          })
        )
      }
      continue
    }
  }

  for (const walletAsset of walletCatalog.entries) {
    if (walletAsset.kind !== 'token' || assets.has(walletAsset.assetId)) continue
    assets.set(
      walletAsset.assetId,
      Object.freeze({
        protocolAssetId: walletAsset.protocolAssetId,
        assetId: walletAsset.assetId,
        chainId: walletAsset.chainId,
        namespace: walletAsset.namespace,
        reference: walletAsset.reference,
        blockchain: walletAsset.blockchain,
        symbol: walletAsset.symbol,
        decimals: walletAsset.decimals,
        ...(walletAsset.iconUrl ? { iconUrl: walletAsset.iconUrl } : {}),
        management: 'protocol' as const
      })
    )
  }

  return Object.freeze([...assets.values()])
}

export function resolveManagedIntentsAsset(
  tokens: readonly SwapToken[],
  protocolAssetId: string,
  network: Network,
  evmNetworks: readonly EvmNetworkConfig[]
): IntentsManagedAsset | null {
  const token = tokens.find(candidate => candidate.assetId === protocolAssetId)
  if (!token) return null
  return (
    resolveManagedIntentsAssets([token], network, evmNetworks).find(
      asset => asset.protocolAssetId === protocolAssetId
    ) ?? null
  )
}

function normalizedManagedAssetReference(asset: IntentsManagedAsset, reference: string): string {
  const trimmed = reference.trim()
  if (asset.namespace === 'token') return trimmed
  if (asset.namespace === 'nep141') return trimmed.replace(/_/g, '%5F').toLowerCase()
  return trimmed.toLowerCase()
}

export function findManagedIntentsAssetByReference(
  assets: readonly IntentsManagedAsset[],
  chainId: string,
  reference: string
): IntentsManagedAsset | null {
  const trimmed = reference.trim()
  if (!trimmed) return null
  return (
    assets.find(
      asset =>
        asset.chainId === chainId &&
        normalizedManagedAssetReference(asset, asset.reference) ===
          normalizedManagedAssetReference(asset, trimmed)
    ) ?? null
  )
}
