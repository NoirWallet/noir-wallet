import type { Network } from '@/types'
import type { AssetPriceReadModel } from './asset-price'

export const ASSET_PRICE_PORT = 'noir:asset-prices'
export const ASSET_PRICE_ALARM = 'noir:asset-prices:refresh'
export const ASSET_PRICE_CHECK_MS = 60_000

export interface AssetPriceSnapshot {
  readonly network: Network
  readonly revision: number
  readonly prices: AssetPriceReadModel | null
}
