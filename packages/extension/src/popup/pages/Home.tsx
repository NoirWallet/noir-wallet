import { useEffect } from 'react'
import { Icon } from '@iconify/react'
import { TokenIcon } from '../components/tokens/TokenIcon'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { CopyToast, useCopyToClipboard } from '../components/common/CopyToast'
import { DAppChainIndicator } from '../components/dapp/DAppChainIndicator'
import { DAppConnectionModal } from '../components/dapp/DAppConnectionModal'
import { DAppConnectPrompt } from '../components/dapp/DAppConnectPrompt'
import { openModal } from '../provider/ModalManager'
import { TransactionDetailContent } from '../components/transaction/TransactionDetail'
import { TransactionList } from '../components/transaction/TransactionList'
import { useDAppConnection } from '../hooks/useDAppConnection'
import { useNavigate } from '../provider/Router'
import { useWalletStore } from '@/store/wallet-store'
import { buildAccountKey, useAccountDataStore } from '@/store/account-data-store'
import {
  formatPrice,
  formatNumber,
  formatSortAddress,
  formatAccountName,
  getAccountDisplayName
} from '@/lib/format'
import Big, { safeBig } from '@/lib/big'
import { accountManager, getAccountAddresses } from '@/core/wallet/account-manager'
import { usePolling } from '../hooks/useRequest'
import { AddressTypeLabel } from '../components/account/AddressType'
import { fetchSwapTokens, getZecToken } from '@/core/services/intents-api'
import { useShieldFunds } from '../hooks/useShieldFunds'
import { useSpeedUp } from '../hooks/useSpeedUp'
import { Tooltip } from '../components/ui/tooltip'
import { WALLET_CONFIG } from '@/config/wallet'
import { useLendingStore } from '@/store/lending-store'
import { BalanceWithPending } from '../components/balance/BalanceWithPending'
import { ExtensionUpdateBanner } from '../components/common/ExtensionUpdateBanner'
import { HomeAdBanner } from '../components/common/HomeAdBanner'
import { LegacyPoolPrivacyNotice } from '../components/common/LegacyPoolPrivacyNotice'
import { useLegacyPoolPrivacyNotice } from '../hooks/useLegacyPoolPrivacyNotice'
import { hasLegacyOrchardBalance } from '@/lib/legacy-pool-privacy-notice'
import { canShieldTransparentFunds } from '@/core/zcash/shielding'
import { isHardwareKeySource } from '@/lib/hardware-capabilities'
import { ZKNOIR_LENDING_URL } from '@/config/dapp-matches'

function formatSyncHeight(height: number): string {
  return height > 0 ? height.toLocaleString() : '—'
}

function formatEta(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  if (totalSeconds < 60) return `<1 min`
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.ceil((totalSeconds % 3600) / 60)
  if (hours > 0) return `~${hours}h ${minutes}m`
  return `~${minutes} min`
}

