import { useEffect } from 'react'
import { ToastContainer } from './components/common/ToastContainer'
import { RouterProvider, Routes, Route, useLocation, useNavigate } from './provider/Router'
import { SecretPhraseBackupBanner } from './components/common/SecretPhraseBackupBanner'
import { ModalProvider } from './provider/ModalManager'
import { DialogProvider } from './hooks/useDialog'
import { WalletInitializing } from './components/ui/wallet-initializing'
import { useAppRouting } from './hooks/useAppRouting'
import { useAccountDataStore, buildAccountKey } from '@/store/account-data-store'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { isTransactionStatusUpdatedMessage } from '@/types/transaction-messages'
import { useWalletSyncBridge } from './hooks/useWalletSyncBridge'
import { accountManager } from '@/core/wallet/account-manager'

// Pages
import { Home } from './pages/Home'

// Onboarding Pages
import { WelcomePage } from './pages/onboarding/WelcomePage'
import { PasswordPage } from './pages/onboarding/PasswordPage'
import { SecureWalletPage } from './pages/onboarding/SecureWalletPage'
import { ViewPhrasePage } from './pages/onboarding/ViewPhrasePage'
import { ConfirmPhrasePage } from './pages/onboarding/ConfirmPhrasePage'
import { CongratulationsPage } from './pages/onboarding/CongratulationsPage'
import { ImportWalletPage } from './pages/onboarding/ImportWalletPage'
import { ImportPasswordPage } from './pages/onboarding/ImportPasswordPage'
import { UnlockPage } from './pages/onboarding/UnlockPage'

// Account Pages
import { AccountList } from './pages/account/AccountList'
import { AccountDetail } from './pages/account/AccountDetail'
import { AddressesList } from './pages/account/AddressesList'

// Transaction Pages
import { Send } from './pages/transactions/Send'
import { Receive } from './pages/transactions/Receive'
import { TransactionResultPage } from './pages/transactions/TransactionResultPage'

// Swap Page
import { Swap } from './pages/swap/Swap'
import { SwapProgress } from './pages/swap/SwapProgress'

// Hardware Wallet Pages (full-tab flows)
import { KeystoneConnectPage } from './pages/hardware/KeystoneConnectPage'
import { HardwareSignPage } from './pages/hardware/HardwareSignPage'
import { HardwareWalletSelectPage } from './pages/hardware/HardwareWalletSelectPage'
import { LedgerConnectPage } from './pages/hardware/LedgerConnectPage'

// DApp Pages
import { ApprovalPage } from './pages/dapp/ApprovalPage'

// Settings Pages
import { Settings } from './pages/settings/Settings'
import { General } from './pages/settings/General'
import { PreferredExplorer } from './pages/settings/PreferredExplorer'
import { RpcEndpoint } from './pages/settings/RpcEndpoint'
import { SecurityPrivacy } from './pages/settings/SecurityPrivacy'
import { ZeroIndexerNodes } from './pages/settings/ZeroIndexerNodes'
import { Help } from './pages/settings/Help'
import { ChangePassword } from './pages/settings/ChangePassword'
import { ExperimentalFeatures } from './pages/settings/ExperimentalFeatures'
import { About } from './pages/settings/About'
import { TermsOfUse } from './pages/settings/TermsOfUse'
import { ViewSeedPhrase } from './pages/settings/ViewSeedPhrase'
import { UpdatePage } from './pages/Update'
import { Voting } from './pages/voting/Voting'
import { VotingRound } from './pages/voting/VotingRound'
import { WalletConnectPage } from './pages/settings/WalletConnectPage'

import { useOnboardingStore } from '@/store/onboarding-store'

// Entry component for adding wallet (sets flowMode and redirects)
function AddWalletEntry() {
  const { replace } = useNavigate()
  const { setFlowMode, reset } = useOnboardingStore()

  useEffect(() => {
    reset()
    setFlowMode('addWallet')
    replace('/onboarding/secure-wallet')
  }, [])

  return null
}

