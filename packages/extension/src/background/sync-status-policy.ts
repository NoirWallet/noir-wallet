import type { SyncReason, SyncTrigger } from '@/types'

export function isSyncOccupyingWallet(
  isScanning: boolean,
  isSyncVisible: boolean,
  ownsPreflight: boolean
): boolean {
  return isScanning || (isSyncVisible && !ownsPreflight)
}

export function shouldShowSyncPreflight(
  trigger: SyncTrigger | undefined,
  alreadyVisible: boolean
): boolean {
  if (trigger === 'periodic' || trigger === 'transaction') return false
  return trigger === 'requested' || trigger === 'wallet-change' || alreadyVisible
}

export function getVisibleSyncReason(
  isSyncActive: boolean,
  syncReason: SyncReason | null | undefined
): SyncReason | null {
  return isSyncActive ? null : (syncReason ?? null)
}