export function Home() {
  const navigate = useNavigate()
  const { copyToClipboard, showToast } = useCopyToClipboard()
  const { currentDApp, currentAccountAuthorized, connectCurrentAccount } = useDAppConnection()
  const { isShielding, handleShieldFunds, shieldSheet } = useShieldFunds()
  const { requestSpeedUp, speedUpSheet } = useSpeedUp()
  const {
    getCurrentAccount,
    getCurrentWallet,
    zecPrice,
    setZecPrice,
    currentNetwork,
    currentWalletId,
    accountDisplayNames
  } = useWalletStore()
  const { balances, getCurrentBalance, getCurrentSyncState } = useAccountDataStore()

  const openLendingApp = () => {
    chrome.tabs.create({ url: ZKNOIR_LENDING_URL }).catch(error => {
      console.warn('[Home] Failed to open zkNoir Lending:', error)
    })
  }

  const currentAccount = getCurrentAccount()
  const currentWallet = getCurrentWallet()
  // Lending requires message signing, which the hardware transaction protocols do not expose.
  const isHardwareWallet = isHardwareKeySource(currentWallet?.keySource)
  const accountDisplayName =
    currentAccount && currentWalletId
      ? getAccountDisplayName(
          currentWalletId,
          currentAccount.id,
          currentAccount.name,
          accountDisplayNames
        )
      : 'Account 1'
  const storeBalance = getCurrentBalance()
  const { isSyncing, syncProgress, currentHeight, latestHeight, etaMs, syncReason } =
    getCurrentSyncState()
  const syncEta =
    etaMs != null && etaMs > 0
      ? formatEta(etaMs)
      : latestHeight > 0 && currentHeight >= latestHeight
        ? '<1 min'
        : '—'
  const network = currentNetwork
  const isTestnet = network === 'testnet'
  const hasLegacyPoolBalance = hasLegacyOrchardBalance(
    currentWallet?.accounts.map(account =>
      currentWalletId
        ? balances.get(buildAccountKey(currentNetwork, currentWalletId, account.id))
        : null
    ) ?? []
  )
  const legacyPoolPrivacyNotice = useLegacyPoolPrivacyNotice(hasLegacyPoolBalance)

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const tokens = await fetchSwapTokens(true)
        const zecToken = getZecToken(tokens)
        if (zecToken) {
          setZecPrice(zecToken.price)
        }
      } catch (error) {
        console.error('Failed to fetch ZEC price:', error)
      }
    }

    fetchPrice()
    const interval = setInterval(fetchPrice, 60000)
    return () => clearInterval(interval)
  }, [])

  usePolling(async () => {
    accountManager.requestSync('requested')
  }, WALLET_CONFIG.SYNC.BALANCE_POLL_MS)

  const {
    getFormattedSupplied,
    refreshAll: refreshLending,
    dataLoaded: lendingLoaded,
    isLoadingData: lendingLoading,
    error: lendingError
  } = useLendingStore()

  useEffect(() => {
    refreshLending()
  }, [currentWalletId, currentAccount?.id, currentNetwork, refreshLending])

  const lendingSupplied = getFormattedSupplied()
  const lendingSuppliedUsd = safeBig(lendingSupplied).times(zecPrice).toNumber()

  const totalBalance = storeBalance?.total ?? '0'
  const walletUsd = useAccountDataStore.getState().getCurrentBalanceUsd()
  const totalUsd = safeBig(walletUsd).plus(lendingSuppliedUsd).toNumber()

  const addresses = getAccountAddresses(currentAccount, storeBalance, zecPrice)

  const walletData = {
    totalUsd: totalUsd,
    zec: {
      balance: totalBalance,
      price: zecPrice,
      value: walletUsd
    },
    addresses
  }

  const handleTransactionClick = async (id: string) => {
    await openModal({
      showCloseButton: true,
      className: 'max-h-[calc(100dvh-1rem)] overflow-y-auto overscroll-contain',
      body: (resolve: (value: any) => void, close: () => void) => (
        <TransactionDetailContent
          transactionId={id}
          onClose={() => {
            close()
            resolve(undefined)
          }}
          onSpeedUp={requestSpeedUp}
        />
      )
    })
  }

  const handleDAppClick = async () => {
    await openModal({
      title: 'Connected dApps',
      showCloseButton: true,
      className: 'max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)]',
      body: () => <DAppConnectionModal />
    })
  }

  const showShieldButton = canShieldTransparentFunds(storeBalance)

  return (
    <div className="page-container">
      <LegacyPoolPrivacyNotice
        open={legacyPoolPrivacyNotice.isOpen}
        onDismiss={legacyPoolPrivacyNotice.dismiss}
      />
      <CopyToast show={showToast} />
      {isTestnet && (
        <div className="bg-warning/15 text-warning text-center text-xs font-semibold py-1">
          TESTNET
        </div>
      )}
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate.navigate('/account-list')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card"
        >
          <span className="text-sm font-medium">{formatAccountName(accountDisplayName, 12)}</span>
          <Icon icon="lucide:chevron-down" width={10} height={10} />
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            onClick={() => navigate.navigate('/settings')}
          >
            <Icon icon="lucide:settings" width={18} height={18} />
          </Button>
          <DAppChainIndicator
            connectedDApp={
              currentDApp && currentAccountAuthorized
                ? {
                    name: currentDApp.name,
                    icon: currentDApp.favicon
                  }
                : null
            }
            onClick={handleDAppClick}
          />
        </div>
      </header>

      <ExtensionUpdateBanner />

      <div className="flex-1 overflow-y-auto">
        {/* Total Balance */}
        <div className="px-5 pt-4 pb-3">
          <div className="text-center">
            <div className="flex flex-col items-center justify-center">
              <p className="text-[40px] font-bold leading-tight">
                {formatPrice(walletData.totalUsd, { showSign: true })}
              </p>
            </div>
            <p className="text-sm text-muted mt-1">Total Assets</p>
          </div>
        </div>

        {showShieldButton && (
          <div className="px-5 mb-4 flex justify-center">
            <button
              onClick={handleShieldFunds}
              disabled={isShielding}
              className="h-8 px-3.5 rounded-full border border-primary/20 bg-primary/8 text-primary/90 hover:bg-primary/12 hover:border-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 text-xs font-medium"
            >
              <Icon icon="lucide:shield" width={12} height={12} />
              <span>{isShielding ? 'Shielding...' : 'Shield Funds'}</span>
            </button>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-center gap-3 px-5 mb-6">
          <ActionButton
            icon={<Icon icon="lucide:send" width={20} height={20} />}
            label="Send"
            onClick={() => navigate.navigate('/send')}
          />
          <ActionButton
            icon={<Icon icon="lucide:arrow-down" width={20} height={20} />}
            label="Receive"
            onClick={() => navigate.navigate('/receive')}
          />
          {!isTestnet && (
            <ActionButton
              icon={<Icon icon="lucide:landmark" width={20} height={20} />}
              label="Lending"
              analyticsOutbound={{ id: 'lending', domain: new URL(ZKNOIR_LENDING_URL).hostname }}
              disabled={isHardwareWallet}
              title={isHardwareWallet ? 'Not available with hardware wallets' : undefined}
              onClick={openLendingApp}
            />
          )}
          {!isTestnet && (
            <ActionButton
              icon={<Icon icon="lucide:arrow-left-right" width={20} height={20} />}
              label="Swap"
              onClick={() => navigate.navigate('/swap')}
            />
          )}
        </div>

        <HomeAdBanner />

        {/* Tabs */}
        <Tabs defaultValue="assets" className="relative w-full">
          <TabsList className="justify-start px-5 bg-background/80! rounded-none h-auto sticky top-0 z-10">
            <TabsTrigger
              value="assets"
              className="tab-trigger-custom data-[state=active]:text-white text-muted rounded-none py-2 px-1 mr-6 flex-0"
            >
              Assets
            </TabsTrigger>
            {!isHardwareWallet && !isTestnet && (
              <TabsTrigger
                value="lending"
                className="tab-trigger-custom data-[state=active]:text-white text-muted rounded-none py-2 px-1 mr-6 flex-0"
              >
                Lending
              </TabsTrigger>
            )}
            <TabsTrigger
              value="activity"
              className="tab-trigger-custom data-[state=active]:text-white text-muted rounded-none py-2 px-1 flex-0"
            >
              Activity
            </TabsTrigger>
          </TabsList>
          {isSyncing && (
            <div className="ml-auto absolute top-3 right-4">
              <Tooltip
                content={
                  <div className="flex flex-col gap-0.5 items-center">
                    <span className="font-semibold text-xs">Syncing Blockchain</span>
                    <span className="text-[10px] opacity-80 font-mono">
                      Height: {formatSyncHeight(currentHeight)} / {formatSyncHeight(latestHeight)}
                    </span>
                    <span className="text-[10px] opacity-80 font-mono">ETA: {syncEta}</span>
                  </div>
                }
              >
                <div className="flex items-center gap-1.5 text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  <Icon icon="lucide:refresh-cw" width={10} height={10} className="animate-spin" />
                  <span className="font-mono">
                    {latestHeight > 0 && syncProgress > 0 ? `${syncProgress}%` : 'Syncing'}
                  </span>
                </div>
              </Tooltip>
            </div>
          )}
          {!isSyncing && syncReason === 'sync_stall' && (
            <div className="ml-auto absolute top-3 right-4 max-w-[140px]">
              <Tooltip content="Sync paused. Check your connection and restart the extension if it persists.">
                <div className="flex items-center gap-1 text-[10px] text-warning bg-warning/10 px-2 py-0.5 rounded-full">
                  <Icon icon="lucide:alert-triangle" width={10} height={10} />
                  <span>Sync paused</span>
                </div>
              </Tooltip>
            </div>
          )}
          {!isSyncing && syncReason === 'network_error' && (
            <div className="ml-auto absolute top-3 right-4 max-w-[140px]">
              <Tooltip content="Network connection failed. Check your connection and retry.">
                <div className="flex items-center gap-1 text-[10px] text-danger bg-danger/10 px-2 py-0.5 rounded-full">
                  <Icon icon="lucide:wifi-off" width={10} height={10} />
                  <span>Network error</span>
                </div>
              </Tooltip>
            </div>
          )}
          <TabsContent value="assets" className="px-5 py-4 mt-0">
            <div className="flex items-center justify-between px-1 py-2 -mx-1">
              <div className="flex items-center gap-3">
                <TokenIcon symbol="ZEC" size="lg" />
                <div>
                  <p className="font-medium">ZEC</p>
                  <p className="text-xs text-primary">
                    {formatPrice(walletData.zec.price, { showSign: true })}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium">
                  {formatNumber(walletData.zec.balance, { rm: Big.roundDown })}
                </p>
                <p className="text-xs text-muted">
                  {formatPrice(walletData.zec.value, { showSign: true })}
                </p>
              </div>
            </div>

            {/* Address breakdown */}
            <div className="mt-3 space-y-4 pt-3 border-t border-border">
              {walletData.addresses.map(addr => (
                <div
                  key={addr.type}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    navigate.navigate(
                      `/send${addr.type === 'transparent' ? '?from=transparent' : ''}`
                    )
                  }
                  onKeyDown={e => {
                    if (e.key === 'Enter')
                      navigate.navigate(
                        `/send${addr.type === 'transparent' ? '?from=transparent' : ''}`
                      )
                  }}
                  className="flex items-center justify-between rounded-lg px-2 py-2 -mx-2 cursor-pointer transition-colors hover:bg-white/5"
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm">{formatSortAddress(addr.address)}</span>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          copyToClipboard(addr.address)
                        }}
                        className="text-muted hover:text-white cursor-pointer"
                        aria-label="Copy address"
                      >
                        <Icon icon="lucide:copy" width={13} height={13} />
                      </button>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          navigate.navigate(`/receive?type=${addr.type}`)
                        }}
                        className="text-muted hover:text-white cursor-pointer"
                        aria-label="Show receive QR code"
                      >
                        <Icon icon="lucide:qr-code" width={14} height={14} />
                      </button>
                    </div>
                    <AddressTypeLabel type={addr.type} />
                  </div>
                  <BalanceWithPending
                    amount={addr.balance}
                    pending={addr.pending}
                    fiatValue={addr.fiatValue}
                    amountClassName="text-sm font-normal"
                  />
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="lending" className="px-5 py-4 mt-0">
            {safeBig(lendingSupplied).gt(0) ? (
              <div
                role="button"
                tabIndex={0}
                data-analytics-outbound="lending"
                data-analytics-domain={new URL(ZKNOIR_LENDING_URL).hostname}
                onClick={openLendingApp}
                onKeyDown={e => {
                  if (e.key === 'Enter') openLendingApp()
                }}
                className="flex items-center justify-between cursor-pointer hover:bg-white/5 rounded-lg px-1 py-2 -mx-1 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="relative size-10 rounded-full bg-foreground/10 flex items-center justify-center">
                    <Icon
                      icon="lucide:landmark"
                      width={20}
                      height={20}
                      className="text-foreground"
                    />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center">
                      <TokenIcon symbol="ZEC" size={16} className="shrink-0" />
                    </div>
                  </div>
                  <div>
                    <p className="font-medium">
                      ZEC <span className="text-xs text-muted font-normal">Supply</span>
                    </p>
                    <p className="text-xs text-primary">Lending</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">
                    {formatNumber(lendingSupplied, { rm: Big.roundDown })}
                  </p>
                  <p className="text-xs text-muted">
                    {formatPrice(lendingSuppliedUsd, { showSign: true })}
                  </p>
                </div>
              </div>
            ) : lendingLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Icon
                  icon="lucide:loader-2"
                  width={24}
                  height={24}
                  className="text-muted animate-spin"
                />
              </div>
            ) : lendingError && !lendingLoaded ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="size-12 rounded-full bg-foreground/5 flex items-center justify-center mb-3">
                  <Icon icon="lucide:wifi-off" width={24} height={24} className="text-muted" />
                </div>
                <p className="text-sm text-muted mb-1">Unable to load lending data</p>
                <p className="text-xs text-muted/60 mb-4">Network issue, tap to retry</p>
                <button
                  onClick={() => refreshLending()}
                  className="px-4 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="size-12 rounded-full bg-foreground/5 flex items-center justify-center mb-3">
                  <Icon icon="lucide:landmark" width={24} height={24} className="text-muted" />
                </div>
                <p className="text-sm text-muted mb-4">No lending positions yet</p>
                <button
                  data-analytics-outbound="lending"
                  data-analytics-domain={new URL(ZKNOIR_LENDING_URL).hostname}
                  onClick={openLendingApp}
                  className="px-4 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
                >
                  Start Lending
                </button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="activity" className="py-4 mt-0">
            <TransactionList
              network={network as 'mainnet' | 'testnet'}
              onItemClick={handleTransactionClick}
            />
          </TabsContent>
        </Tabs>
      </div>

      {currentDApp && !currentAccountAuthorized && (
        <DAppConnectPrompt
          host={currentDApp.host}
          favicon={currentDApp.favicon}
          accountName={accountDisplayName}
          onConnect={() => connectCurrentAccount(currentDApp.origin)}
        />
      )}

      {shieldSheet}
      {speedUpSheet}
    </div>
  )
}

interface ActionButtonProps {
  analyticsOutbound?: { id: string; domain: string }
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
}

function ActionButton({
  analyticsOutbound,
  icon,
  label,
  onClick,
  active,
  disabled,
  title
}: ActionButtonProps) {
  return (
    <button
      data-analytics-outbound={analyticsOutbound?.id}
      data-analytics-domain={analyticsOutbound?.domain}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex flex-col items-center gap-2 ${
        active ? 'ring-2 ring-primary rounded-xl' : ''
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <div className="w-[74px] h-[74px] rounded-2xl bg-card border border-transparent flex flex-col items-center justify-center gap-1.5 text-white transition-colors hover:border-primary">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
    </button>
  )
}
