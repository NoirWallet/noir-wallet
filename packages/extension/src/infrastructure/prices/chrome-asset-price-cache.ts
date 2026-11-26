import type { ChromeAssetPriceCacheScope } from './chrome-asset-price-cache-scope'
import {
  parseAssetPriceCacheSnapshot,
  type AssetPriceCacheRepository,
  type AssetPriceCacheSnapshot
} from './one-click-asset-price-service'

const STORAGE_KEY = 'asset_price_cache_v1'

export class ChromeAssetPriceCacheRepository implements AssetPriceCacheRepository {
  constructor(private readonly scope: ChromeAssetPriceCacheScope) {}

  async get(): Promise<AssetPriceCacheSnapshot | null> {
    return parseAssetPriceCacheSnapshot((await this.scope.read(STORAGE_KEY)) ?? null)
  }

  async put(snapshot: AssetPriceCacheSnapshot): Promise<void> {
    await this.scope.write(STORAGE_KEY, snapshot)
  }
}
