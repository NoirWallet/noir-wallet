import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AccountData, Network, WalletItem } from '@/types'
import { DEFAULT_NETWORK } from '@/config/networks'
import { createChromeStorageAdapter } from '@/lib/chrome-storage-adapter'
import { clearLendingHomeCache } from '@/core/services/lending-home-cache'
import { getWalletsNeedingSecretPhraseBackup } from '@/core/wallet/secret-phrase-backup'
import {
  removeWalletMetadata,
  resetWalletMetadata,
  refreshWalletMetadata
} from '@/lib/wallet-metadata-storage'

function isValidBackupTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isBackupWallet(value: unknown): value is WalletItem {
  if (!value || typeof value !== 'object') return false
  const wallet = value as Partial<WalletItem>
  return (
    typeof wallet.id === 'string' &&
    typeof wallet.name === 'string' &&
    typeof wallet.seedPhraseKey === 'string' &&
    typeof wallet.createdAt === 'number' &&
    Array.isArray(wallet.accounts) &&
    wallet.accounts.every(
      account =>
        account &&
        typeof account.id === 'string' &&
        typeof account.name === 'string' &&
        typeof account.derivationIndex === 'number'
    )
  )
}

function matchesBackupWallet(left: WalletItem, right: WalletItem): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.seedPhraseKey === right.seedPhraseKey &&
    left.createdAt === right.createdAt &&
    left.keySource === right.keySource &&
    Array.isArray(left.accounts) &&
    Array.isArray(right.accounts) &&
    left.accounts.length === right.accounts.length &&
    left.accounts.every((account, index) => account.id === right.accounts[index]?.id)
  )
}

interface WalletStore {
  // Global pointer state
  currentWalletId: string | null
  currentAccountId: string | null
  currentNetwork: Network

  // Market data
  zecPrice: number

  // Wallet tree (metadata only, no balances)
  wallets: WalletItem[]

  // Account display names map: "walletId_accountId" -> "Custom Name"
  accountDisplayNames: Record<string, string>

  // Actions
  setCurrentWallet: (walletId: string | null) => void
  setCurrentAccount: (walletId: string, accountId: string) => Promise<void>
  setCurrentNetwork: (network: Network) => void
  setZecPrice: (price: number) => void

  setWallets: (wallets: WalletItem[]) => void
  addWallet: (wallet: WalletItem) => Promise<void>
  addWalletAndSelect: (wallet: WalletItem) => Promise<void>
  removeWallet: (walletId: string) => Promise<void>
  updateWallet: (walletId: string, updater: (wallet: WalletItem) => WalletItem) => void
  markWalletBackupVerified: (
    walletId: string,
    verifiedAt: number,
    isSessionCurrent: () => boolean
  ) => Promise<void>
  updateAccountInWallets: (
    walletId: string,
    accountId: string,
    updates: Partial<AccountData>
  ) => void

  setAccountDisplayName: (walletId: string, accountId: string, displayName: string) => void
  getAccountDisplayName: (walletId: string, accountId: string) => string | null

  // Helper getters
  getCurrentAccount: () => AccountData | null
  getCurrentWallet: () => WalletItem | null
  getWallet: (walletId: string) => WalletItem | undefined
  getAccount: (walletId: string, accountId: string) => AccountData | undefined

  // Reset
  reset: () => Promise<void>
}

