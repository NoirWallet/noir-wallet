import type { ChromeAssetPriceCacheScope } from './chrome-asset-price-cache-scope'
import {
  parseAssetPriceCacheSnapshot,
  type AssetPriceCacheRepository,
  type AssetPriceCacheSnapshot
} from './one-click-asset-price-service'

export const FOUR_MEME_PRICE_CACHE_STORAGE_KEY = 'four_meme_price_cache_v1'
const QUOTE_PRICE_CACHE_STORAGE_KEY = 'four_meme_quote_price_cache_v1'

export class ChromeFourMemePriceCacheRepository implements AssetPriceCacheRepository {
  private readonly storageKey: string

  constructor(
    private readonly scope: ChromeAssetPriceCacheScope,
    kind: 'tokens' | 'quotes' = 'tokens'
  ) {
    this.storageKey =
      kind === 'tokens' ? FOUR_MEME_PRICE_CACHE_STORAGE_KEY : QUOTE_PRICE_CACHE_STORAGE_KEY
  }

  async get(): Promise<AssetPriceCacheSnapshot | null> {
    return parseAssetPriceCacheSnapshot((await this.scope.read(this.storageKey)) ?? null)
  }

  async put(snapshot: AssetPriceCacheSnapshot): Promise<void> {
    await this.scope.write(this.storageKey, snapshot)
  }
}
