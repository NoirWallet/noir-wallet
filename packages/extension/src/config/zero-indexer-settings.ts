import { SETTINGS_STORAGE_KEY } from './storage-keys'
import { withWalletSettingsLock } from '@/lib/wallet-settings-storage'

function parseSettings(raw: unknown): Record<string, unknown> {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function parseZeroIndexerEnabled(raw: unknown): boolean {
  const settings = parseSettings(raw)
  const state = settings.state
  return !state || typeof state !== 'object' || !('zeroIndexerEnabled' in state)
    ? true
    : (state as Record<string, unknown>).zeroIndexerEnabled !== false
}

export async function readZeroIndexerEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  return parseZeroIndexerEnabled(stored[SETTINGS_STORAGE_KEY])
}

export async function writeZeroIndexerEnabled(enabled: boolean): Promise<void> {
  await withWalletSettingsLock(async () => {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
    const raw = stored[SETTINGS_STORAGE_KEY]
    const settings = parseSettings(raw)
    const previousState =
      settings.state && typeof settings.state === 'object' && !Array.isArray(settings.state)
        ? (settings.state as Record<string, unknown>)
        : {}
    const { zeroIndexerDefaultApplied: _retired, ...state } = previousState
    const next = { ...settings, state: { ...state, zeroIndexerEnabled: enabled } }
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: typeof raw === 'string' ? JSON.stringify(next) : next
    })
  })
}
