import type { WalletItem } from '@/types'

export const WALLET_STATE_KEY = 'wallet_state'
const DELETED_WALLETS_KEY = 'wallet_deleted_ids'
const DELETED_WALLET_RECORDS_KEY = 'wallet_deleted_records'
const METADATA_LOCK = 'noir-wallet-metadata'
const HYDRATION_LOCK = 'noir-wallet-hydration'

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
  ) {
    throw new Error('Wallet metadata is unavailable')
  }
  return parsed as WalletSnapshot
}

function parseDeletedIds(value: unknown): Set<string> {
  if (value == null) return new Set()
  if (!Array.isArray(value) || !value.every(id => typeof id === 'string')) {
    throw new Error('Wallet deletion records are unavailable')
  }
  return new Set(value)
}

function parseDeletionRecords(value: unknown): Record<string, string[]> {
  if (value == null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Wallet deletion records are unavailable')
  }
  const records = value as Record<string, unknown>
  if (
    Object.entries(records).some(
      ([id, accountIds]) =>
        !id ||
        !Array.isArray(accountIds) ||
        !accountIds.every(accountId => typeof accountId === 'string' && accountId.length > 0)
    )
  ) {
    throw new Error('Wallet deletion records are unavailable')
  }
  return records as Record<string, string[]>
}

function filterDeleted(snapshot: WalletSnapshot, deleted: Set<string>): WalletSnapshot {
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

function preserveBackupVerification(
  incoming: WalletSnapshot,
  current: WalletSnapshot | null
): WalletSnapshot {
  if (!current) return incoming
  const prior = new Map(current.state.wallets.map(wallet => [wallet.id, wallet]))
  return {
    ...incoming,
    state: {
      ...incoming.state,
      wallets: incoming.state.wallets.map(wallet => {
        const saved = prior.get(wallet.id)
        if (
          !saved ||
          saved.createdAt !== wallet.createdAt ||
          saved.seedPhraseKey !== wallet.seedPhraseKey
        ) {
          return wallet
        }
        const verifiedAt = Math.max(
          saved.secretPhraseBackupVerifiedAt ?? 0,
          wallet.secretPhraseBackupVerifiedAt ?? 0
        )
        return {
          ...wallet,
          ...(saved.secretPhraseCreationRevision === undefined
            ? {}
            : { secretPhraseCreationRevision: saved.secretPhraseCreationRevision }),
          ...(verifiedAt > 0 ? { secretPhraseBackupVerifiedAt: verifiedAt } : {})
        }
      })
    }
  }
}

async function withMetadataLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Wallet storage coordination is unavailable')
  return navigator.locks.request(METADATA_LOCK, operation)
}

export function readWalletMetadata(): Promise<WalletSnapshot | null> {
  return withMetadataLock(async () => {
    const saved = await chrome.storage.local.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY])
    return snapshot ? filterDeleted(snapshot, parseDeletedIds(saved[DELETED_WALLETS_KEY])) : null
  })
}

export function writeWalletMetadata(value: unknown): Promise<void> {
  const snapshot = parseSnapshot(value)
  if (!snapshot) return Promise.reject(new Error('Wallet metadata is unavailable'))
  return withMetadataLock(async () => {
    const saved = await chrome.storage.local.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const current = parseSnapshot(saved[WALLET_STATE_KEY])
    await chrome.storage.local.set({
      [WALLET_STATE_KEY]: filterDeleted(
        preserveBackupVerification(snapshot, current),
        parseDeletedIds(saved[DELETED_WALLETS_KEY])
      )
    })
  })
}

