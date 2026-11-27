import type { ChromeAssetPriceCacheScope } from './chrome-asset-price-cache-scope'
import {
  parseMarketChangeCacheSnapshot,
  type MarketChangeCacheRepository,
  type MarketChangeCacheSnapshot
} from './dex-screener-market-change-service'

export const USER_ASSET_MARKET_CACHE_STORAGE_KEY = 'user_asset_market_cache_v1'

export class ChromeUserAssetMarketCacheRepository implements MarketChangeCacheRepository {
  constructor(private readonly scope: ChromeAssetPriceCacheScope) {}

  async get(): Promise<MarketChangeCacheSnapshot | null> {
    return parseMarketChangeCacheSnapshot(
      (await this.scope.read(USER_ASSET_MARKET_CACHE_STORAGE_KEY)) ?? null
    )
  }

  async put(snapshot: MarketChangeCacheSnapshot): Promise<void> {
    await this.scope.write(USER_ASSET_MARKET_CACHE_STORAGE_KEY, snapshot)
  }
}
