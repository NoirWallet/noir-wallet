import { useEffect } from 'react'
import { useLendingStore } from '@/store/lending-store'
import { SETTINGS_STORAGE_KEY, useSettingsStore } from '@/store/settings-store'
import { useTransactionResultStore } from '@/store/transaction-result-store'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'

const WALLET_STORAGE_KEY = 'wallet_state'

function readWalletScope(): string | null {
  const { currentWalletId, currentAccountId } = useWalletStore.getState()
  return currentWalletId && currentAccountId ? `${currentWalletId}:${currentAccountId}` : null
}

/** Keeps long-lived extension pages aligned with authoritative Background writes. */
export function usePersistedExtensionContextSync(): void {
  useEffect(() => {
    let queue: Promise<void> = Promise.resolve()

    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local') return
      const walletChanged = Object.prototype.hasOwnProperty.call(changes, WALLET_STORAGE_KEY)
      const settingsChanged = Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY)
      if (!walletChanged && !settingsChanged) return

      queue = queue
        .catch(() => {})
        .then(async () => {
          const previousWalletScope = readWalletScope()
          if (walletChanged) await rehydrateWalletStore()
          if (settingsChanged) await useSettingsStore.persist.rehydrate()

          if (walletChanged && readWalletScope() !== previousWalletScope) {
            useLendingStore.getState().reset()
            useTransactionResultStore.getState().clear()
          }
        })
        .catch(error => {
          console.error('[Popup] Failed to synchronize persisted wallet context:', error)
        })
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged)
  }, [])
}
