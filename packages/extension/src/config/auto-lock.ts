import { SETTINGS_STORAGE_KEY } from '@/config/storage-keys'
import { WALLET_CONFIG } from '@/config/wallet'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readStoredAutoLockMs(value: unknown): number {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!isRecord(parsed)) return WALLET_CONFIG.SECURITY.AUTO_LOCK.DEFAULT_MS

    const state = isRecord(parsed.state) ? parsed.state : parsed
    const autoLockMs = state.autoLockMs
    return typeof autoLockMs === 'number' && Number.isFinite(autoLockMs) && autoLockMs >= 0
      ? autoLockMs
      : WALLET_CONFIG.SECURITY.AUTO_LOCK.DEFAULT_MS
  } catch {
    return WALLET_CONFIG.SECURITY.AUTO_LOCK.DEFAULT_MS
  }
}

export async function readPersistedAutoLockMs(): Promise<number> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
  return readStoredAutoLockMs(stored[SETTINGS_STORAGE_KEY])
}

export async function shouldRequireUnlock({
  lastActivityTime,
  autoLockMs,
  now = Date.now(),
  isLocked,
  restoreSession
}: {
  lastActivityTime: number | null
  autoLockMs: number
  now?: number
  isLocked: boolean
  restoreSession: () => Promise<boolean>
}): Promise<boolean> {
  if (!lastActivityTime) return true
  if (autoLockMs > 0 && now - lastActivityTime >= autoLockMs) return true
  if (!isLocked) return false
  return !(await restoreSession())
}