export const useWalletStore = create<WalletStore>()(
  persist(
    (set, get) => ({
      currentWalletId: null,
      currentAccountId: null,
      currentNetwork: DEFAULT_NETWORK,
      zecPrice: 0,
      wallets: [],
      accountDisplayNames: {},

      setCurrentWallet: walletId => set({ currentWalletId: walletId }),

      setCurrentAccount: async (walletId, accountId) => {
        await set({
          currentWalletId: walletId,
          currentAccountId: accountId
        })
      },

      setCurrentNetwork: network => set({ currentNetwork: network }),

      setZecPrice: price => set({ zecPrice: price }),

      setWallets: wallets => set({ wallets }),

      addWallet: async wallet => {
        await set(state => ({
          wallets: [...state.wallets, wallet]
        }))
      },

      addWalletAndSelect: async wallet => {
        // Persist returns the storage write promise; wait before notifying other contexts.
        await set(state => ({
          wallets: [...state.wallets, wallet],
          currentWalletId: wallet.id,
          currentAccountId: wallet.accounts[0].id
        }))
      },

      removeWallet: async walletId => {
        await removeWalletMetadata(walletId)
        await rehydrateWalletStore()
        void clearLendingHomeCache(walletId).catch(error => {
          console.warn('[WalletStore] Failed to clear lending cache:', error)
        })
      },

      updateWallet: (walletId, updater) =>
        set(state => ({
          wallets: state.wallets.map(w => (w.id === walletId ? updater(w) : w))
        })),

      markWalletBackupVerified: async (walletId, verifiedAt, isSessionCurrent) => {
        if (!Number.isSafeInteger(verifiedAt) || verifiedAt <= 0 || !isSessionCurrent()) {
          throw new Error('Wallet backup verification is no longer available')
        }
        const wallet = get().wallets.find(item => item.id === walletId)
        if (!wallet) throw new Error('Wallet not found')
        const saved = await useWalletStore.persist.getOptions().storage?.getItem('wallet_state')
        const savedWallets: unknown = (saved?.state as Partial<WalletStore> | undefined)?.wallets
        if (
          !Array.isArray(savedWallets) ||
          !savedWallets.every(isBackupWallet) ||
          !isSessionCurrent()
        ) {
          throw new Error('Wallet backup verification is no longer available')
        }
        const latestTarget = savedWallets.find(item => item?.id === walletId)
        if (
          !latestTarget ||
          !matchesBackupWallet(wallet, latestTarget) ||
          (!isValidBackupTime(latestTarget.secretPhraseBackupVerifiedAt) &&
            !getWalletsNeedingSecretPhraseBackup([latestTarget]).length)
        ) {
          throw new Error('Wallet backup verification is no longer available')
        }
        const latestById = new Map(savedWallets.map(item => [item.id, item]))
        const confirmedAt = isValidBackupTime(latestTarget.secretPhraseBackupVerifiedAt)
          ? latestTarget.secretPhraseBackupVerifiedAt
          : verifiedAt
        const previous = isValidBackupTime(latestTarget.secretPhraseBackupVerifiedAt)
          ? latestTarget.secretPhraseBackupVerifiedAt
          : wallet.secretPhraseBackupVerifiedAt
        try {
          // Zustand persist returns the storage write promise from its wrapped setter.
          await set(state => ({
            wallets: state.wallets.map(item => {
              const latest = latestById.get(item.id)
              const latestTime =
                latest && matchesBackupWallet(item, latest)
                  ? latest.secretPhraseBackupVerifiedAt
                  : undefined
              if (item.id === walletId) {
                return { ...item, secretPhraseBackupVerifiedAt: confirmedAt }
              }
              return isValidBackupTime(latestTime)
                ? { ...item, secretPhraseBackupVerifiedAt: latestTime }
                : item
            })
          }))
          if (!isSessionCurrent()) {
            throw new Error('Wallet backup verification is no longer available')
          }
        } catch (error) {
          try {
            await set(state => ({
              wallets: state.wallets.map(item =>
                item.id === walletId && item.secretPhraseBackupVerifiedAt === confirmedAt
                  ? { ...item, secretPhraseBackupVerifiedAt: previous }
                  : item
              )
            }))
          } catch {
            // The in-memory rollback still ran even when storage remains unavailable.
          }
          throw error
        }
      },

      updateAccountInWallets: (walletId, accountId, updates) =>
        set(state => ({
          wallets: state.wallets.map(wallet =>
            wallet.id === walletId
              ? {
                  ...wallet,
                  accounts: wallet.accounts.map(account =>
                    account.id === accountId ? { ...account, ...updates } : account
                  )
                }
              : wallet
          )
        })),

      setAccountDisplayName: (walletId, accountId, displayName) =>
        set(state => {
          const key = `${walletId}_${accountId}`
          return {
            accountDisplayNames: {
              ...state.accountDisplayNames,
              [key]: displayName
            }
          }
        }),

      getAccountDisplayName: (walletId, accountId) => {
        const key = `${walletId}_${accountId}`
        return get().accountDisplayNames[key] || null
      },

      getCurrentAccount: () => {
        const { currentWalletId, currentAccountId, wallets } = get()
        if (!currentWalletId || !currentAccountId) return null

        const wallet = wallets.find(w => w.id === currentWalletId)
        if (!wallet) return null

        return wallet.accounts.find(a => a.id === currentAccountId) || null
      },

      getCurrentWallet: () => {
        const { currentWalletId, wallets } = get()
        if (!currentWalletId) return null
        return wallets.find(w => w.id === currentWalletId) || null
      },

      getWallet: walletId => get().wallets.find(w => w.id === walletId),

      getAccount: (walletId, accountId) => {
        const wallet = get().wallets.find(w => w.id === walletId)
        return wallet?.accounts.find(a => a.id === accountId)
      },

      reset: async () => {
        await resetWalletMetadata()
        await rehydrateWalletStore()
        void clearLendingHomeCache().catch(error => {
          console.warn('[WalletStore] Failed to clear lending cache:', error)
        })
      }
    }),
    {
      name: 'wallet_state',
      storage: createChromeStorageAdapter('local') as any,
      partialize: state => ({
        currentWalletId: state.currentWalletId,
        currentAccountId: state.currentAccountId,
        currentNetwork: state.currentNetwork,
        zecPrice: state.zecPrice,
        wallets: state.wallets,
        accountDisplayNames: state.accountDisplayNames
      }),
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<WalletStore>) }
        return {
          ...state,
          wallets: state.wallets.map(wallet => {
            const legacyHardwareName =
              wallet.keySource === 'ledger'
                ? 'Ledger Account'
                : wallet.keySource === 'keystone'
                  ? 'Keystone Account'
                  : undefined
            return {
              ...wallet,
              accounts: wallet.accounts.map(account => ({
                ...account,
                // Old hardware imports saved the chosen name only on the wallet.
                name:
                  legacyHardwareName &&
                  wallet.accounts.length === 1 &&
                  account.name === legacyHardwareName &&
                  wallet.name.trim() &&
                  !state.accountDisplayNames[`${wallet.id}_${account.id}`]
                    ? wallet.name.trim()
                    : account.name,
                isPinned: account.isPinned ?? false,
                isHidden: account.isHidden ?? false
              }))
            }
          })
        }
      }
    }
  )
)

