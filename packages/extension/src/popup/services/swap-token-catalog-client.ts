import {
  getCachedTokens,
  refreshSwapTokenCatalog,
  type SwapToken
} from '@/core/services/intents-api'
import { ChromeSwapTokenCatalogCacheRepository } from '@/infrastructure/persistence/chrome-swap-token-catalog-cache'

const cache = new ChromeSwapTokenCatalogCacheRepository()

export const swapTokenCatalogClient = Object.freeze({
  readCached: async (): Promise<readonly SwapToken[]> => {
    const memory = getCachedTokens()
    if (memory.length > 0) return Object.freeze([...memory])
    return (await cache.readFresh())?.tokens ?? Object.freeze([])
  },

  refresh: async (): Promise<readonly SwapToken[]> => {
    try {
      const tokens = await refreshSwapTokenCatalog()
      await cache.put(tokens)
      return tokens
    } catch (error) {
      const cached = await swapTokenCatalogClient.readCached()
      if (cached.length > 0) return cached
      throw error
    }
  }
})
