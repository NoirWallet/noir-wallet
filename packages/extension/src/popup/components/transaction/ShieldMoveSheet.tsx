import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import nearLogo from '@/images/figma-near-confidential.svg'
import zcashLogo from '@/images/figma-zcash-shield.svg'
import type { SwapToken } from '@/core/services/intents-api'
import { getZcashChainId } from '@/core/chains/registry'
import { findAssetPrice, type AssetPriceReadModel } from '@/core/prices'
import { getFundingBalance } from '@/core/wallet/funding-balance'
import { getFundingSourceUnavailableReason } from '@/core/wallet/funding-source'
import {
  formatBaseUnitDecimalAmount,
  formatFiatAmount,
  formatTokenQuantity
} from '@/lib/number-format'
import { formatSortAddress } from '@/lib/format'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import Big, { safeBig } from '@/lib/big'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { useSettingsStore } from '@/store/settings-store'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { useHomePortfolio } from '@/popup/hooks/useHomePortfolio'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { useNavigate } from '@/popup/provider/Router'
import { resolveManagedIntentsCatalog } from '@/popup/services/intents-asset-manager-client'
import { listMoveAssetPickerRows } from '@/popup/services/move-asset-picker'
import { getPrivateTransferChainIds } from '@/popup/services/private-balance-transfer'
import { listShieldFundingAssets, shieldPortfolioBalances } from '@/popup/services/shield-transfer'
import { swapTokenCatalogClient } from '@/popup/services/swap-token-catalog-client'
import { confidentialFundingClient } from '@/popup/services/confidential-funding-client'
import { assetPriceClient } from '@/popup/services/asset-price-client'
import { resolveZcashSelfMove } from '@/popup/services/zcash-self-move'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { ExecutionAccountIcon } from '@/popup/components/account/ExecutionAccountSelector'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/popup/components/ui/dialog'

type Source = 'public' | 'private' | 'near-confidential' | 'zcash-shield'