/**
 * Wait for initial hydration from chrome.storage to complete.
 * Must be called before reading store state to avoid seeing stale defaults.
 */
export async function waitForHydration(): Promise<void> {
  if (useWalletStore.persist.hasHydrated()) return
  // Initial automatic hydration can fail without emitting onFinishHydration.
  // An explicit refresh provides a terminal failure instead of waiting forever.
  await rehydrateWalletStore()
}

/**
 * Force re-read store state from chrome.storage.
 * Used by background service worker to sync state written by popup.
 */
export async function rehydrateWalletStore(): Promise<void> {
  await refreshWalletMetadata(
    () => useWalletStore.persist.rehydrate(),
    () => useWalletStore.persist.hasHydrated()
  )
}

/**
 * Migrate legacy `walletData` key into the unified `wallet_state` store.
 * Called once on extension startup from background.
 */
export async function migrateWalletDataIfNeeded(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('walletData')
    const legacy = result.walletData
    if (!legacy?.wallets) return

    const store = useWalletStore.getState()

    if (store.wallets.length > 0) {
      await chrome.storage.local.remove('walletData')
      return
    }

    store.setWallets(legacy.wallets)
    if (legacy.currentWalletId) {
      store.setCurrentWallet(legacy.currentWalletId)
    }
    if (legacy.currentWalletId && legacy.currentAccountId) {
      store.setCurrentAccount(legacy.currentWalletId, legacy.currentAccountId)
    }
    if (legacy.network) {
      store.setCurrentNetwork(legacy.network)
    }

    await chrome.storage.local.remove('walletData')
    console.log('[WalletStore] Migrated legacy walletData → wallet_state')
  } catch (e) {
    console.error('[WalletStore] Migration error:', e)
  }
}
