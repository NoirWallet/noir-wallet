import { useCallback, useEffect, useState } from 'react'
import {
  accountNetworksClient,
  type AccountNetworksCatalogView,
  type AccountNetworksView
} from '../services/account-networks-client'
import { useWalletStore } from '@/store/wallet-store'

export function useActiveAccountNetworks() {
  const [catalog, setCatalog] = useState<AccountNetworksCatalogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setCatalog(await accountNetworksClient.getCatalog())
    } catch {
      setCatalog(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Do not expose the previous Account's native catalog while the authoritative
    // Wallet pointer is being reloaded. Consumers otherwise keep using the stale
    // Storage V2 Account and fail to cancel account-scoped reviews immediately.
    setCatalog(null)
    void refresh()
  }, [currentWalletId, currentAccountId, refresh])

  const activeAccount: AccountNetworksView | null =
    catalog?.accounts.find(account => account.active) ?? null

  return Object.freeze({ catalog, activeAccount, loading, error, refresh })
}
