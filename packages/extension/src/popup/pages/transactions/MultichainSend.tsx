import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import type { PortfolioReadModel } from '@/core/portfolio'
import { findAssetPrice, type AssetPriceReadModel } from '@/core/prices'
import { formatSortAddress } from '@/lib/format'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import {
  TokenSelectionList,
  TokenSelectionSearch,
  type TokenSelectionItem
} from '@/popup/components/tokens/TokenSelectionList'
import { PageHeader } from '@/popup/components/common/PageHeader'
import { InlineError } from '@/popup/components/common/InlineError'
import { SendRouteMenu } from '@/popup/components/transaction/SendRouteMenu'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import { TokenBalanceDisplay } from '@/popup/components/tokens/TokenBalanceDisplay'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/popup/components/ui/dropdown-menu'
import type { EvmTransferSubmission } from '@/popup/services/evm-wallet-client'
import { useNavigate } from '@/popup/provider/Router'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { EvmSendForm } from './EvmSendForm'
import { ShieldWithdrawForm, type ShieldWithdrawEntry } from '../portfolio/ShieldWithdrawPage'
import { EvmTransactionResult } from './EvmTransactionResult'
import { BitcoinSendForm } from './BitcoinSendForm'
import { BitcoinTransactionResult } from './BitcoinTransactionResult'
import type { BitcoinTransferSubmission } from '@/popup/services/bitcoin-wallet-client'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { useSettingsStore } from '@/store/settings-store'
import { getChainEndpointRuntimeKey } from '@/core/chains/chain-endpoint-settings'
import { usePortfolioUpdates } from '@/popup/hooks/usePortfolioUpdates'
import { assetPriceClient } from '@/popup/services/asset-price-client'
import { offerSaveRecipient } from '@/popup/services/save-recipient-prompt'
import { buildSendAssetSelectionModel, type SendAsset } from './send-asset-order'
import { isSelectableChainFamily } from '@/popup/services/chain-selection-availability'
import { SolanaSendForm } from './SolanaSendForm'
import { SolanaTransactionResult } from './SolanaTransactionResult'
import type { SolanaTransferSubmission } from '@/popup/services/solana-wallet-client'
import { NearSendForm } from './NearSendForm'
import { NearTransactionResult } from './NearTransactionResult'
import type { NearTransferSubmission } from '@/popup/services/near-wallet-client'
import {
  isPortfolioModelForScope,
  readCachedPortfolio,
  refreshPortfolioFromCache
} from '@/popup/services/portfolio-cache'
import { parsePublicPrivateEvmSendDraft } from './evm-send-validation'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import {
  getCrossChainSendAssetGroup,
  getCrossChainSendDestinationAssetId,
  getCrossChainSendTokenGroup,
  isCrossChainSendDestination
} from '@/popup/services/cross-chain-send-assets'
import { prefetchEvmSendCatalogs } from '@/popup/services/evm-send-catalog'
import { getEnabledSwapChains } from '@/popup/services/swap-catalog-loading'
import { rheaSwapClient } from '@/popup/services/rhea-swap-client'
import {
  resolveEvmFeatureRuntimePolicy,
  resolveSolanaFeatureRuntimePolicy
} from '@/core/chains/feature-runtime-policy'

type SendSubmission =
  | Readonly<{ family: 'evm'; value: EvmTransferSubmission }>
  | Readonly<{ family: 'bitcoin'; value: BitcoinTransferSubmission }>
  | Readonly<{ family: 'solana'; value: SolanaTransferSubmission }>
  | Readonly<{ family: 'near'; value: NearTransferSubmission }>

const crossChainCapabilities = Object.freeze({
  evm: resolveEvmFeatureRuntimePolicy(__ENABLED_CHAIN_FEATURE_FLAGS__).newOperationsEnabled,
  solana: resolveSolanaFeatureRuntimePolicy(__ENABLED_CHAIN_FEATURE_FLAGS__).newOperationsEnabled
})

function availableUsdPrice(
  asset: PortfolioReadModel['assets'][number],
  prices: AssetPriceReadModel | null
): string | null {
  return findAssetPrice(prices, asset.asset.id)?.priceUsd ?? null
}

