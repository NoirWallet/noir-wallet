import { parseZeroIndexerEnabled } from '@/config/zero-indexer-settings'
import { parseZeroIndexerRuntimeOptions } from '@/config/zero-indexer-runtime'
import type { ZeroIndexerOptions } from '@/config/zero-indexer'
import {
  SETTINGS_STORAGE_KEY,
  updatePersistedWalletSettings,
  withWalletSettingsLock
} from '@/lib/wallet-settings-storage'
import type { Network } from '@/types'

export async function readZeroIndexerOptionsForWorker(
  network: Network
): Promise<ZeroIndexerOptions | null> {
  const response: unknown = await chrome.runtime.sendMessage({
    type: 'GET_ZERO_INDEXER_OPTIONS',
    network
  })
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Invalid privacy broadcast configuration response')
  }
  const result = response as Record<string, unknown>
  if (result.success !== true) {
    throw new Error('Privacy broadcast configuration is unavailable')
  }
  return parseZeroIndexerRuntimeOptions(result.options)
}

export async function readZeroIndexerEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  return parseZeroIndexerEnabled(stored[SETTINGS_STORAGE_KEY])
}

export async function writeZeroIndexerEnabled(enabled: boolean): Promise<void> {
  await withWalletSettingsLock(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
    const raw = stored[SETTINGS_STORAGE_KEY]
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: updatePersistedWalletSettings(raw, { zeroIndexerEnabled: enabled })
    })
  })
}
