import { withMetadataLock, WALLET_STATE_KEY } from './wallet-metadata-storage'

export const ACCOUNT_DATA_KEY = 'account_data'
const CONTEXT_KEYS = [
  WALLET_STATE_KEY,
  'wallet_deleted_ids',
  'wallet_cleanup_pending_ids',
  'wallet_deleted_account_keys'
]

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parse(value: unknown): Record<string, unknown> | null {
  return record(typeof value === 'string' ? JSON.parse(value) : value)
}

function filteredCache(value: unknown, context: Record<string, unknown>): unknown {
  if (value == null) return null
  const cache = parse(value)
  const state = record(cache?.state)
  if (!cache || !state) throw new Error('Account cache is unavailable')
  const metadata = record(parse(context[WALLET_STATE_KEY])?.state)
  const blockedWallets = new Set([
    ...(Array.isArray(context.wallet_deleted_ids) ? context.wallet_deleted_ids : []),
    ...(Array.isArray(context.wallet_cleanup_pending_ids) ? context.wallet_cleanup_pending_ids : [])
  ])
  const blockedAccounts = new Set(
    Array.isArray(context.wallet_deleted_account_keys) ? context.wallet_deleted_account_keys : []
  )
  const accounts = new Set<string>()
  const wallets = new Set<string>()
  for (const entry of Array.isArray(metadata?.wallets) ? metadata.wallets : []) {
    const wallet = record(entry)
    if (typeof wallet?.id !== 'string' || blockedWallets.has(wallet.id)) continue
    for (const network of ['mainnet', 'testnet']) {
      wallets.add(`${network}_${wallet.id}`)
      for (const item of Array.isArray(wallet.accounts) ? wallet.accounts : []) {
        const account = record(item)
        if (typeof account?.id !== 'string') continue
        const key = `${network}_${wallet.id}_${account.id}`
        if (!blockedAccounts.has(key)) accounts.add(key)
      }
    }
  }
  const filter = (entries: unknown, allowWallet: boolean) =>
    Object.fromEntries(
      Object.entries(record(entries) ?? {}).filter(
        ([key]) => accounts.has(key) || (allowWallet && wallets.has(key))
      )
    )
  const filtered = {
    ...cache,
    state: {
      ...state,
      balances: filter(state.balances, false),
      syncStates: filter(state.syncStates, true)
    }
  }
  return typeof value === 'string' ? JSON.stringify(filtered) : filtered
}

/** Serializes cache writes with deletion so an older popup cannot restore removed data. */
export function writeAccountData(
  storage: chrome.storage.StorageArea,
  value: unknown
): Promise<void> {
  return withMetadataLock(async () => {
    const context = await storage.get(CONTEXT_KEYS)
    await storage.set({ [ACCOUNT_DATA_KEY]: filteredCache(value, context) })
  })
}

export function readAccountData(storage: chrome.storage.StorageArea): Promise<unknown> {
  return withMetadataLock(async () => {
    const context = await storage.get([...CONTEXT_KEYS, ACCOUNT_DATA_KEY])
    return filteredCache(context[ACCOUNT_DATA_KEY], context)
  })
}
