import type { ChromeAssetPriceCacheScope } from './chrome-asset-price-cache-scope'
import {
  parseMarketChangeCacheSnapshot,
  type MarketChangeCacheRepository,
  type MarketChangeCacheSnapshot
} from './dex-screener-market-change-service'

export const DEFI_LLAMA_MARKET_CACHE_STORAGE_KEY = 'defi_llama_market_change_cache_v1'

export class ChromeDefiLlamaMarketCacheRepository implements MarketChangeCacheRepository {
  constructor(private readonly scope: ChromeAssetPriceCacheScope) {}

  async get(): Promise<MarketChangeCacheSnapshot | null> {
    return parseMarketChangeCacheSnapshot(
      (await this.scope.read(DEFI_LLAMA_MARKET_CACHE_STORAGE_KEY)) ?? null
    )
  }

  async put(snapshot: MarketChangeCacheSnapshot): Promise<void> {
    await this.scope.write(DEFI_LLAMA_MARKET_CACHE_STORAGE_KEY, snapshot)
  }
}
