import type { WalletItem } from '@/types'

export const WALLET_STATE_KEY = 'wallet_state'
const DELETED_WALLETS_KEY = 'wallet_deleted_ids'
const LOCK_NAME = 'noir-wallet-metadata'

interface WalletSnapshot {
  version?: number
  state: {
    wallets: WalletItem[]
    currentWalletId?: string | null
    currentAccountId?: string | null
    accountDisplayNames?: Record<string, string>
    [key: string]: unknown
  }
}

function parseSnapshot(value: unknown): WalletSnapshot | null {
  if (value == null) return null
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('state' in parsed) ||
    !parsed.state ||
    typeof parsed.state !== 'object' ||
    !('wallets' in parsed.state) ||
    !Array.isArray(parsed.state.wallets) ||
    !parsed.state.wallets.every(
      wallet => wallet && typeof wallet.id === 'string' && Array.isArray(wallet.accounts)
    )
  )
    throw new Error('Wallet metadata is unavailable')
  return parsed as WalletSnapshot
}

function deletedIds(value: unknown): Set<string> {
  if (value == null) return new Set()
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) {
    throw new Error('Wallet deletion records are unavailable')
  }
  return new Set(value)
}

function withoutDeleted(snapshot: WalletSnapshot, deleted: Set<string>): WalletSnapshot {
  const wallets = snapshot.state.wallets.filter(wallet => !deleted.has(wallet.id))
  const state = { ...snapshot.state, wallets }
  if (state.currentWalletId && deleted.has(state.currentWalletId)) {
    const next = wallets.find(wallet => wallet.accounts.length > 0)
    state.currentWalletId = next?.id ?? null
    state.currentAccountId = next?.accounts[0]?.id ?? null
  }
  if (state.accountDisplayNames) {
    state.accountDisplayNames = Object.fromEntries(
      Object.entries(state.accountDisplayNames).filter(
        ([key]) => ![...deleted].some(id => key.startsWith(`${id}_`))
      )
    )
  }
  return { ...snapshot, state }
}

async function withMetadataLock<T>(operation: () => Promise<T>): Promise<T> {
  // Every extension context shares this lock; a local queue cannot protect a
  // popup from an older snapshot held by the service worker or hardware tab.
  if (!navigator.locks) throw new Error('Wallet storage coordination is unavailable')
  return await navigator.locks.request(LOCK_NAME, operation)
}

export function readWalletMetadata(
  storage: chrome.storage.StorageArea
): Promise<WalletSnapshot | null> {
  return withMetadataLock(async () => {
    const saved = await storage.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY])
    return snapshot ? withoutDeleted(snapshot, deletedIds(saved[DELETED_WALLETS_KEY])) : null
  })
}

export async function refreshWalletMetadata(
  hydrate: () => Promise<void> | void,
  isHydrated: () => boolean
): Promise<void> {
  // Zustand cancels overlapping hydrations and absorbs read errors. Serialize
  // refreshes and check completion so callers cannot authenticate stale state.
  await navigator.locks.request('noir-wallet-hydration', async () => {
    await hydrate()
    if (!isHydrated()) throw new Error('Wallet metadata could not be loaded')
  })
}

export function writeWalletMetadata(
  storage: chrome.storage.StorageArea,
  value: unknown
): Promise<void> {
  const snapshot = parseSnapshot(value)
  if (!snapshot) return Promise.reject(new Error('Wallet metadata is unavailable'))
  return withMetadataLock(async () => {
    const saved = await storage.get(DELETED_WALLETS_KEY)
    await storage.set({
      [WALLET_STATE_KEY]: withoutDeleted(snapshot, deletedIds(saved[DELETED_WALLETS_KEY]))
    })
  })
}

export function removeWalletMetadata(walletId: string): Promise<void> {
  return withMetadataLock(async () => {
    const storage = chrome.storage.local
    const saved = await storage.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY])
    if (!snapshot) throw new Error('Wallet metadata is unavailable')
    const deleted = deletedIds(saved[DELETED_WALLETS_KEY])
    deleted.add(walletId)
    // Keep tombstones outside wallet_state so stale snapshots cannot erase them.
    // Commit selection and deletion together before callers erase credentials.
    await storage.set({
      [DELETED_WALLETS_KEY]: [...deleted],
      [WALLET_STATE_KEY]: withoutDeleted(snapshot, deleted)
    })
  })
}

export function resetWalletMetadata(): Promise<void> {
  return withMetadataLock(async () => {
    const storage = chrome.storage.local
    const saved = await storage.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY])
    const deleted = deletedIds(saved[DELETED_WALLETS_KEY])
    for (const wallet of snapshot?.state.wallets ?? []) deleted.add(wallet.id)
    await storage.set({
      [DELETED_WALLETS_KEY]: [...deleted],
      [WALLET_STATE_KEY]: {
        ...snapshot,
        state: {
          ...snapshot?.state,
          wallets: [],
          currentWalletId: null,
          currentAccountId: null,
          accountDisplayNames: {},
          zecPrice: 0
        }
      }
    })
  })
}
