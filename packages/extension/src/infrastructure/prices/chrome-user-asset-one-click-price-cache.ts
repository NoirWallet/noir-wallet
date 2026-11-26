import type { ChromeAssetPriceCacheScope } from './chrome-asset-price-cache-scope'
import {
  parseAssetPriceCacheSnapshot,
  type AssetPriceCacheRepository,
  type AssetPriceCacheSnapshot
} from './one-click-asset-price-service'

export const USER_ASSET_ONE_CLICK_PRICE_CACHE_STORAGE_KEY = 'user_asset_one_click_price_cache_v1'

export class ChromeUserAssetOneClickPriceCacheRepository implements AssetPriceCacheRepository {
  constructor(private readonly scope: ChromeAssetPriceCacheScope) {}

  async get(): Promise<AssetPriceCacheSnapshot | null> {
    return parseAssetPriceCacheSnapshot(
      (await this.scope.read(USER_ASSET_ONE_CLICK_PRICE_CACHE_STORAGE_KEY)) ?? null
    )
  }

  async put(snapshot: AssetPriceCacheSnapshot): Promise<void> {
    await this.scope.write(USER_ASSET_ONE_CLICK_PRICE_CACHE_STORAGE_KEY, snapshot)
  }
}