export function ShieldMoveSheet({
  open,
  onOpenChange,
  mode
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly mode: 'public' | 'private'
}) {
  const { navigate } = useNavigate()
  const walletId = useWalletStore(state => state.currentWalletId)
  const accountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)
  const zcashAccount = useWalletStore(state => state.getCurrentAccount())
  const zcashKeySource = useWalletStore(state => state.getCurrentWallet()?.keySource)
  const zcashBalance = useAccountDataStore(state => state.getCurrentBalance())
  const balancesHidden = useSettingsStore(state => state.balancesHidden)
  const {
    activeAccount,
    loading: accountLoading,
    error: accountError,
    refresh: refreshAccount
  } = useActiveAccountNetworks()
  const account = resolveEffectiveActiveAccountIdentity({
    currentWalletId: walletId,
    currentAccountId: accountId,
    nativeAccount: activeAccount
  })
  const { model, status, refresh } = useHomePortfolio(
    account?.walletId ?? null,
    account?.accountId ?? null
  )
  const [source, setSource] = useState<Source | null>(null)
  const [search, setSearch] = useState('')
  const [chainId, setChainId] = useState('all')
  const [tokens, setTokens] = useState<readonly SwapToken[] | null>(null)
  const [catalogError, setCatalogError] = useState(false)
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [nearStatus, setNearStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [prices, setPrices] = useState<AssetPriceReadModel | null>(null)

  useEffect(() => {
    if (!open) {
      setSource(null)
      setSearch('')
      setChainId('all')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let active = true
    setCatalogError(false)
    void swapTokenCatalogClient
      .readCached()
      .then(cached => {
        if (active && cached.length) setTokens(cached)
      })
      .catch(() => {})
    void swapTokenCatalogClient
      .refresh()
      .then(fresh => {
        if (active) setTokens(fresh)
      })
      .catch(() => {
        if (active) setCatalogError(true)
      })
    return () => {
      active = false
    }
  }, [open, catalogRetry, network, walletId, accountId])

  useEffect(() => {
    setTokens(null)
  }, [network])

  useEffect(() => {
    if (!open) return
    let active = true
    void assetPriceClient
      .getPrices('read')
      .then(cached => {
        if (active && cached) setPrices(cached)
      })
      .catch(() => {})
    void assetPriceClient
      .getPrices('refresh')
      .then(refreshed => {
        if (active && refreshed) setPrices(refreshed)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [open, network])

  const eligibleChainIds = getPrivateTransferChainIds(activeAccount, network === 'mainnet')
  const zcashSources = (['transparent', 'shielded'] as const).filter(
    item =>
      resolveZcashSelfMove(zcashAccount?.addresses, item, network) !== null &&
      !getFundingSourceUnavailableReason(zcashKeySource, item)
  )
  const canZcash = activeAccount?.networks.some(item => item.chain.family === 'zcash') ?? false
  const canNear = eligibleChainIds.length > 0
  useEffect(() => {
    if (!open || source !== 'near-confidential' || !canNear || !account) return
    let active = true
    setNearStatus('loading')
    void confidentialFundingClient
      .refreshBalances(
        { network, keyDomainId: account.walletId, accountId: account.accountId },
        true
      )
      .then(async () => {
        if (!active) return
        await refresh(true)
        if (active) setNearStatus('idle')
      })
      .catch(() => {
        if (active) setNearStatus('error')
      })
    return () => {
      active = false
    }
  }, [open, source, canNear, account?.walletId, account?.accountId, network, catalogRetry, refresh])
  const accountEvmNetwork = activeAccount?.networks.find(item =>
    eligibleChainIds.includes(item.chain.id)
  )
  const publicAddress =
    accountEvmNetwork?.addresses.find(item => item.preferredForReceive)?.value ??
    zcashAccount?.addresses.transparent
  const privateAddress = accountEvmNetwork?.privateExecutionAddress
  const managed = useMemo(() => resolveManagedIntentsCatalog(tokens ?? []), [tokens])
  const options = useMemo(
    () => listShieldFundingAssets(model, managed, tokens ?? [], network),
    [model, managed, tokens, network]
  )
  const assets = useMemo(() => {
    if (!model) return []
    const supported = new Set(
      options
        .filter(option => eligibleChainIds.includes(option.chain.chain.id))
        .map(option => option.asset.asset.id)
    )
    return model.assets.flatMap(asset => {
      const chain = model.chains.find(item => item.chain.id === asset.asset.chainId)
      return chain &&
        chain.chain.family === 'evm' &&
        chain.chain.capabilities.transaction.status === 'available' &&
        supported.has(asset.asset.id)
        ? [{ asset, chain }]
        : []
    })
  }, [model, options, eligibleChainIds.join(',')])
  const nearAssets = useMemo(() => {
    const existing = new Set(assets.map(item => item.asset.asset.id))
    return [
      ...assets,
      ...options
        .filter(
          option =>
            eligibleChainIds.includes(option.chain.chain.id) && !existing.has(option.asset.asset.id)
        )
        .map(({ asset, chain }) => ({ asset, chain }))
    ]
  }, [assets, options, eligibleChainIds.join(',')])
  const from =
    source === 'near-confidential' ? 'shield' : source === 'private' ? 'private' : 'public'
  const rows = useMemo(
    () =>
      source === 'zcash-shield'
        ? []
        : listMoveAssetPickerRows({
            assets: source === 'near-confidential' ? nearAssets : assets,
            from,
            network,
            prices,
            portfolio: model,
            shieldBalances: shieldPortfolioBalances(model),
            managedAssets: managed,
            catalogTokens: tokens ?? []
          }),
    [source, nearAssets, assets, from, network, prices, model, managed, tokens]
  )
  const evmNetworks = Array.from(
    new Map(rows.map(row => [row.chain.chain.id, row.chain.chain.displayName])).entries()
  )
  const filteredRows = rows.filter(row => {
    const term = search.trim().toLowerCase()
    return (
      (chainId === 'all' || row.chain.chain.id === chainId) &&
      (!term ||
        row.asset.metadata.symbol.toLowerCase().includes(term) ||
        row.asset.metadata.name.toLowerCase().includes(term) ||
        row.chain.chain.displayName.toLowerCase().includes(term))
    )
  })
  const zcashAvailable = getFundingBalance(
    zcashBalance,
    source === 'zcash-shield' ? 'shielded' : 'transparent'
  ).available
  const zcashAssetId = `${getZcashChainId(network)}/slip44:133`
  const zcashPrice = findAssetPrice(prices, zcashAssetId)?.priceUsd
  const zcashValueUsd = zcashPrice ? new Big(zcashAvailable).times(zcashPrice).toFixed() : null
  const showZcash =
    zcashBalance !== null &&
    zcashBalance !== undefined &&
    ((source === 'zcash-shield' && zcashSources.includes('shielded')) ||
      (source === 'public' && zcashSources.includes('transparent'))) &&
    safeBig(zcashAvailable).gt(0)
  const networks = showZcash
    ? [...evmNetworks, [getZcashChainId(network), 'Zcash'] as const]
    : evmNetworks
  const zcashVisible =
    showZcash &&
    (chainId === 'all' || chainId === getZcashChainId(network)) &&
    (search.trim() === '' || 'zec zcash'.includes(search.trim().toLowerCase()))
  const needsCatalog = source !== 'zcash-shield' && canNear
  const loading =
    accountLoading ||
    (source === 'near-confidential' &&
      nearStatus === 'loading' &&
      model?.confidential?.status !== 'ready') ||
    (needsCatalog && status === 'loading') ||
    (needsCatalog && tokens === null && !catalogError)
  const error =
    (source === 'near-confidential' &&
      nearStatus === 'error' &&
      model?.confidential?.status !== 'ready') ||
    (needsCatalog && status === 'error') ||
    (needsCatalog && catalogError && tokens === null) ||
    ((source === 'zcash-shield' || (source === 'public' && canZcash && rows.length === 0)) &&
      !zcashBalance &&
      !accountLoading)

  const selectSource = (next: Source | null) => {
    setSource(next)
    setSearch('')
    setChainId('all')
  }
  const selectEvm = (assetId: string) => {
    const query = new URLSearchParams({
      assetId,
      from,
      to: from === 'shield' ? mode : 'shield',
      provider: 'near-confidential',
      mode
    })
    onOpenChange(false)
    navigate(`/transfer?${query.toString()}`)
  }
  const selectZcash = () => {
    const query = new URLSearchParams({
      move: '1',
      from: source === 'zcash-shield' ? 'shielded' : 'transparent',
      mode
    })
    onOpenChange(false)
    navigate(`/send/zcash?${query.toString()}`)
  }
  const retry = () => {
    void refreshAccount()
    void refresh(true)
    if (canZcash && !zcashBalance) {
      void chrome.runtime.sendMessage({ type: 'BACKGROUND_SYNC' }).catch(() => {})
    }
    setCatalogRetry(value => value + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position="bottom"
        showCloseButton={false}
        className="flex max-h-[min(520px,calc(100dvh-24px))] flex-col gap-0 bg-popover p-0"
      >
        <div className="flex h-14 shrink-0 items-center gap-1 px-5">
          {source && (
            <button
              type="button"
              aria-label="Back to sources"
              onClick={() => selectSource(null)}
              className="wallet-interactive flex size-6 items-center justify-center rounded-md hover:bg-white/10"
            >
              <Icon icon="lucide:arrow-left" width={18} height={18} />
            </button>
          )}
          <DialogTitle className={`min-w-0 flex-1 font-medium ${source ? 'text-base' : 'text-lg'}`}>
            {source === 'public'
              ? 'Select token in public account'
              : source === 'private'
                ? 'Select token in private account'
                : source === 'near-confidential' || source === 'zcash-shield'
                  ? 'Select token in Shield Funds'
                  : 'Move from'}
          </DialogTitle>
          <DialogDescription className="sr-only">Choose a source and token</DialogDescription>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="wallet-interactive flex size-8 items-center justify-center rounded-md hover:bg-white/10"
          >
            <Icon icon="lucide:x" width={18} height={18} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 pt-2">
          {source === null ? (
            <div className="space-y-3">
              {(canNear || (canZcash && zcashSources.includes('transparent'))) && (
                <SourceButton
                  label="Public account"
                  accountMode="public"
                  address={publicAddress}
                  onClick={() => selectSource('public')}
                />
              )}
              {canNear && (
                <SourceButton
                  label="Private account"
                  accountMode="private"
                  address={privateAddress}
                  onClick={() => selectSource('private')}
                />
              )}
              {(canNear || (canZcash && zcashSources.includes('shielded'))) && (
                <div className="pt-2">
                  <div className="mb-3 flex items-center gap-2 px-1 text-base font-medium">
                    <Icon
                      icon="lucide:shield-check"
                      width={18}
                      height={18}
                      className="text-primary"
                    />
                    <span>Shield Funds</span>
                  </div>
                  <div className="space-y-3">
                    {canNear && (
                      <SourceButton
                        label="Near Confidential Intents"
                        provider="near-confidential"
                        onClick={() => selectSource('near-confidential')}
                      />
                    )}
                    {canZcash && zcashSources.includes('shielded') && (
                      <SourceButton
                        label="Zcash Shield"
                        provider="zcash-shield"
                        onClick={() => selectSource('zcash-shield')}
                      />
                    )}
                  </div>
                </div>
              )}
              {accountLoading && (
                <p className="py-4 text-center text-sm text-wallet-secondary">Loading accounts…</p>
              )}
              {accountError && (
                <div className="flex items-center justify-center gap-3 py-4 text-sm">
                  <span>Accounts unavailable</span>
                  <button type="button" onClick={retry} className="text-primary">
                    Retry
                  </button>
                </div>
              )}
              {!accountLoading && !accountError && !canNear && zcashSources.length === 0 && (
                <p className="py-4 text-center text-sm text-wallet-secondary">
                  No available sources
                </p>
              )}
            </div>
          ) : (
            <>
              {source !== 'zcash-shield' && (
                <>
                  <div className="relative mb-3">
                    <Icon
                      icon="lucide:search"
                      width={17}
                      height={17}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-wallet-secondary"
                    />
                    <input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder="Search tokens"
                      aria-label="Search tokens"
                      className="h-12 w-full rounded-lg border border-white/10 bg-card pl-10 pr-3 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  {networks.length > 0 && (
                    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                      <FilterButton
                        label="All"
                        selected={chainId === 'all'}
                        onClick={() => setChainId('all')}
                      />
                      {networks.map(([id, label]) => (
                        <FilterButton
                          key={id}
                          label={label}
                          chainIcon={
                            id === getZcashChainId(network)
                              ? 'zec'
                              : resolveChainIconAlias('evm', label, id)
                          }
                          selected={chainId === id}
                          onClick={() => setChainId(id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
              {(filteredRows.length > 0 || zcashVisible) && (
                <p className="mb-1 px-1 text-sm font-medium">Token</p>
              )}
              {zcashVisible && (
                <button
                  type="button"
                  onClick={selectZcash}
                  className="wallet-interactive flex h-[70px] w-full items-center gap-3 rounded-md px-1 text-left hover:bg-card active:bg-wallet-selected"
                >
                  <TokenIcon assetId={zcashAssetId} symbol="ZEC" blockchain="zec" size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-medium">ZEC</span>
                    <span className="block text-xs text-wallet-secondary">Zcash</span>
                  </span>
                  <span className="max-w-[45%] min-w-0 text-right tabular-nums">
                    <span className="block truncate text-base font-medium">
                      {balancesHidden ? '••••' : formatTokenQuantity(zcashAvailable)}
                    </span>
                    <span className="block truncate text-xs text-wallet-secondary">
                      {balancesHidden
                        ? '••••'
                        : zcashValueUsd === null
                          ? '—'
                          : formatFiatAmount(zcashValueUsd, { showSign: true })}
                    </span>
                  </span>
                </button>
              )}
              {filteredRows.map(row => (
                <button
                  key={row.asset.asset.id}
                  type="button"
                  onClick={() => selectEvm(row.asset.asset.id)}
                  className="wallet-interactive flex h-[70px] w-full items-center gap-3 rounded-md px-1 text-left hover:bg-card active:bg-wallet-selected"
                >
                  <TokenIcon
                    assetId={row.asset.asset.id}
                    symbol={row.asset.metadata.symbol}
                    icon={row.asset.metadata.iconUrl}
                    blockchain={resolveChainIconAlias(
                      row.chain.chain.family,
                      row.chain.chain.displayName,
                      row.chain.chain.id
                    )}
                    size={32}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium">
                      {row.asset.metadata.symbol}
                    </span>
                    <span className="block truncate text-xs text-wallet-secondary">
                      {row.chain.chain.displayName}
                    </span>
                  </span>
                  <span className="max-w-[45%] min-w-0 text-right tabular-nums">
                    <span className="block truncate text-base font-medium">
                      {balancesHidden
                        ? '••••'
                        : formatTokenQuantity(
                            formatBaseUnitDecimalAmount(row.sourceRaw, row.asset.metadata.decimals)
                          )}
                    </span>
                    <span className="block truncate text-xs text-wallet-secondary">
                      {balancesHidden
                        ? '••••'
                        : row.valueUsd === null
                          ? '—'
                          : formatFiatAmount(row.valueUsd, { showSign: true })}
                    </span>
                  </span>
                </button>
              ))}
              {loading && (
                <p className="py-5 text-center text-sm text-wallet-secondary">Loading balances…</p>
              )}
              {error && (
                <div className="flex items-center justify-center gap-3 py-5 text-sm">
                  <span>Balances unavailable</span>
                  <button type="button" onClick={retry} className="text-primary">
                    Retry
                  </button>
                </div>
              )}
              {!loading && !error && filteredRows.length === 0 && !zcashVisible && (
                <p className="py-5 text-center text-sm text-wallet-secondary">
                  No available tokens
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SourceButton({
  label,
  accountMode,
  address,
  provider,
  onClick
}: {
  readonly label: string
  readonly accountMode?: 'public' | 'private'
  readonly address?: string
  readonly provider?: 'near-confidential' | 'zcash-shield'
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="wallet-interactive flex h-16 w-full flex-col justify-center rounded-xl border border-white/[0.08] bg-card px-4 text-left hover:border-primary/40 hover:bg-card/80 active:bg-wallet-selected focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {provider ? (
          <img
            src={provider === 'near-confidential' ? nearLogo : zcashLogo}
            alt=""
            width={22}
            height={22}
            className="shrink-0 rounded-[4px]"
          />
        ) : accountMode === 'private' ? (
          <ExecutionAccountIcon mode="private" size={19} className="shrink-0 text-private" />
        ) : (
          <Icon icon="lucide:eye" width={19} height={19} className="shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-base font-medium">{label}</span>
      </span>
      {accountMode && (
        <span
          className="mt-1 block max-w-full truncate text-xs font-medium text-wallet-secondary"
          title={address}
        >
          {address ? formatSortAddress(address) : 'Address unavailable'}
        </span>
      )}
    </button>
  )
}

function FilterButton({
  label,
  chainIcon,
  selected,
  onClick
}: {
  readonly label: string
  readonly chainIcon?: string
  readonly selected: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={chainIcon ? `${label} network` : 'All networks'}
      onClick={onClick}
      className={`wallet-interactive flex size-10 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-primary bg-card text-foreground' : 'border-white/10 bg-card text-wallet-secondary hover:border-white/30'}`}
    >
      {chainIcon ? (
        <ChainIcon chain={chainIcon} width={24} height={24} className="rounded-[5px]" />
      ) : (
        <span className="text-sm font-medium">All</span>
      )}
    </button>
  )
}