function ImportWalletEntry() {
  const { replace } = useNavigate()
  const { setFlowMode, reset } = useOnboardingStore()

  useEffect(() => {
    reset()
    setFlowMode('addWallet')
    replace('/onboarding/import')
  }, [])

  return null
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />

      {/* Onboarding Routes */}
      <Route path="/onboarding">
        <Route index element={<WelcomePage />} />
        <Route path="password" element={<PasswordPage />} />
        <Route path="secure-wallet" element={<SecureWalletPage />} />
        <Route path="view-phrase" element={<ViewPhrasePage />} />
        <Route path="confirm-phrase" element={<ConfirmPhrasePage />} />
        <Route path="congratulations" element={<CongratulationsPage />} />
        <Route path="import" element={<ImportWalletPage />} />
        <Route path="import-password" element={<ImportPasswordPage />} />
      </Route>

      <Route path="/unlock" element={<UnlockPage />} />
      <Route path="/send" element={<Send />} />
      <Route path="/receive" element={<Receive />} />
      <Route path="/transaction-result" element={<TransactionResultPage />} />
      <Route path="/account-list" element={<AccountList />} />
      <Route path="/account-detail" element={<AccountDetail />} />
      <Route path="/add-wallet" element={<AddWalletEntry />} />
      <Route path="/import-wallet" element={<ImportWalletEntry />} />
      <Route path="/addresses-list" element={<AddressesList />} />

      {/* Hardware Wallet Routes (opened in a full browser tab) */}
      <Route path="/hardware/connect" element={<HardwareWalletSelectPage />} />
      <Route path="/hardware/keystone/connect" element={<KeystoneConnectPage />} />
      <Route path="/hardware/keystone/sign" element={<HardwareSignPage />} />
      <Route path="/hardware/ledger/connect" element={<LedgerConnectPage />} />
      <Route path="/hardware/ledger/sign" element={<HardwareSignPage signer="ledger" />} />

      <Route path="/settings" element={<Settings />} />
      <Route path="/walletconnect" element={<WalletConnectPage />} />
      <Route path="/general" element={<General />} />
      <Route path="/preferred-explorer" element={<PreferredExplorer />} />
      <Route path="/rpc-endpoint" element={<RpcEndpoint />} />
      <Route path="/security-privacy" element={<SecurityPrivacy />} />
      <Route path="/zero-indexer-nodes" element={<ZeroIndexerNodes />} />
      <Route path="/help" element={<Help />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route path="/experimental-features" element={<ExperimentalFeatures />} />
      <Route path="/about" element={<About />} />
      <Route path="/terms-of-use" element={<TermsOfUse />} />
      <Route path="/update" element={<UpdatePage />} />
      <Route path="/voting" element={<Voting />} />
      <Route path="/voting/round" element={<VotingRound />} />

      <Route path="/view-seed-phrase" element={<ViewSeedPhrase />} />
      <Route path="/swap" element={<Swap />} />
      <Route path="/swap-progress" element={<SwapProgress />} />
      <Route path="/approval" element={<ApprovalPage />} />
    </Routes>
  )
}

function AppContent() {
  const { isLoading } = useAppRouting()
  const location = useLocation()
  const { reloadTransactions } = useAccountDataStore()
  useWalletSyncBridge()

  useEffect(() => {
    const handleStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== 'local' || !changes.wallet_state) return
      rehydrateWalletStore().catch(error => {
        console.error('[Popup] Failed to refresh wallet state:', error)
      })
    }

    chrome.storage.onChanged.addListener(handleStorageChanged)
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged)
  }, [])

  useEffect(() => {
    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') return

      const messageType = 'type' in message ? message.type : undefined
      if (
        messageType === 'TRANSACTION_ADDED' ||
        messageType === 'TRANSACTION_UPDATED' ||
        isTransactionStatusUpdatedMessage(message)
      ) {
        const accountKey =
          'accountKey' in message && typeof message.accountKey === 'string'
            ? message.accountKey
            : undefined
        if (!accountKey) return
        console.log('[Popup] Received transaction update:', messageType, accountKey)

        reloadTransactions(accountKey).catch(console.error)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [reloadTransactions])

  useEffect(() => {
    const { currentAccountId, currentWalletId, currentNetwork } = useWalletStore.getState()
    if (currentAccountId && currentWalletId) {
      const accountKey = buildAccountKey(currentNetwork, currentWalletId, currentAccountId)
      reloadTransactions(accountKey).catch(console.error)
    }
  }, [reloadTransactions])

  if (isLoading) {
    return <WalletInitializing />
  }

  const excludedPath =
    location.pathname === '/unlock' ||
    location.pathname === '/approval' ||
    location.pathname === '/add-wallet' ||
    location.pathname === '/import-wallet' ||
    location.pathname.startsWith('/onboarding') ||
    location.pathname.startsWith('/hardware/') ||
    location.pathname === '/walletconnect' ||
    (location.pathname === '/view-seed-phrase' &&
      new URLSearchParams(location.search).get('backup') === '1')
  const showBackupBanner = !excludedPath && !accountManager.isLocked()

  return (
    <div className="app-layout">
      {showBackupBanner && <SecretPhraseBackupBanner />}
      <main className="app-route-content">
        <AppRoutes />
      </main>
    </div>
  )
}

function App() {
  // Extract initial path from URL hash for dApp windows
  const getInitialPath = () => {
    const hash = window.location.hash.slice(1) // Remove leading '#'

    if (hash) {
      // For paths that don't start with '/', add one
      if (!hash.startsWith('/')) {
        return `/${hash}` // Preserve full hash including query params
      }
      return hash
    }

    // Default for normal popup windows
    return '/onboarding'
  }

  return (
    <ModalProvider>
      <RouterProvider initialPath={getInitialPath()}>
        <DialogProvider>
          <AppContent />
          <ToastContainer />
        </DialogProvider>
      </RouterProvider>
    </ModalProvider>
  )
}

export default App
