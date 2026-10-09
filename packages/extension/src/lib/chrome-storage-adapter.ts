/**
 * Chrome Storage Adapter for Zustand persist middleware
 * Implements Storage API interface backed by chrome.storage
 */

type StorageArea = 'local' | 'session'

import { SETTINGS_STORAGE_KEY } from '../config/storage-keys'
import {
  readWalletMetadata,
  writeWalletMetadata,
  WALLET_STATE_KEY
} from './wallet-metadata-storage'
import { withWalletSettingsLock } from './wallet-settings-storage'

interface StorageAdapter {
  getItem(key: string): Promise<unknown>
  setItem(key: string, value: unknown): Promise<void>
  removeItem(key: string): Promise<void>
}

/**
 * Creates a chrome.storage adapter for Zustand persist middleware
 * @param area - 'local' for persistent storage, 'session' for ephemeral storage
 */
export function createChromeStorageAdapter(area: StorageArea = 'local'): StorageAdapter {
  const storage = area === 'local' ? chrome.storage.local : chrome.storage.session

  return {
    getItem: async (key: string): Promise<unknown> => {
      if (area === 'local' && key === WALLET_STATE_KEY) {
        return readWalletMetadata(storage)
      }
      try {
        const result = await storage.get(key)
        return result[key] ?? null
      } catch (error) {
        console.error('[ChromeStorageAdapter] getItem error:', error)
        return null
      }
    },

    setItem: async (key: string, value: unknown): Promise<void> => {
      if (area === 'local' && key === WALLET_STATE_KEY) {
        await writeWalletMetadata(storage, value)
        return
      }
      const write = async () => {
        try {
          await storage.set({ [key]: value })
        } catch (error: any) {
          // Handle quota exceeded
          if (error.message?.includes('QUOTA_BYTES')) {
            console.warn('[ChromeStorageAdapter] Quota exceeded, attempting cleanup...')
            await clearOldCacheEntries(storage)
            await storage.set({ [key]: value })
          } else {
            console.error('[ChromeStorageAdapter] setItem error:', error)
            throw error
          }
        }
      }
      if (area === 'local' && key === SETTINGS_STORAGE_KEY) {
        await withWalletSettingsLock(write)
      } else {
        await write()
      }
    },

    removeItem: async (key: string): Promise<void> => {
      const remove = async () => {
        try {
          await storage.remove(key)
        } catch (error) {
          console.error('[ChromeStorageAdapter] removeItem error:', error)
          throw error
        }
      }
      if (area === 'local' && key === SETTINGS_STORAGE_KEY) {
        await withWalletSettingsLock(remove)
      } else {
        await remove()
      }
    }
  }
}

/**
 * Clear oldest cache entries when quota is exceeded
 * Targets balance_cache_* keys first
 */
async function clearOldCacheEntries(storage: chrome.storage.StorageArea): Promise<void> {
  try {
    const items = await storage.get(null)
    const cacheKeys = Object.keys(items).filter(key => key.startsWith('balance_cache_'))

    if (cacheKeys.length > 0) {
      // Sort by timestamp (assuming format: balance_cache_<timestamp>_<accountId>)
      const sorted = cacheKeys.sort()
      const toRemove = sorted.slice(0, Math.max(1, Math.floor(cacheKeys.length / 2)))
      await storage.remove(toRemove)
      console.log('[ChromeStorageAdapter] Cleared cache entries:', toRemove.length)
    }
  } catch (error) {
    console.error('[ChromeStorageAdapter] clearOldCacheEntries error:', error)
  }
}
