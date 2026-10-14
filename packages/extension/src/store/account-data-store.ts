import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ZcashBalance, Transaction, Network, SyncReason } from '@/types'
import { createChromeStorageAdapter } from '@/lib/chrome-storage-adapter'
import { useWalletStore } from './wallet-store'
import { safeBig } from '@/lib/big'
import {
  loadTransactions,
  mutateTransactions,
  deleteTransactions,
  deleteTransparentTxCache
} from '@/lib/indexed-db'
import { formatNumber } from '@/lib/format'
import Big from 'big.js'
import { mergeTransactionUpdate } from '@/lib/transaction-status'
import { getTransactionStatusCopy } from '@/lib/transaction-status-copy'
import { migrateAccountDataState, rehydrateAccountDataState } from '@/lib/account-balance-migration'

const EMPTY_TRANSACTIONS: Transaction[] = []
const ACCOUNT_DATA_VERSION = 2

/**
 * Sync state for blockchain synchronization
 */
export interface SyncState {
  isSyncing: boolean
  syncProgress: number // 0-100
  currentHeight: number
  latestHeight: number
  lastSyncTime: number | null
  /** Estimated remaining time in milliseconds, null if not enough data */
  etaMs: number | null
  syncReason?: SyncReason | null
}

const DEFAULT_SYNC_STATE: SyncState = {
  isSyncing: false,
  syncProgress: 0,
  currentHeight: 0,
  latestHeight: 0,
  lastSyncTime: null,
  etaMs: null,
  syncReason: null
}

/**
 * Builds storage key for account-specific data
 * Format: ${network}_${walletId}_${accountId}
 */
export function buildAccountKey(network: Network, walletId: string, accountId: string): string {
  return `${network}_${walletId}_${accountId}`
}

export function buildWalletKey(network: Network, walletId: string): string {
  return `${network}_${walletId}`
}

/**
 * Account-specific data store
 * Stores balance, sync state, and transactions per account + network
 */
interface AccountDataStore {
  // Keyed storage: Map<accountKey, data>
  balances: Map<string, ZcashBalance>
  syncStates: Map<string, SyncState>

  // Transactions cache (in-memory, backed by IndexedDB)
  transactionsCache: Map<string, Transaction[]>
  transactionsLoaded: Set<string>

  // Computed getters (use current wallet/account/network from wallet-store)
  getCurrentBalance: () => ZcashBalance | null
  getCurrentBalanceUsd: () => number
  getCurrentSyncState: () => SyncState
  getCurrentTransactions: () => Transaction[]
  getTransactions: (accountKey: string) => Transaction[]

  // Explicit getters (for any account)
  getBalance: (network: Network, walletId: string, accountId: string) => ZcashBalance | null
  getSyncState: (network: Network, walletId: string, accountId: string) => SyncState
  getWalletSyncState: (network: Network, walletId: string) => SyncState
  getBalanceUsd: (walletId: string, accountId: string) => number

  // Setters (auto-key by current account + network)
  setBalance: (balance: ZcashBalance) => void
  setSyncState: (syncState: Partial<SyncState>) => void
  setIsSyncing: (isSyncing: boolean) => void
  setSyncProgress: (progress: number) => void
  setHeightInfo: (current: number, latest: number) => void
  setLastSyncTime: (time: number) => void

  // Transaction management (with IndexedDB persistence)
  loadTransactions: () => Promise<void>
  reloadTransactions: (accountKey: string) => Promise<void>
  addTransaction: (tx: Omit<Transaction, 'id'>) => Promise<Transaction>
  addTransactionForAccount: (
    accountKey: string,
    tx: Omit<Transaction, 'id'>
  ) => Promise<Transaction>
  updateTransaction: (id: string, updates: Partial<Transaction>) => Promise<void>
  updateTransactionForAccount: (
    accountKey: string,
    id: string,
    updates: Partial<Transaction>
  ) => Promise<void>
  markAsNotified: (id: string) => Promise<void>
  getPendingNotifications: () => Transaction[]
  clearTransactions: () => Promise<void>

  // Explicit setters with account key (for non-current accounts)
  setBalanceFor: (
    network: Network,
    walletId: string,
    accountId: string,
    balance: ZcashBalance
  ) => void
  setSyncStateFor: (
    network: Network,
    walletId: string,
    accountId: string,
    syncState: Partial<SyncState>
  ) => void
  setWalletSyncStateFor: (network: Network, walletId: string, syncState: Partial<SyncState>) => void

  // Cleanup
  deleteAccountData: (network: Network, walletId: string, accountId: string) => Promise<void>
  reset: () => void
}

