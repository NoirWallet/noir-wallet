import type { ChromeAssetPriceCacheScope } from './chrome-asset-price-cache-scope'
import {
  parseMarketChangeCacheSnapshot,
  type MarketChangeCacheRepository,
  type MarketChangeCacheSnapshot
} from './dex-screener-market-change-service'

const STORAGE_KEY = 'asset_market_change_cache_v1'

export class ChromeMarketChangeCacheRepository implements MarketChangeCacheRepository {
  constructor(private readonly scope: ChromeAssetPriceCacheScope) {}

  async get(): Promise<MarketChangeCacheSnapshot | null> {
    return parseMarketChangeCacheSnapshot((await this.scope.read(STORAGE_KEY)) ?? null)
  }

  async put(snapshot: MarketChangeCacheSnapshot): Promise<void> {
    await this.scope.write(STORAGE_KEY, snapshot)
  }
}
