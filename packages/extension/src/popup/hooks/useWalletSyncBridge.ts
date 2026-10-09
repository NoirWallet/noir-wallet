import { useEffect } from 'react'
import { useAccountDataStore, type SyncState } from '@/store/account-data-store'
import { useWalletStore } from '@/store/wallet-store'
import type { SyncReason, ZcashBalance } from '@/types'

type SyncProgressMessage = {
  type?: string
  walletId?: string
  accountId?: string
  isSyncing?: boolean
  syncProgress?: number
  currentHeight?: number
  latestHeight?: number
  etaMs?: number | null
  syncReason?: SyncReason | null
  balance?: ZcashBalance
}

const SYNC_REASONS = new Set<SyncReason>([
  'sync_stall',
  'network_error',
  'fallback_timeout',
  'wallet_state_error'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function isZcashBalance(value: unknown): value is ZcashBalance {
  if (!isRecord(value) || !isRecord(value.confirmed) || !isRecord(value.pending)) return false

  return (
    typeof value.transparent === 'string' &&
    typeof value.shielded === 'string' &&
    typeof value.total === 'string' &&
    typeof value.spendable === 'string' &&
    typeof value.available === 'string' &&
    typeof value.confirmed.transparent === 'string' &&
    typeof value.confirmed.shielded === 'string' &&
    typeof value.pending.transparent === 'string' &&
    typeof value.pending.shielded === 'string' &&
    typeof value.pending.total === 'string'
  )
}

function parseSyncProgressMessage(value: unknown): SyncProgressMessage | null {
  if (!isRecord(value)) return null
  if (value.type !== undefined && typeof value.type !== 'string') return null
  if (value.walletId !== undefined && typeof value.walletId !== 'string') return null
  if (value.accountId !== undefined && typeof value.accountId !== 'string') return null
  if (value.isSyncing !== undefined && typeof value.isSyncing !== 'boolean') return null
  if (!isOptionalFiniteNumber(value.syncProgress)) return null
  if (!isOptionalFiniteNumber(value.currentHeight)) return null
  if (!isOptionalFiniteNumber(value.latestHeight)) return null
  if (value.etaMs !== null && !isOptionalFiniteNumber(value.etaMs)) return null
  if (
    value.syncReason !== undefined &&
    value.syncReason !== null &&
    (typeof value.syncReason !== 'string' || !SYNC_REASONS.has(value.syncReason as SyncReason))
  ) {
    return null
  }
  if (value.balance !== undefined && !isZcashBalance(value.balance)) return null

  return value as SyncProgressMessage
}

function applySyncProgressMessage(value: unknown): void {
  const message = parseSyncProgressMessage(value)
  if (!message) return

  const { currentWalletId, currentNetwork } = useWalletStore.getState()
  const targetWalletId = message.walletId ?? currentWalletId
  if (!targetWalletId || targetWalletId !== currentWalletId) return

  const syncPatch: Partial<SyncState> = {}
  if (message.isSyncing !== undefined) syncPatch.isSyncing = message.isSyncing
  if (message.syncProgress !== undefined) syncPatch.syncProgress = message.syncProgress
  if (message.currentHeight !== undefined) syncPatch.currentHeight = message.currentHeight
  if (message.latestHeight !== undefined) syncPatch.latestHeight = message.latestHeight
  if (message.etaMs !== undefined) syncPatch.etaMs = message.etaMs
  if (message.syncReason !== undefined) syncPatch.syncReason = message.syncReason

  const accountData = useAccountDataStore.getState()
  if (Object.keys(syncPatch).length > 0) {
    accountData.setWalletSyncStateFor(currentNetwork, targetWalletId, syncPatch)
  }
  if (message.balance && message.accountId) {
    accountData.setBalanceFor(currentNetwork, targetWalletId, message.accountId, message.balance)
  }
}

/** Keeps sync and balance state current on every popup route, not only Home. */
export function useWalletSyncBridge(): void {
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)

  useEffect(() => {
    const listener = (message: unknown) => {
      if (isRecord(message) && message.type === 'SYNC_PROGRESS') {
        applySyncProgressMessage(message)
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  useEffect(() => {
    if (!currentWalletId || !currentAccountId) return

    chrome.runtime
      .sendMessage({
        type: 'GET_SYNC_STATE',
        walletId: currentWalletId,
        accountId: currentAccountId
      })
      .then(applySyncProgressMessage)
      .catch(() => {})
  }, [currentWalletId, currentAccountId])
}