export const useAccountDataStore = create<AccountDataStore>()(
  persist(
    (set, get) => ({
      balances: new Map(),
      syncStates: new Map(),
      transactionsCache: new Map(),
      transactionsLoaded: new Set(),

      // Get current account key from wallet-store
      _getCurrentKey: (): string | null => {
        const { currentWalletId, currentAccountId, currentNetwork } = useWalletStore.getState()
        if (!currentWalletId || !currentAccountId) return null
        return buildAccountKey(currentNetwork, currentWalletId, currentAccountId)
      },

      _getCurrentWalletKey: (): string | null => {
        const { currentWalletId, currentNetwork } = useWalletStore.getState()
        if (!currentWalletId) return null
        return buildWalletKey(currentNetwork, currentWalletId)
      },

      getCurrentBalance: () => {
        const key = (get() as any)._getCurrentKey()
        if (!key) return null
        return get().balances.get(key) || null
      },

      getCurrentBalanceUsd: () => {
        const balance = get().getCurrentBalance()
        if (!balance?.total) return 0
        const zecPrice = useWalletStore.getState().zecPrice
        return safeBig(balance.total).times(zecPrice).toNumber()
      },

      getCurrentSyncState: () => {
        const key = (get() as any)._getCurrentWalletKey()
        if (!key) return DEFAULT_SYNC_STATE
        return get().syncStates.get(key) || DEFAULT_SYNC_STATE
      },

      getCurrentTransactions: () => {
        const key = (get() as any)._getCurrentKey()
        if (!key) return EMPTY_TRANSACTIONS
        const transactions = get().transactionsCache.get(key)
        return Array.isArray(transactions) ? transactions : EMPTY_TRANSACTIONS
      },

      getTransactions: accountKey => {
        const transactions = get().transactionsCache.get(accountKey)
        return Array.isArray(transactions) ? transactions : EMPTY_TRANSACTIONS
      },

      getBalance: (network, walletId, accountId) => {
        const key = buildAccountKey(network, walletId, accountId)
        return get().balances.get(key) || null
      },

      getSyncState: (network, walletId, accountId) => {
        const key = buildAccountKey(network, walletId, accountId)
        return get().syncStates.get(key) || DEFAULT_SYNC_STATE
      },

      getWalletSyncState: (network, walletId) => {
        const key = buildWalletKey(network, walletId)
        return get().syncStates.get(key) || DEFAULT_SYNC_STATE
      },

      getBalanceUsd: (walletId, accountId) => {
        const { currentNetwork, zecPrice } = useWalletStore.getState()
        const key = buildAccountKey(currentNetwork, walletId, accountId)
        const balance = get().balances.get(key)
        if (!balance?.total) return 0
        return safeBig(balance.total).times(zecPrice).toNumber()
      },

      setBalance: balance => {
        const key = (get() as any)._getCurrentKey()
        if (!key) return

        set(state => {
          const newBalances = new Map(state.balances)
          newBalances.set(key, balance)
          return { balances: newBalances }
        })
      },

      setSyncState: syncState => {
        const key = (get() as any)._getCurrentWalletKey()
        if (!key) return

        set(state => {
          const newSyncStates = new Map(state.syncStates)
          const current = newSyncStates.get(key) || DEFAULT_SYNC_STATE
          newSyncStates.set(key, { ...current, ...syncState })
          return { syncStates: newSyncStates }
        })
      },

      setIsSyncing: isSyncing => {
        get().setSyncState({ isSyncing })
      },

      setSyncProgress: progress => {
        get().setSyncState({ syncProgress: progress })
      },

      setHeightInfo: (current, latest) => {
        get().setSyncState({ currentHeight: current, latestHeight: latest })
      },

      setLastSyncTime: time => {
        get().setSyncState({ lastSyncTime: time })
      },

      loadTransactions: async () => {
        const key = (get() as any)._getCurrentKey()
        if (!key) return

        if (get().transactionsLoaded.has(key)) {
          return
        }

        try {
          const transactions = await loadTransactions(key)
          set(state => {
            const newCache = new Map(state.transactionsCache)
            const newLoaded = new Set(state.transactionsLoaded)
            newCache.set(key, transactions)
            newLoaded.add(key)
            return {
              transactionsCache: newCache,
              transactionsLoaded: newLoaded
            }
          })
        } catch (error) {
          console.error('[AccountDataStore] Failed to load transactions:', error)
        }
      },

      reloadTransactions: async (accountKey: string) => {
        try {
          console.log('[AccountDataStore] Reloading transactions for:', accountKey)

          set(state => {
            const newLoaded = new Set(state.transactionsLoaded)
            newLoaded.delete(accountKey)
            return { transactionsLoaded: newLoaded }
          })

          const transactions = await loadTransactions(accountKey)
          set(state => {
            const newCache = new Map(state.transactionsCache)
            const newLoaded = new Set(state.transactionsLoaded)
            newCache.set(accountKey, transactions)
            newLoaded.add(accountKey)
            return {
              transactionsCache: newCache,
              transactionsLoaded: newLoaded
            }
          })

          console.log('[AccountDataStore] Transactions reloaded:', transactions.length)
        } catch (error) {
          console.error('[AccountDataStore] Failed to reload transactions:', error)
        }
      },

      addTransaction: async tx => {
        const key = (get() as any)._getCurrentKey()
        if (!key) throw new Error('No current account')
        return get().addTransactionForAccount(key, tx)
      },

      addTransactionForAccount: async (accountKey, tx) => {
        const id = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const newTx: Transaction = { ...tx, id }
        const allTxs = await mutateTransactions(accountKey, current => [...current, newTx])

        set(state => {
          const newCache = new Map(state.transactionsCache)
          newCache.set(accountKey, allTxs)
          return { transactionsCache: newCache }
        })

        return newTx
      },

      updateTransaction: async (id, updates) => {
        const key = (get() as any)._getCurrentKey()
        if (!key) return
        await get().updateTransactionForAccount(key, id, updates)
      },

      updateTransactionForAccount: async (accountKey, id, updates) => {
        const allTxs = await mutateTransactions(accountKey, current =>
          current.map(tx => (tx.id === id ? mergeTransactionUpdate(tx, updates) : tx))
        )

        set(state => {
          const newCache = new Map(state.transactionsCache)
          newCache.set(accountKey, allTxs)
          return { transactionsCache: newCache }
        })
      },

      markAsNotified: async id => {
        await get().updateTransaction(id, { notified: true })
      },

      getPendingNotifications: () => {
        const txs = get().getCurrentTransactions()
        return txs.filter(tx => (tx.status === 'success' || tx.status === 'failed') && !tx.notified)
      },

      clearTransactions: async () => {
        const key = (get() as any)._getCurrentKey()
        if (!key) return
        await mutateTransactions(key, () => [])

        set(state => {
          const newCache = new Map(state.transactionsCache)
          newCache.set(key, [])
          return { transactionsCache: newCache }
        })
      },

      setBalanceFor: (network, walletId, accountId, balance) => {
        const key = buildAccountKey(network, walletId, accountId)
        set(state => {
          const newBalances = new Map(state.balances)
          newBalances.set(key, balance)
          return { balances: newBalances }
        })
      },

      setSyncStateFor: (network, walletId, accountId, syncState) => {
        const key = buildAccountKey(network, walletId, accountId)
        set(state => {
          const newSyncStates = new Map(state.syncStates)
          const current = newSyncStates.get(key) || DEFAULT_SYNC_STATE
          newSyncStates.set(key, { ...current, ...syncState })
          return { syncStates: newSyncStates }
        })
      },

      setWalletSyncStateFor: (network, walletId, syncState) => {
        const key = buildWalletKey(network, walletId)
        set(state => {
          const newSyncStates = new Map(state.syncStates)
          const current = newSyncStates.get(key) || DEFAULT_SYNC_STATE
          newSyncStates.set(key, { ...current, ...syncState })
          return { syncStates: newSyncStates }
        })
      },

      deleteAccountData: async (network, walletId, accountId) => {
        const key = buildAccountKey(network, walletId, accountId)

        set(state => {
          const newBalances = new Map(state.balances)
          const newSyncStates = new Map(state.syncStates)
          const newCache = new Map(state.transactionsCache)
          const newLoaded = new Set(state.transactionsLoaded)

          newBalances.delete(key)
          newSyncStates.delete(key)
          newCache.delete(key)
          newLoaded.delete(key)

          return {
            balances: newBalances,
            syncStates: newSyncStates,
            transactionsCache: newCache,
            transactionsLoaded: newLoaded
          }
        })

        await Promise.all([deleteTransactions(key), deleteTransparentTxCache(key)])
      },

      reset: () => {
        set({
          balances: new Map(),
          syncStates: new Map(),
          transactionsCache: new Map(),
          transactionsLoaded: new Set()
        })
      }
    }),
    {
      name: 'account_data',
      version: ACCOUNT_DATA_VERSION,
      storage: createChromeStorageAdapter('local') as any,
      migrate: (persisted, version) => migrateAccountDataState(persisted, version) as any,
      merge: (persisted, current) => rehydrateAccountDataState(persisted, current) as any,
      partialize: state =>
        ({
          balances: Object.fromEntries(state.balances),
          syncStates: Object.fromEntries(state.syncStates)
        }) as any
    }
  )
)

/** Formats transaction for UI display. */
export function formatTransactionForDisplay(tx: Transaction) {
  const isIncoming = tx.type === 'receive' || tx.type === 'withdraw' || tx.type === 'claim'
  const statusCopy = getTransactionStatusCopy(tx)

  return {
    id: tx.id,
    type: tx.type,
    amount: `${isIncoming ? '+' : '-'}${formatNumber(tx.amount, { rm: Big.roundDown })} ZEC`,
    status: statusCopy.label,
    statusKey: statusCopy.key,
    statusTone: statusCopy.tone,
    statusDescription: statusCopy.description,
    date: new Date(tx.timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }),
    time: new Date(tx.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    txHash: tx.txHash
  }
}
