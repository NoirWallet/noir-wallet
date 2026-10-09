import { safeBig } from '@/lib/big'
import type { ZcashBalance } from '@/types'

export const LEGACY_POOL_PRIVACY_NOTICE_STORAGE_KEY = 'legacy_pool_privacy_notice_shown'

export const NYM_DOWNLOAD_URL = 'https://nym.com/download'
export const TOR_DOWNLOAD_URL = 'https://www.torproject.org/download/'

export function hasLegacyOrchardBalance(balances: Array<ZcashBalance | null | undefined>): boolean {
  return balances.some(balance => safeBig(balance?.shieldedPools?.orchard || '0').gt(0))
}

export function shouldShowLegacyPoolPrivacyNotice(
  hasLegacyBalance: boolean,
  hasShown: boolean
): boolean {
  return hasLegacyBalance && !hasShown
}

export async function readLegacyPoolPrivacyNoticeShown(): Promise<boolean> {
  const stored = await chrome.storage.local.get(LEGACY_POOL_PRIVACY_NOTICE_STORAGE_KEY)
  return stored[LEGACY_POOL_PRIVACY_NOTICE_STORAGE_KEY] === true
}

export async function markLegacyPoolPrivacyNoticeShown(): Promise<void> {
  await chrome.storage.local.set({ [LEGACY_POOL_PRIVACY_NOTICE_STORAGE_KEY]: true })
}