function AssetSelection({
  assets,
  zcashTotal,
  zcashEnabled,
  zcashNetwork,
  zecPrice,
  prices,
  loadingAdditional,
  additionalError,
  onSelectZcash,
  onSelect,
  onRetry
}: {
  assets: readonly SendAsset[]
  zcashTotal: string
  zcashEnabled: boolean
  zcashNetwork: 'mainnet' | 'testnet'
  zecPrice: number
  prices: AssetPriceReadModel | null
  loadingAdditional: boolean
  additionalError: boolean
  onSelectZcash: () => void
  onSelect: (asset: SendAsset) => void
  onRetry: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedNetwork, setSelectedNetwork] = useState('all')
  const { networkOptions, selectedNetworkOption, selectedNetworkLabel, orderedRows } = useMemo(
    () =>
      buildSendAssetSelectionModel({
        assets,
        zcashTotal,
        zcashEnabled,
        zcashNetwork,
        zecPrice,
        prices,
        selectedNetwork,
        searchQuery: query,
        enabledFlags: __ENABLED_CHAIN_FEATURE_FLAGS__
      }),
    [assets, prices, query, selectedNetwork, zcashTotal, zcashEnabled, zcashNetwork, zecPrice]
  )
  return (
    <div className="page-content !px-4 pt-5">
      <TokenSelectionSearch
        value={query}
        onChange={setQuery}
        placeholder="Search your assets"
        ariaLabel="Search your assets"
        className="h-[46px] rounded-xl"
      />

      <div className="mb-2 mt-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-card px-3 text-xs text-foreground transition-colors hover:bg-accent"
            >
              {selectedNetworkOption ? (
                <ChainIcon
                  chain={selectedNetworkOption.iconAlias}
                  width={16}
                  height={16}
                  className="rounded-[4px]"
                  showTooltip={false}
                  alt=""
                  aria-hidden="true"
                />
              ) : (
                <Icon icon="lucide:network" width={16} height={16} className="text-muted" />
              )}
              {selectedNetworkLabel}
              <Icon icon="lucide:chevron-down" width={13} height={13} className="text-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            <DropdownMenuRadioGroup
              value={selectedNetworkOption ? selectedNetwork : 'all'}
              onValueChange={setSelectedNetwork}
            >
              <DropdownMenuRadioItem value="all" className="cursor-pointer">
                <Icon icon="lucide:network" width={16} height={16} className="text-muted" />
                <span>All Networks</span>
              </DropdownMenuRadioItem>
              {networkOptions.map(option => (
                <DropdownMenuRadioItem
                  key={option.id}
                  value={option.id}
                  disabled={option.disabled}
                  className={
                    option.disabled ? 'text-muted data-[disabled]:opacity-100' : 'cursor-pointer'
                  }
                >
                  <ChainIcon
                    chain={option.iconAlias}
                    width={16}
                    height={16}
                    className="rounded-[4px]"
                    showTooltip={false}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="flex-1">{option.label}</span>
                  {option.disabled && <span className="text-[10px]">Coming soon</span>}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div>
        <TokenSelectionList
          variant="send"
          items={orderedRows.map((row): TokenSelectionItem => {
            if (row.kind === 'zcash') {
              const networkName = zcashNetwork === 'testnet' ? 'Zcash Testnet' : 'Zcash'
              return {
                key: row.key,
                symbol: 'ZEC',
                ariaLabel: `Send ZEC on ${networkName}`,
                subtitle: networkName,
                icon: (
                  <TokenIcon
                    symbol="ZEC"
                    nativeChain="zcash"
                    blockchain="zec"
                    size={32}
                    className="shrink-0"
                  />
                ),
                balance: (
                  <TokenBalanceDisplay
                    amount={row.amount}
                    symbol="ZEC"
                    priceUsd={row.priceUsd}
                    approximateFiat
                  />
                )
              }
            }
            const { entry } = row
            const customToken =
              entry.asset.asset.kind === 'token' && entry.asset.source === 'user-added'
            const networkName = entry.chain.chain.displayName
            return {
              key: row.key,
              symbol: entry.asset.metadata.symbol,
              symbolSuffix: customToken ? (
                <span className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[9px] text-muted">
                  Custom
                </span>
              ) : undefined,
              ariaLabel: `Send ${entry.asset.metadata.symbol}${customToken ? ' custom Token' : ''} on ${networkName}`,
              subtitle: `${networkName}${customToken ? ` · ${formatSortAddress(entry.asset.asset.reference)}` : ''}`,
              icon: (
                <TokenIcon
                  assetId={entry.asset.asset.id}
                  symbol={entry.asset.metadata.symbol}
                  icon={entry.asset.metadata.iconUrl}
                  blockchain={resolveChainIconAlias(
                    entry.chain.chain.family,
                    networkName,
                    entry.chain.chain.id
                  )}
                  size={32}
                  className="shrink-0"
                />
              ),
              balance:
                entry.chain.chain.family === 'bitcoin' && entry.asset.updatedAt === 0 ? (
                  <p className="min-w-0 truncate text-right text-sm font-medium">
                    {entry.chain.status === 'error' ? 'Unavailable' : 'Updating…'}
                  </p>
                ) : (
                  <TokenBalanceDisplay
                    amount={row.amount}
                    symbol={entry.asset.metadata.symbol}
                    priceUsd={row.priceUsd}
                    approximateFiat
                  />
                )
            }
          })}
          onSelect={key => {
            const row = orderedRows.find(item => item.key === key)
            if (row?.kind === 'zcash') onSelectZcash()
            else if (row) onSelect(row.entry)
          }}
          emptyMessage={!loadingAdditional && !additionalError ? 'No assets found' : undefined}
        />
        {loadingAdditional && (
          <div
            role="status"
            aria-label="Loading additional networks"
            className="flex animate-pulse items-center gap-3 py-3"
          >
            <div className="size-10 rounded-full bg-card" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-16 rounded bg-card" />
              <div className="h-2.5 w-28 rounded bg-card/70" />
            </div>
          </div>
        )}
        {additionalError && (
          <InlineError
            message="Additional networks are unavailable."
            onRetry={onRetry}
            className="mt-2 px-3 py-2.5"
          />
        )}
      </div>
    </div>
  )
}

export function MultichainSend() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const requestedAssetId = searchParams.get('assetId')
  const requestedSourceMode = searchParams.get('sourceMode')
  const requestedRecipient = searchParams.get('recipient')
  const { goBack, navigate, replace } = useNavigate()
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const zecPrice = useWalletStore(state => state.zecPrice)
  const chainEndpointRuntimeKey = useSettingsStore(state =>
    getChainEndpointRuntimeKey(state.chainEndpointSettings)
  )
  const zcashTotal = useAccountDataStore(state => state.getCurrentBalance()?.total ?? '0')
  const requestSequence = useRef(0)
  const appliedRequestedAssetRef = useRef<string | null>(null)
  const [modelSnapshot, setModelSnapshot] = useState<{
    scopeKey: string
    value: PortfolioReadModel | null
  } | null>(null)
  const [assetPriceSnapshot, setAssetPriceSnapshot] = useState<{
    scopeKey: string
    value: AssetPriceReadModel | null
  } | null>(null)
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectionSnapshot, setSelectionSnapshot] = useState<{
    scopeKey: string
    entryKey: string
    requestedAssetId: string | null
    value: SendAsset | null
  } | null>(null)
  const [submission, setSubmission] = useState<SendSubmission | null>(null)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [destinationCatalog, setDestinationCatalog] = useState<{
    key: string
    assetIds: readonly string[]
  } | null>(null)
  const { activeAccount: storageV2Account } = useActiveAccountNetworks()
  const effectiveAccount = resolveEffectiveActiveAccountIdentity({
    currentWalletId,
    currentAccountId,
    nativeAccount: storageV2Account
  })
  const effectiveWalletId = effectiveAccount?.walletId ?? null
  const effectiveAccountId = effectiveAccount?.accountId ?? null
  const scopeKey = JSON.stringify([
    effectiveWalletId,
    effectiveAccountId,
    currentNetwork,
    chainEndpointRuntimeKey
  ])
  const sendEntryKey = `${location.key}:${scopeKey}`
  const [domainSession, setDomainSession] = useState<{
    key: string
    routeKey: string
    source: 'main' | 'shield'
    publicVisited: boolean
    publicRecipient: string
    shieldEntry: ShieldWithdrawEntry | null
  } | null>(null)
  const initialSource =
    domainSession?.routeKey === location.key
      ? domainSession.source
      : requestedSourceMode === 'shield'
        ? 'shield'
        : 'main'
  const currentSession =
    domainSession?.key === sendEntryKey
      ? domainSession
      : {
          key: sendEntryKey,
          routeKey: location.key,
          source: initialSource,
          publicVisited: initialSource !== 'shield',
          publicRecipient: requestedRecipient ?? '',
          shieldEntry:
            initialSource === 'shield'
              ? {
                  assetId: requestedAssetId,
                  networkId: searchParams.get('networkId'),
                  recipient: requestedRecipient ?? '',
                  provider: searchParams.get('provider')
                }
              : null
        }
  const shieldActive = currentSession.source === 'shield'
  const [{ reviewing: shieldReviewing, busy: shieldBusy }, setShieldState] = useState({
    reviewing: false,
    busy: false
  })
  const handleShieldStateChange = useCallback(
    (next: { readonly reviewing: boolean; readonly busy: boolean }) => {
      setShieldState(previous =>
        previous.reviewing === next.reviewing && previous.busy === next.busy ? previous : next
      )
    },
    []
  )
  const setSelection = (value: SendAsset | null) =>
    setSelectionSnapshot({ scopeKey, entryKey: location.key, requestedAssetId, value })
  const navigationSnapshot = location.state as {
    initialPortfolio?: PortfolioReadModel | null
    initialPrices?: AssetPriceReadModel | null
    walletId?: string | null
    accountId?: string | null
    network?: string
    endpointRuntimeKey?: string
    sendEntry?: 'asset-detail' | 'shield'
  } | null
  const sendEntry =
    navigationSnapshot?.sendEntry === 'asset-detail' || navigationSnapshot?.sendEntry === 'shield'
      ? navigationSnapshot.sendEntry
      : null
  const returnToEntry =
    sendEntry !== null
      ? goBack
      : () => {
          if (shieldActive) navigate('/send', { replace: true, state: navigationSnapshot })
          setSelection(null)
          setAssetPickerOpen(true)
        }
  const initialPortfolio =
    navigationSnapshot?.walletId === effectiveWalletId &&
    navigationSnapshot?.accountId === effectiveAccountId &&
    navigationSnapshot?.network === currentNetwork &&
    navigationSnapshot?.endpointRuntimeKey === chainEndpointRuntimeKey &&
    isPortfolioModelForScope(
      navigationSnapshot?.initialPortfolio ?? null,
      effectiveWalletId,
      effectiveAccountId
    )
      ? navigationSnapshot.initialPortfolio
      : null
  const model = modelSnapshot?.scopeKey === scopeKey ? modelSnapshot.value : null
  const visibleModel =
    loadStatus === 'loading' &&
    initialPortfolio &&
    (model?.assets.length ?? 0) < initialPortfolio.assets.length
      ? initialPortfolio
      : (model ?? initialPortfolio)
  const initialPrices =
    initialPortfolio && navigationSnapshot?.initialPrices?.status !== 'error'
      ? (navigationSnapshot?.initialPrices ?? null)
      : null
  const cachedPrices = assetPriceSnapshot?.scopeKey === scopeKey ? assetPriceSnapshot.value : null
  const assetPrices =
    cachedPrices &&
    (!initialPrices ||
      (cachedPrices.fetchedAt >= initialPrices.fetchedAt &&
        cachedPrices.quotes.length >= initialPrices.quotes.length))
      ? cachedPrices
      : initialPrices
  const zcashEnabled =
    storageV2Account?.networks.some(network => network.chain.family === 'zcash') ?? true

  useEffect(() => {
    let cancelled = false
    void prefetchEvmSendCatalogs(
      storageV2Account?.networks.map(network => network.chain) ?? [],
      requestedAssetId?.split('/')[0],
      () => cancelled
    )
    return () => {
      cancelled = true
    }
  }, [storageV2Account, requestedAssetId])

  const load = useCallback(
    async (forceRefresh = false) => {
      const request = ++requestSequence.current
      setLoadStatus('loading')
      try {
        if (!effectiveWalletId || !effectiveAccountId) {
          setLoadStatus('error')
          return
        }
        const scope = {
          walletId: effectiveWalletId,
          accountId: effectiveAccountId,
          endpointRuntimeKey: chainEndpointRuntimeKey
        }
        const cached = await readCachedPortfolio(scope)
        if (request !== requestSequence.current) return
        if (cached) setModelSnapshot({ scopeKey, value: cached })
        const refreshed = await refreshPortfolioFromCache(scope, cached, { forceRefresh })
        if (request !== requestSequence.current) return
        setModelSnapshot({ scopeKey, value: refreshed })
        setLoadStatus(refreshed ? 'ready' : 'error')
      } catch {
        if (request === requestSequence.current) setLoadStatus('error')
      }
    },
    [chainEndpointRuntimeKey, effectiveAccountId, effectiveWalletId, scopeKey]
  )

  const readLatest = useCallback(async () => {
    const request = requestSequence.current
    try {
      if (!effectiveWalletId || !effectiveAccountId) return
      const latest = await readCachedPortfolio({
        walletId: effectiveWalletId,
        accountId: effectiveAccountId
      })
      if (request !== requestSequence.current) return
      setModelSnapshot({ scopeKey, value: latest })
      setLoadStatus(latest ? 'ready' : 'error')
    } catch {
      if (request === requestSequence.current && !visibleModel) setLoadStatus('error')
    }
  }, [effectiveAccountId, effectiveWalletId, scopeKey, visibleModel])

  useEffect(() => {
    setSelectionSnapshot(null)
    setSubmission(null)
    setAssetPickerOpen(false)
    setModelSnapshot(null)
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [effectiveWalletId, effectiveAccountId, chainEndpointRuntimeKey, load])

  useEffect(() => {
    let cancelled = false
    void assetPriceClient
      .getPrices('read')
      .then(prices => {
        if (!cancelled && prices && prices.status !== 'error' && prices.quotes.length > 0)
          setAssetPriceSnapshot({ scopeKey, value: prices })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [scopeKey])

  usePortfolioUpdates(effectiveWalletId, effectiveAccountId, readLatest)

  const assets = useMemo<readonly SendAsset[]>(() => {
    if (!visibleModel) return []
    const chainById = new Map(visibleModel.chains.map(chain => [chain.chain.id, chain]))
    return visibleModel.assets.flatMap(asset => {
      const chain = chainById.get(asset.asset.chainId)
      return chain &&
        isSelectableChainFamily(chain.chain.family, __ENABLED_CHAIN_FEATURE_FLAGS__) &&
        (chain.chain.family === 'evm' ||
          chain.chain.family === 'bitcoin' ||
          chain.chain.family === 'solana' ||
          chain.chain.family === 'near') &&
        chain.chain.capabilities.transaction.status === 'available'
        ? [{ asset, chain }]
        : []
    })
  }, [visibleModel])
  const selectedAssetId =
    selectionSnapshot?.scopeKey === scopeKey &&
    selectionSnapshot.entryKey === location.key &&
    selectionSnapshot.requestedAssetId === requestedAssetId
      ? (selectionSnapshot.value?.asset.asset.id ?? null)
      : requestedAssetId
  const selection = assets.find(item => item.asset.asset.id === selectedAssetId) ?? null
  const crossChainGroup =
    selection?.chain.chain.family === 'evm' && currentNetwork === 'mainnet'
      ? getCrossChainSendAssetGroup(selection.asset.asset)
      : null
  const destinationCandidates = useMemo(
    () =>
      crossChainGroup && selection && visibleModel
        ? visibleModel.chains.flatMap(chain => {
            if (
              chain.chain.id === selection.chain.chain.id ||
              !storageV2Account?.networks.some(network => network.chain.id === chain.chain.id) ||
              !isSelectableChainFamily(chain.chain.family, __ENABLED_CHAIN_FEATURE_FLAGS__) ||
              chain.chain.capabilities.transaction.status !== 'available'
            )
              return []
            const assetId = getCrossChainSendDestinationAssetId(chain.chain.id, crossChainGroup)
            const descriptor = getEnabledSwapChains([chain.chain])[0]
            return assetId &&
              descriptor &&
              ((descriptor.walletFamily === 'evm' && crossChainCapabilities.evm) ||
                (descriptor.walletFamily === 'solana' && crossChainCapabilities.solana))
              ? [{ assetId, chain }]
              : []
          })
        : [],
    [crossChainGroup, selection, storageV2Account, visibleModel]
  )
  const destinationCatalogKey = JSON.stringify([
    scopeKey,
    selection?.asset.asset.id,
    destinationCandidates.map(item => item.assetId)
  ])
  useEffect(() => {
    if (shieldActive) return
    if (!crossChainGroup || !selection || destinationCandidates.length === 0) {
      setDestinationCatalog(null)
      return
    }
    const sourceDescriptor = getEnabledSwapChains([selection.chain.chain])[0]
    const destinationDescriptors = destinationCandidates.map(
      item => getEnabledSwapChains([item.chain.chain])[0]
    )
    if (!sourceDescriptor || destinationDescriptors.some(descriptor => !descriptor)) return
    let cancelled = false
    void Promise.all([
      rheaSwapClient.listTokens({
        direction: 'from',
        tokenListChainIds: [sourceDescriptor.tokenListChainId]
      }),
      rheaSwapClient.listTokens({
        direction: 'cross-chain-to',
        tokenListChainIds: destinationDescriptors.map(descriptor => descriptor!.tokenListChainId)
      })
    ])
      .then(([sourceCatalog, destinationCatalog]) => {
        if (cancelled) return
        const sourceToken = sourceCatalog.tokens.find(
          token =>
            token.rheaChainId === sourceDescriptor.apiChainId &&
            getCrossChainSendTokenGroup(token) === crossChainGroup
        )
        const assetIds = sourceToken
          ? destinationCandidates.flatMap((item, index) => {
              const destinationToken = destinationCatalog.tokens.find(
                token =>
                  token.rheaChainId === destinationDescriptors[index]?.apiChainId &&
                  getCrossChainSendTokenGroup(token) === crossChainGroup &&
                  isCrossChainSendDestination(sourceToken, token, crossChainCapabilities)
              )
              return destinationToken ? [item.assetId] : []
            })
          : []
        setDestinationCatalog({ key: destinationCatalogKey, assetIds })
      })
      .catch(() => {
        if (!cancelled) setDestinationCatalog({ key: destinationCatalogKey, assetIds: [] })
      })
    return () => {
      cancelled = true
    }
  }, [shieldActive, crossChainGroup, destinationCatalogKey, destinationCandidates, selection])
  const availableDestinationNetworks =
    destinationCatalog?.key === destinationCatalogKey
      ? destinationCandidates.filter(item => destinationCatalog.assetIds.includes(item.assetId))
      : []

  useEffect(() => {
    if (selection?.chain.chain.family !== 'evm' || requestedSourceMode !== 'private') return
    replace(
      `/transfer?${new URLSearchParams({
        assetId: selection.asset.asset.id,
        from: 'private',
        to: 'shield'
      })}`
    )
  }, [replace, requestedSourceMode, selection])

  const leaveOnchainResult = useCallback(
    (path: string, shouldOffer: boolean) => {
      const graph = submission?.value.graph
      const recipient = graph?.root.intent?.recipient
      const sender = graph?.root.intent?.sender
      const chain = selection?.chain.chain
      if (path === '/send') {
        setSubmission(null)
        setAssetPickerOpen(false)
        navigate(
          selection
            ? `/send?${new URLSearchParams({
                assetId: selection.asset.asset.id,
                sourceMode: 'main'
              })}`
            : '/send',
          { replace: true }
        )
      } else {
        navigate(path)
      }
      if (
        !shouldOffer ||
        !recipient ||
        !chain ||
        (chain.family !== 'evm' && chain.family !== 'bitcoin') ||
        (chain.network.kind !== 'mainnet' && chain.network.kind !== 'testnet')
      ) {
        return
      }
      void offerSaveRecipient({
        chainId: chain.id,
        chainFamily: chain.family,
        network: chain.network.kind,
        networkName: chain.displayName,
        address: recipient.address,
        name: 'Recipient',
        selfTransfer:
          graph?.root.intent?.direction === 'self' ||
          (sender?.address.toLowerCase() === recipient.address.toLowerCase() &&
            sender.chainId === recipient.chainId)
      })
    },
    [navigate, selection, submission]
  )

  useEffect(() => {
    if (
      shieldActive ||
      !selectedAssetId ||
      !visibleModel ||
      appliedRequestedAssetRef.current === `${sendEntryKey}:${selectedAssetId}`
    ) {
      return
    }
    const requested = visibleModel.assets.find(asset => asset.asset.id === selectedAssetId)
    if (!requested) {
      if (loadStatus !== 'loading')
        appliedRequestedAssetRef.current = `${sendEntryKey}:${selectedAssetId}`
      return
    }
    const chain = visibleModel.chains.find(item => item.chain.id === requested.asset.chainId)
    appliedRequestedAssetRef.current = `${sendEntryKey}:${selectedAssetId}`
    if (chain?.chain.family === 'zcash') {
      navigate('/send/zcash', { replace: true })
      return
    }
  }, [loadStatus, visibleModel, navigate, selectedAssetId, shieldActive, sendEntryKey])

  if (submission?.family === 'evm' && selection?.chain.chain.family === 'evm') {
    return (
      <EvmTransactionResult
        asset={selection.asset}
        chain={selection.chain}
        submission={submission.value}
        onDone={outcome => leaveOnchainResult('/send', outcome !== 'failed')}
        onViewActivity={transactionId =>
          leaveOnchainResult(
            `/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`,
            true
          )
        }
      />
    )
  }

  if (submission?.family === 'bitcoin' && selection?.chain.chain.family === 'bitcoin') {
    return (
      <BitcoinTransactionResult
        asset={selection.asset}
        chain={selection.chain}
        submission={submission.value}
        onDone={outcome => leaveOnchainResult('/send', outcome !== 'failed')}
        onViewActivity={transactionId =>
          leaveOnchainResult(
            `/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`,
            true
          )
        }
      />
    )
  }

  if (submission?.family === 'solana' && selection?.chain.chain.family === 'solana') {
    return (
      <SolanaTransactionResult
        asset={selection.asset}
        chain={selection.chain}
        submission={submission.value}
        onDone={outcome => leaveOnchainResult('/send', outcome !== 'failed')}
        onViewActivity={transactionId =>
          leaveOnchainResult(
            `/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`,
            true
          )
        }
      />
    )
  }

  if (submission?.family === 'near' && selection?.chain.chain.family === 'near') {
    return (
      <NearTransactionResult
        asset={selection.asset}
        chain={selection.chain}
        submission={submission.value}
        onDone={outcome => leaveOnchainResult('/send', outcome !== 'failed')}
        onViewActivity={transactionId =>
          leaveOnchainResult(
            `/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`,
            true
          )
        }
      />
    )
  }

  const walletMode = 'public'
  const nonEvmCrossChainSourceAssetId =
    selection?.chain.chain.family !== 'evm' &&
    selection &&
    currentNetwork === 'mainnet' &&
    getCrossChainSendAssetGroup(selection.asset.asset)
      ? selection.asset.asset.id
      : null
  const publicPrivateDraft =
    selection && effectiveWalletId && effectiveAccountId
      ? parsePublicPrivateEvmSendDraft(searchParams, {
          walletId: effectiveWalletId,
          accountId: effectiveAccountId,
          network: currentNetwork,
          assetId: selection.asset.asset.id
        })
      : null
  const preparingRequestedAsset = Boolean(
    !assetPickerOpen && requestedAssetId && !selection && loadStatus === 'loading'
  )
  const switchSource = (
    sourceMode: 'main' | 'shield',
    assetId: string | null,
    recipient: string,
    networkId?: string
  ) => {
    setAssetPickerOpen(false)
    if (sourceMode === 'main' && !currentSession.publicVisited)
      setSelection(assets.find(item => item.asset.asset.id === assetId) ?? null)
    setDomainSession({
      ...currentSession,
      source: sourceMode,
      publicVisited: currentSession.publicVisited || sourceMode === 'main',
      publicRecipient:
        sourceMode === 'main' && !currentSession.publicVisited
          ? recipient
          : currentSession.publicRecipient,
      shieldEntry:
        currentSession.shieldEntry ??
        (sourceMode === 'shield'
          ? { assetId, recipient, networkId: networkId ?? null, provider: 'near-confidential' }
          : null)
    })
  }
  return (
    <div className="page-container" data-wallet-mode={walletMode}>
      {!(shieldActive && shieldReviewing) && (
        <PageHeader
          title="Send"
          showBack
          onBack={
            shieldActive
              ? () => {
                  if (!shieldBusy) returnToEntry()
                }
              : assetPickerOpen && selection
                ? () => setAssetPickerOpen(false)
                : selection
                  ? returnToEntry
                  : goBack
          }
          rightContent={
            !shieldActive && !assetPickerOpen && nonEvmCrossChainSourceAssetId ? (
              <SendRouteMenu
                route="onchain"
                onChange={route => {
                  if (route !== 'cross-chain' || !effectiveWalletId || !effectiveAccountId) return
                  navigate(
                    `/send/cross-chain?${new URLSearchParams({
                      source: nonEvmCrossChainSourceAssetId,
                      sourceMode: 'main',
                      sourceWalletId: effectiveWalletId,
                      sourceAccountId: effectiveAccountId
                    })}`,
                    {
                      replace: true,
                      state: { returnToSendAssetId: nonEvmCrossChainSourceAssetId, sendEntry }
                    }
                  )
                }}
              />
            ) : undefined
          }
        />
      )}
      {currentSession.shieldEntry && (
        <div
          hidden={!shieldActive}
          className={shieldActive ? 'flex min-h-0 flex-1 flex-col' : undefined}
        >
          <ShieldWithdrawForm
            key={sendEntryKey}
            active={shieldActive}
            entry={currentSession.shieldEntry}
            model={visibleModel ?? null}
            initialAsset={
              assets.find(item => item.asset.asset.id === currentSession.shieldEntry?.assetId)
                ?.asset ?? null
            }
            refresh={load}
            onStateChange={handleShieldStateChange}
            onSelectPublic={(assetId, recipient) => switchSource('main', assetId, recipient)}
          />
        </div>
      )}
      {currentSession.publicVisited && selection && (
        <div className={shieldActive || assetPickerOpen ? 'hidden' : 'contents'}>
          {selection.chain.chain.family === 'evm' && visibleModel ? (
            requestedSourceMode === 'private' ? null : (
              <EvmSendForm
                key={`${sendEntryKey}:${selection.asset.asset.id}`}
                active={!shieldActive && !assetPickerOpen}
                walletMode={walletMode}
                onSelectAsset={() => setAssetPickerOpen(true)}
                onSelectShield={recipient =>
                  switchSource(
                    'shield',
                    selection.asset.asset.id,
                    recipient,
                    selection.chain.chain.id
                  )
                }
                destinationNetworks={[
                  {
                    assetId: selection.asset.asset.id,
                    chainId: selection.chain.chain.id,
                    name: selection.chain.chain.displayName,
                    icon: resolveChainIconAlias(
                      selection.chain.chain.family,
                      selection.chain.chain.displayName,
                      selection.chain.chain.id
                    )
                  },
                  ...availableDestinationNetworks.map(item => ({
                    assetId: item.assetId,
                    chainId: item.chain.chain.id,
                    name: item.chain.chain.displayName,
                    icon: resolveChainIconAlias(
                      item.chain.chain.family,
                      item.chain.chain.displayName,
                      item.chain.chain.id
                    )
                  }))
                ]}
                onSelectDestinationNetwork={(destinationAssetId, draft) => {
                  if (!effectiveWalletId || !effectiveAccountId) return
                  const destination = availableDestinationNetworks.find(
                    item => item.assetId === destinationAssetId
                  )
                  if (!destination) return
                  navigate(
                    `/send/cross-chain?${new URLSearchParams({
                      source: selection.asset.asset.id,
                      destination: destinationAssetId,
                      sourceMode: 'main',
                      sourceWalletId: effectiveWalletId,
                      sourceAccountId: effectiveAccountId,
                      ...(draft.recipient ? { recipient: draft.recipient } : {}),
                      ...(draft.amount ? { amount: draft.amount } : {})
                    })}`,
                    {
                      replace: true,
                      state: { returnToSendAssetId: selection.asset.asset.id, sendEntry }
                    }
                  )
                }}
                selection={selection}
                portfolio={visibleModel}
                priceUsd={availableUsdPrice(selection.asset, assetPrices)}
                sourceMode="main"
                onFundPrivate={
                  currentNetwork === 'mainnet'
                    ? () =>
                        navigate(
                          `/transfer?${new URLSearchParams({
                            assetId: selection.asset.asset.id,
                            from: 'public',
                            to: 'private',
                            mode: walletMode
                          })}`
                        )
                    : undefined
                }
                initialRecipient={
                  currentSession.publicRecipient &&
                  /^0x[0-9a-fA-F]{40}$/.test(currentSession.publicRecipient)
                    ? currentSession.publicRecipient
                    : undefined
                }
                initialDraft={publicPrivateDraft ?? undefined}
                onSubmitted={value => setSubmission({ family: 'evm', value })}
              />
            )
          ) : selection?.chain.chain.family === 'bitcoin' ? (
            <BitcoinSendForm
              key={`${sendEntryKey}:${selection.asset.asset.id}`}
              selection={selection}
              priceUsd={availableUsdPrice(selection.asset, assetPrices)}
              onSubmitted={value => setSubmission({ family: 'bitcoin', value })}
            />
          ) : selection?.chain.chain.family === 'solana' ? (
            <SolanaSendForm
              key={`${sendEntryKey}:${selection.asset.asset.id}`}
              selection={selection}
              priceUsd={availableUsdPrice(selection.asset, assetPrices)}
              onSubmitted={value => setSubmission({ family: 'solana', value })}
            />
          ) : selection?.chain.chain.family === 'near' ? (
            <NearSendForm
              key={`${sendEntryKey}:${selection.asset.asset.id}`}
              selection={selection}
              priceUsd={availableUsdPrice(selection.asset, assetPrices)}
              onSubmitted={value => setSubmission({ family: 'near', value })}
            />
          ) : null}
        </div>
      )}
      {!shieldActive && (assetPickerOpen || (!selection && !preparingRequestedAsset)) && (
        <AssetSelection
          assets={assets}
          zcashTotal={zcashTotal}
          zcashEnabled={zcashEnabled}
          zcashNetwork={currentNetwork}
          zecPrice={zecPrice}
          prices={assetPrices}
          loadingAdditional={loadStatus === 'loading'}
          additionalError={loadStatus === 'error' && !visibleModel}
          onSelectZcash={() => navigate('/send/zcash')}
          onRetry={() => void load(true)}
          onSelect={asset => {
            setSelection(asset)
            setAssetPickerOpen(false)
          }}
        />
      )}
      {!shieldActive && preparingRequestedAsset && (
        <div className="page-content" role="status" aria-label="Loading asset" />
      )}
    </div>
  )
}