export function markWalletBackupVerified(
  walletId: string,
  createdAt: number,
  seedPhraseKey: string,
  verifiedAt: number,
  isCurrent: () => boolean
): Promise<void> {
  return withMetadataLock(async () => {
    if (!isCurrent()) throw new Error('Wallet changed or locked. Please try again.')
    const saved = await chrome.storage.local.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY])
    const deleted = parseDeletedIds(saved[DELETED_WALLETS_KEY])
    const wallet = snapshot?.state.wallets.find(item => item.id === walletId)
    if (
      !isCurrent() ||
      !snapshot ||
      deleted.has(walletId) ||
      !wallet ||
      wallet.createdAt !== createdAt ||
      wallet.seedPhraseKey !== seedPhraseKey
    ) {
      throw new Error('Wallet changed or was removed. Please try again.')
    }
    await chrome.storage.local.set({
      [WALLET_STATE_KEY]: {
        ...snapshot,
        state: {
          ...snapshot.state,
          wallets: snapshot.state.wallets.map(item =>
            item.id === walletId
              ? {
                  ...item,
                  secretPhraseBackupVerifiedAt: Math.max(
                    item.secretPhraseBackupVerifiedAt ?? 0,
                    verifiedAt
                  )
                }
              : item
          )
        }
      }
    })
  })
}

export function commitWalletMetadataDeletion(
  walletId: string,
  accountIds?: readonly string[]
): Promise<void> {
  return withMetadataLock(async () => {
    const saved = await chrome.storage.local.get([
      WALLET_STATE_KEY,
      DELETED_WALLETS_KEY,
      DELETED_WALLET_RECORDS_KEY
    ])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY]) ?? {
      version: 0,
      state: { wallets: [], currentWalletId: null, currentAccountId: null }
    }
    const deleted = parseDeletedIds(saved[DELETED_WALLETS_KEY])
    const records = parseDeletionRecords(saved[DELETED_WALLET_RECORDS_KEY])
    const wallet = snapshot.state.wallets.find(item => item.id === walletId)
    const deletedAccountIds = accountIds ?? wallet?.accounts.map(account => account.id)
    if (deletedAccountIds) records[walletId] = [...deletedAccountIds]
    deleted.add(walletId)
    await chrome.storage.local.set({
      [DELETED_WALLETS_KEY]: [...deleted],
      [DELETED_WALLET_RECORDS_KEY]: records,
      [WALLET_STATE_KEY]: filterDeleted(snapshot, deleted)
    })
  })
}

export function getWalletDeletionRecord(walletId: string): Promise<readonly string[] | null> {
  return withMetadataLock(async () => {
    const saved = await chrome.storage.local.get([DELETED_WALLETS_KEY, DELETED_WALLET_RECORDS_KEY])
    if (!parseDeletedIds(saved[DELETED_WALLETS_KEY]).has(walletId)) return null
    return parseDeletionRecords(saved[DELETED_WALLET_RECORDS_KEY])[walletId] ?? null
  })
}

export function completeWalletMetadataDeletion(walletId: string): Promise<void> {
  return withMetadataLock(async () => {
    const saved = await chrome.storage.local.get(DELETED_WALLET_RECORDS_KEY)
    const records = parseDeletionRecords(saved[DELETED_WALLET_RECORDS_KEY])
    if (!(walletId in records)) return
    delete records[walletId]
    await chrome.storage.local.set({ [DELETED_WALLET_RECORDS_KEY]: records })
  })
}

export function resetWalletMetadata(): Promise<void> {
  return withMetadataLock(async () => {
    const saved = await chrome.storage.local.get([WALLET_STATE_KEY, DELETED_WALLETS_KEY])
    const snapshot = parseSnapshot(saved[WALLET_STATE_KEY])
    const deleted = parseDeletedIds(saved[DELETED_WALLETS_KEY])
    for (const wallet of snapshot?.state.wallets ?? []) deleted.add(wallet.id)
    await chrome.storage.local.set({
      [DELETED_WALLETS_KEY]: [...deleted],
      [WALLET_STATE_KEY]: {
        version: snapshot?.version ?? 0,
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

export async function refreshWalletMetadata(
  hydrate: () => Promise<void> | void,
  isHydrated: () => boolean
): Promise<void> {
  if (!navigator.locks) throw new Error('Wallet storage coordination is unavailable')
  await navigator.locks.request(HYDRATION_LOCK, async () => {
    await hydrate()
    if (!isHydrated()) throw new Error('Wallet metadata could not be loaded')
  })
}
