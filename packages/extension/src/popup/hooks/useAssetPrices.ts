import { useSyncExternalStore } from 'react'
import { findAssetPrice } from '@/core/prices'
import { getZcashChainId } from '@/core/chains/registry'
import type { Network } from '@/types'
import { assetPriceClient } from '@/popup/services/asset-price-client'

const noSubscription = () => () => {}

export function useAssetPrices(network: Network, enabled = true) {
  const snapshot = useSyncExternalStore(
    enabled ? assetPriceClient.subscribe : noSubscription,
    assetPriceClient.getSnapshot
  )
  return enabled && snapshot?.network === network ? snapshot.prices : null
}

export function useZcashUsdPrice(network: Network): number {
  const prices = useAssetPrices(network)
  return Number(findAssetPrice(prices, `${getZcashChainId(network)}/slip44:133`)?.priceUsd ?? 0)
}
