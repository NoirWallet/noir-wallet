import { useEffect, useSyncExternalStore } from 'react'
import { SETTINGS_STORAGE_KEY, useSettingsStore } from '@/store/settings-store'
import { useTransactionResultStore } from '@/store/transaction-result-store'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { getOwnExtensionSenderContext } from '@/lib/runtime-message-security'
import type { SyncStateSnapshot } from '@/background/sync-scheduler'

const WALLET_STORAGE_KEY = 'wallet_state'
type BalanceReadStatus = 'loading' | 'available' | 'error'
let balanceReadState: Readonly<{ scope: string; status: BalanceReadStatus }> = {
  scope: '',
  status: 'loading'
}
const balanceReadListeners = new Set<() => void>()
const balanceReads = new Map<string, Promise<void>>()
const balancePushRevisions = new Map<string, number>()

function setBalanceReadState(scope: string, status: BalanceReadStatus): void {
  if (balanceReadState.scope === scope && balanceReadState.status === status) return
  balanceReadState = { scope, status }
  balanceReadListeners.forEach(listener => listener())
}

export function useZcashBalanceReadStatus(
  network: string,
  walletId: string | null,
  accountId: string | null
) {
  const state = useSyncExternalStore(
    listener => {
      balanceReadListeners.add(listener)
      return () => balanceReadListeners.delete(listener)
    },
    () => balanceReadState
  )
  const scope = `${network}:${walletId ?? ''}:${accountId ?? ''}`
  return state.scope === scope ? state.status : 'loading'
}

export function retryZcashBalanceRead(
  network: string,
  walletId: string,
  accountId: string
): Promise<void> {
  const scope = `${network}:${walletId}:${accountId}`
  const existing = balanceReads.get(scope)
  if (existing) return existing
  const pushRevision = balancePushRevisions.get(scope) ?? 0
  setBalanceReadState(scope, 'loading')
  const request = chrome.runtime
    .sendMessage({ type: 'GET_SYNC_STATE', walletId, accountId })
    .then((snapshot: Partial<SyncStateSnapshot>) => {
      const current = useWalletStore.getState()
      if (
        current.currentNetwork !== network ||
        current.currentWalletId !== walletId ||
        current.currentAccountId !== accountId ||
        (balancePushRevisions.get(scope) ?? 0) !== pushRevision
      )
        return
      if (snapshot.walletId !== walletId || snapshot.accountId !== accountId || !snapshot.balance) {
        if (balanceReadState.scope === scope && balanceReadState.status !== 'available')
          setBalanceReadState(scope, 'error')
        return
      }
      useAccountDataStore.getState().setBalanceFor(network, walletId, accountId, snapshot.balance)
      setBalanceReadState(scope, 'available')
    })
    .catch(() => {
      if (
        (balancePushRevisions.get(scope) ?? 0) === pushRevision &&
        balanceReadState.scope === scope &&
        balanceReadState.status !== 'available'
      )
        setBalanceReadState(scope, 'error')
    })
    .finally(() => balanceReads.delete(scope))
  balanceReads.set(scope, request)
  return request
}

function readWalletScope(): string | null {
  const { currentWalletId, currentAccountId } = useWalletStore.getState()
  return currentWalletId && currentAccountId ? `${currentWalletId}:${currentAccountId}` : null
}

/** Keeps long-lived extension pages aligned with authoritative Background writes. */
export function usePersistedExtensionContextSync(): void {
  const walletId = useWalletStore(state => state.currentWalletId)
  const accountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)

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

  useEffect(() => {
    if (!walletId || !accountId) return
    let cancelled = false
    const applyBalance = (snapshot: Partial<SyncStateSnapshot>) => {
      const current = useWalletStore.getState()
      if (
        cancelled ||
        current.currentNetwork !== network ||
        current.currentWalletId !== walletId ||
        current.currentAccountId !== accountId ||
        snapshot.walletId !== walletId ||
        snapshot.accountId !== accountId ||
        !snapshot.balance
      ) {
        return
      }
      const scope = `${network}:${walletId}:${accountId}`
      balancePushRevisions.set(scope, (balancePushRevisions.get(scope) ?? 0) + 1)
      useAccountDataStore.getState().setBalanceFor(network, walletId, accountId, snapshot.balance)
      setBalanceReadState(scope, 'available')
    }
    const listener = (
      message: Partial<SyncStateSnapshot> & { type?: string },
      sender: chrome.runtime.MessageSender
    ) => {
      if (getOwnExtensionSenderContext(sender, chrome.runtime.id) !== 'service-worker') return
      if (
        message.type !== 'SYNC_PROGRESS' ||
        message.walletId !== walletId ||
        message.accountId !== accountId ||
        !message.balance
      ) {
        return
      }
      applyBalance(message)
    }

    chrome.runtime.onMessage.addListener(listener)
    const scope = `${network}:${walletId}:${accountId}`
    if (useAccountDataStore.getState().getBalance(network, walletId, accountId)) {
      setBalanceReadState(scope, 'available')
    } else {
      void retryZcashBalanceRead(network, walletId, accountId)
    }
    return () => {
      cancelled = true
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [walletId, accountId, network])
}
