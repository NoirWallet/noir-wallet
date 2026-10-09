import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useLocation } from '../provider/Router'
import { useWalletStore, waitForHydration } from '@/store/wallet-store'
import { useSettingsStore } from '@/store/settings-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { useOnboardingStore } from '@/store/onboarding-store'
import { accountManager } from '@/core/wallet/account-manager'
import { toast } from '@/store/toast-store'
import { needsUnlock } from '@/lib/lock-utils'
import { SecureStorage } from '@/core/wallet/secure-storage'
import { sleep } from '@/lib/utils'
import { ANALYTICS_EVENTS, sendAnalyticsEvent } from '@/lib/analytics'
import { getTransactionToastCopy } from '@/lib/transaction-status-copy'
import { didWalletSessionEnd } from '@/core/wallet/session-state'

/**
 * Custom hook for application routing logic
 * Handles both normal popup windows and dApp-triggered windows
 */
export function useAppRouting() {
  const { replace } = useNavigate()
  const location = useLocation()
  const [isLoading, setIsLoading] = useState(true)

  const { currentWalletId, currentAccountId, getCurrentAccount, setCurrentAccount } =
    useWalletStore()
  const { autoLockMs, loadSettings } = useSettingsStore()
  const { getPendingNotifications, markAsNotified } = useAccountDataStore()

  const currentAccount = getCurrentAccount()

  const lastVisibleTimeRef = useRef<number>(Date.now())

  // Detect if this is a dApp-triggered window
  const isDApp = useRef(
    (() => {
      const hash = window.location.hash.slice(1)
      return hash.includes('approval') || hash.includes('from=dapp') || hash.includes('requestId=')
    })()
  )

  // Hardware wallet flows (connect/sign) run in a dedicated full tab and must
  // keep their route across init and unlock redirects
  const isHardwareTab = useRef(window.location.hash.includes('/hardware/'))
  const isUpdatePage = useRef(window.location.hash.includes('/update'))

  const routeToUnlock = useCallback(() => {
    if (!currentAccount || location.pathname === '/unlock') return
    if (isDApp.current) {
      window.close()
      return
    }
    const target = `${location.pathname}${location.search || ''}`
    replace(`/unlock?redirect=${encodeURIComponent(target)}`)
  }, [currentAccount, location.pathname, location.search, replace])

  // Auto-lock handler
  const handleAutoLock = useCallback(async () => {
    const isLocked = accountManager.isLocked()

    if (!isLocked && currentAccount) {
      try {
        sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_LOCKED, { extra: { reason: 'auto' } })
        await accountManager.lock()
        chrome.runtime.sendMessage({ type: 'WALLET_LOCKED' }).catch(() => {})
        routeToUnlock()
      } catch {
        // Keep the current route when locking fails.
      }
    }
  }, [currentAccount, routeToUnlock])

  useEffect(() => {
    const handleSessionChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (!didWalletSessionEnd(changes, areaName)) return
      void accountManager.lock().finally(routeToUnlock)
    }

    chrome.storage.onChanged.addListener(handleSessionChange)
    return () => chrome.storage.onChanged.removeListener(handleSessionChange)
  }, [routeToUnlock])

  // Visibility-based lock: checks elapsed hidden time when popup regains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        lastVisibleTimeRef.current = Date.now()
      } else {
        const hiddenDuration = Date.now() - lastVisibleTimeRef.current
        if (autoLockMs > 0 && !accountManager.isLocked() && currentAccount) {
          if (hiddenDuration >= autoLockMs) {
            void handleAutoLock()
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [autoLockMs, currentAccount, handleAutoLock])

  // Idle detection: lock after autoLockMs of no user interaction while popup is open
  useEffect(() => {
    const isLocked = accountManager.isLocked()
    if (autoLockMs <= 0 || isLocked || !currentAccount) return

    let idleTimer: ReturnType<typeof setTimeout>

    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      SecureStorage.saveLastActivityTime().catch(() => {})
      idleTimer = setTimeout(() => {
        void handleAutoLock()
      }, autoLockMs)
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(event => document.addEventListener(event, resetIdleTimer, { passive: true }))
    resetIdleTimer()

    return () => {
      clearTimeout(idleTimer)
      events.forEach(event => document.removeEventListener(event, resetIdleTimer))
    }
  }, [autoLockMs, currentAccount, handleAutoLock])

  // Load settings
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Show transaction notifications
  useEffect(() => {
    const showNotifications = async () => {
      const pendingNotifications = getPendingNotifications()
      for (const tx of pendingNotifications) {
        if (tx.status === 'success') {
          const copy = getTransactionToastCopy('success', tx.amount)
          toast.success(copy.title, copy.message)
        } else if (tx.status === 'failed') {
          const copy = getTransactionToastCopy('failed', tx.amount)
          toast.error(copy.title, copy.message)
        }
        await markAsNotified(tx.id)
      }
    }
    showNotifications()
  }, [getPendingNotifications, markAsNotified])

  // Initialize wallet
  useEffect(() => {
    // CRITICAL: Extract requestId BEFORE navigation
    if (isDApp.current) {
      const hash = window.location.hash.slice(1)
      if (hash.includes('requestId=')) {
        const hashParams = hash.includes('?') ? hash.split('?')[1] : ''
        const searchParams = new URLSearchParams(hashParams)
        const requestId = searchParams.get('requestId')
        if (requestId) {
          const { setDappRequestId } = useOnboardingStore.getState()
          setDappRequestId(requestId)
        }
      }
    }

    // Use unified check for all windows
    checkWalletStatus()
  }, [])

  // Redirect from unlock to home for normal popup windows
  useEffect(() => {
    if (
      !isDApp.current &&
      !isHardwareTab.current &&
      !accountManager.isLocked() &&
      currentAccount &&
      location.pathname === '/unlock'
    ) {
      replace('/')
    }
  }, [currentAccount, location.pathname, replace])

  useEffect(() => {
    if (
      isLoading ||
      isDApp.current ||
      isHardwareTab.current ||
      location.pathname !== '/onboarding' ||
      !currentWalletId ||
      !currentAccountId
    ) {
      return
    }

    let cancelled = false
    const enterWallet = async () => {
      try {
        await accountManager.initialize()
        const unlockNeeded = await needsUnlock()
        if (!cancelled) {
          replace(unlockNeeded ? '/unlock?redirect=%2F' : '/')
        }
      } catch (error) {
        console.error('[useAppRouting] Failed to open newly created wallet:', error)
      }
    }

    enterWallet()
    return () => {
      cancelled = true
    }
  }, [currentAccountId, currentWalletId, isLoading, location.pathname, replace])

  /**
   * Unified wallet initialization for all window types
   * Handles both normal popup and dApp-triggered windows
   */
  const checkWalletStatus = async () => {
    const startTime = Date.now()
    const minLoadingDuration = isDApp.current ? 500 : 1000

    try {
      await waitForHydration()
      await loadSettings()

      if (isUpdatePage.current) {
        return
      }

      await accountManager.initialize()

      if (useWalletStore.getState().wallets.length === 0) {
        // Hardware connect tab handles the first-wallet case itself
        // (collects a password during setup)
        if (isHardwareTab.current) {
          return
        }

        // Preserve requestId for dApp flow
        if (isDApp.current) {
          const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
          const requestId = urlParams.get('requestId')
          if (requestId) {
            replace(`/onboarding?requestId=${requestId}`)
            return
          }
        }

        replace('/onboarding')
        return
      }

      // Use unified lock check
      const unlockNeeded = await needsUnlock()

      if (unlockNeeded) {
        // Build redirect URL with current route and parameters
        const currentPath = location.pathname
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
        const requestId = urlParams.get('requestId')

        const redirectParams = new URLSearchParams()

        // For dApp windows, redirect back to original route
        if (isDApp.current && currentPath !== '/unlock') {
          redirectParams.set('redirect', currentPath)
          if (requestId) {
            redirectParams.set('requestId', requestId)
          }
        } else if (isHardwareTab.current && currentPath !== '/unlock') {
          // Hardware tabs must return to their flow (with query, e.g. sign request id)
          redirectParams.set('redirect', `${currentPath}${location.search || ''}`)
        } else {
          // For normal popup, redirect to home
          redirectParams.set('redirect', '/')
        }

        replace(`/unlock?${redirectParams.toString()}`)
        return
      }

      {
        const { currentWalletId: cwid, currentAccountId: caid } = useWalletStore.getState()
        if (cwid && caid) {
          setCurrentAccount(cwid, caid)
        }
      }

      // Save activity time after successful unlock/init
      // This ensures activity time is updated even if user closes popup immediately
      await SecureStorage.saveLastActivityTime()

      // dApp windows and hardware tabs stay on their route; normal popup goes home
      if (!isDApp.current && !isHardwareTab.current) {
        replace('/')
      }
    } catch (error) {
      console.error('[useAppRouting] Initialization error:', error)
      // A read failure is not evidence of an empty installation.
      toast.error('Unable to open wallet', 'Restart the extension and try again.')
      replace('/unlock')
    } finally {
      const elapsed = Date.now() - startTime
      const remainingTime = Math.max(0, minLoadingDuration - elapsed)
      if (remainingTime > 0) {
        await sleep(remainingTime)
      }
      setIsLoading(false)
    }
  }

  return { isLoading }
}
