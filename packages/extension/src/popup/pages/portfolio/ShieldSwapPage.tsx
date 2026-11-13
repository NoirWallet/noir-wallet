import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { fetchSwapTokens, getCachedTokens, type SwapToken } from '@/core/services/intents-api'
import type { ConfidentialFundingReview } from '@/core/services/confidential-funding'
import { formatBaseUnitAmount, formatBaseUnitDecimalAmount } from '@/lib/number-format'
import { formatSortAddress, formatSymbol } from '@/lib/format'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { useWalletStore } from '@/store/wallet-store'
import { useSettingsStore } from '@/store/settings-store'
import { useSwapPreferences } from '@/store/swap-store'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { useHomePortfolio } from '@/popup/hooks/useHomePortfolio'
import { useConfidentialFundingPreview } from '@/popup/hooks/useConfidentialFundingPreview'
import { useShieldBalances } from '@/popup/hooks/useShieldBalances'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { getPrivateTransferChainIds } from '@/popup/services/private-balance-transfer'
import { getEvmNetworkConfigs } from '@/config/networks'
import { useNavigate } from '@/popup/provider/Router'
import { SwapAssetCard, SwapProviderCard } from '@/popup/components/swap/SwapInputView'
import { getSwapAmountValues } from '@/popup/components/swap/swap-estimate'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import { TokenBalanceDisplay } from '@/popup/components/tokens/TokenBalanceDisplay'
import { TokenSelectorView } from '@/popup/components/tokens/TokenSelectorView'
import {
  shieldSourceSelectionItem,
  type ShieldSourceTokenPickerItem
} from '@/popup/components/tokens/ShieldSourceTokenPickerRows'
import {
  TransactionReviewExchangeSummary,
  TransactionReviewView
} from '@/popup/components/transaction/TransactionReviewView'
import { openConfidentialActivity } from '@/popup/components/transaction/ConfidentialActivitySheet'
import { Button } from '@/popup/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/popup/components/ui/dialog'
import {
  CONFIDENTIAL_PREVIEW_CONNECTION_ERROR,
  confidentialFundingClient,
  type PrepareConfidentialFundingRequest
} from '@/popup/services/confidential-funding-client'
import { resolveManagedIntentsCatalog } from '@/popup/services/intents-asset-manager-client'
import { swapTokenCatalogClient } from '@/popup/services/swap-token-catalog-client'
import {
  hasShieldTransferStarted,
  formatShieldQuoteTime,
  isUnsignedShieldTerminal,
  listShieldFundingAssets,
  selectDefaultShieldWithdrawSource,
  shieldPortfolioBalances,
  shieldFundingSources,
  shieldFundingAvailableRaw,
  type ShieldFundingAsset
} from '@/popup/services/shield-transfer'
import {
  buildShieldSwapRequest,
  formatShieldSwapPreviewRate,
  matchesShieldSwapReview,
  shieldSwapFormAmountError,
  shieldSwapFormBalance
} from '@/popup/services/shield-swap-form'
import {
  buildShieldSwapZecSourceOptions,
  resolveShieldConfidentialFromAssetId,
  SHIELD_SWAP_ZEC_INTENTS_SELECTION_ID,
  SHIELD_SWAP_ZEC_NATIVE_SELECTION_ID
} from '@/popup/services/shield-swap-zec-sources'

function shieldOriginIdentifier(
  asset: ShieldFundingAsset,
  options: readonly ShieldFundingAsset[]
): string | null {
  const peers = options.filter(
    candidate =>
      candidate.chain.chain.id === asset.chain.chain.id &&
      candidate.asset.metadata.symbol === asset.asset.metadata.symbol
  )
  if (asset.asset.asset.kind === 'native' && peers.length === 1) return null
  const identityOf = (candidate: ShieldFundingAsset) => {
    const reference = candidate.asset.asset.reference
    return peers.some(other => other !== candidate && other.asset.asset.reference === reference)
      ? candidate.managed.protocolAssetId
      : reference
  }
  const identity = identityOf(asset)
  const peerIdentities = peers.filter(candidate => candidate !== asset).map(identityOf)
  const initial = formatSortAddress(identity)
  if (peerIdentities.every(candidate => formatSortAddress(candidate) !== initial)) return initial
  for (let visible = 7; visible <= identity.length; visible += 1) {
    const short = (value: string) =>
      value.length > visible * 2 ? `${value.slice(0, visible)}...${value.slice(-visible)}` : value
    const label = short(identity)
    if (peerIdentities.every(candidate => short(candidate) !== label)) return label
  }
  return identity
}

interface ShieldSwapPageProps {
  readonly active: boolean
  readonly amountFocusToken?: number
  readonly onStateChange: (state: { readonly reviewing: boolean; readonly busy: boolean }) => void
  readonly onSelectNativeZecSwap?: () => void
}

export function ShieldSwapPage(props: ShieldSwapPageProps) {
  const walletId = useWalletStore(state => state.currentWalletId)
  const accountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)
  return <ShieldSwapForm key={`${network}:${walletId}:${accountId}`} {...props} />
}

function ShieldSwapForm({
  active,
  amountFocusToken,
  onStateChange,
  onSelectNativeZecSwap
}: ShieldSwapPageProps) {
  const [params] = useSearchParams()
  const { navigate } = useNavigate()
  const routeSourceAssetId = params.get('assetId')
  const routeDestinationAssetId = params.get('destination')
  const providerIsNear =
    params.get('provider') === null || params.get('provider') === 'near-confidential'
  const walletId = useWalletStore(state => state.currentWalletId)
  const accountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)
  const { activeAccount } = useActiveAccountNetworks()
  const account = resolveEffectiveActiveAccountIdentity({
    currentWalletId: walletId,
    currentAccountId: accountId,
    nativeAccount: activeAccount
  })
  const canManageNear =
    providerIsNear && getPrivateTransferChainIds(activeAccount, network === 'mainnet').length > 0
  const zcashAccountEnabled =
    activeAccount?.networks.some(item => item.chain.family === 'zcash') ?? false
  const scopeKey = `${network}:${account?.walletId ?? ''}:${account?.accountId ?? ''}`
  const latestScope = useRef(scopeKey)
  latestScope.current = scopeKey
  const mounted = useRef(false)
  const { model, status, refresh } = useHomePortfolio(
    account?.walletId ?? null,
    account?.accountId ?? null
  )
  const hidden = useSettingsStore(state => state.balancesHidden)
  const [tokens, setTokens] = useState<readonly SwapToken[]>(getCachedTokens)
  const managedAssets = useMemo(() => resolveManagedIntentsCatalog(tokens), [tokens])
  const [fromId, setFromId] = useState<string | null>(routeSourceAssetId)
  const [toId, setToId] = useState<string | null>(routeDestinationAssetId)
  const [amount, setAmount] = useState('')
  const slippage = useSwapPreferences(state => state.slippage)
  const slippageBps = Math.round(slippage * 100)
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [search, setSearch] = useState('')
  const [pickerNetwork, setPickerNetwork] = useState('all')
  const [prepared, setPrepared] = useState<Readonly<{
    review: ConfidentialFundingReview
    request: PrepareConfidentialFundingRequest
    from: ShieldFundingAsset
    to: ShieldFundingAsset
    amount: string
  }> | null>(null)
  const [acceptedPlanId, setAcceptedPlanId] = useState<string | null>(null)
  const [previousRate, setPreviousRate] = useState<string | null>(null)
  const [refreshingReview, setRefreshingReview] = useState(false)
  const [showReviewMore, setShowReviewMore] = useState(false)
  const cancelledPlanId = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmationAttempt = useRef<string | null>(null)
  const {
    balances: currentBalances,
    connecting,
    error: balanceError,
    refreshBalances: loadBalances
  } = useShieldBalances({
    active,
    enabled: canManageNear,
    scopeKey,
    scope: account
      ? { network, keyDomainId: account.walletId, accountId: account.accountId }
      : null,
    refreshPortfolio: refresh
  })

  useLayoutEffect(() => {
    onStateChange({ reviewing: active && Boolean(prepared), busy: active && busy })
  }, [active, prepared, busy, onStateChange])

  useLayoutEffect(() => () => onStateChange({ reviewing: false, busy: false }), [onStateChange])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (active && !providerIsNear) navigate('/shield-funds', { replace: true })
  }, [active, providerIsNear, navigate])

  useEffect(() => {
    if (!active) setPicker(null)
  }, [active])

  useEffect(() => {
    setFromId(routeSourceAssetId)
    setToId(routeDestinationAssetId)
    setAmount('')
    setPicker(null)
    setSearch('')
    setPickerNetwork('all')
    setPrepared(null)
    setBusy(false)
    setUncertain(false)
    setError(null)
    confirmationAttempt.current = null
  }, [scopeKey, routeSourceAssetId, routeDestinationAssetId])

  useEffect(() => {
    if (!active) return
    let current = true
    const load = async () => {
      try {
        if (getCachedTokens().length === 0) {
          const cached = await swapTokenCatalogClient.readCached()
          if (current && cached.length) setTokens(cached)
        }
        const refreshed = await fetchSwapTokens()
        if (current && refreshed.length) {
          setTokens(refreshed)
        }
      } catch {
        /* The cached catalog remains available. */
      }
    }
    void load()
    return () => {
      current = false
    }
  }, [active, network])

  const options = useMemo(
    () => listShieldFundingAssets(model, managedAssets, tokens, network),
    [model, managedAssets, tokens, network]
  )
  const originIdentifiers = useMemo(
    () =>
      new Map(options.map(asset => [asset.asset.asset.id, shieldOriginIdentifier(asset, options)])),
    [options]
  )
  const portfolioBalances = useMemo(() => shieldPortfolioBalances(model), [model])
  const displayBalances = currentBalances ?? portfolioBalances
  const sourceChoices = useMemo(() => {
    const funded = shieldFundingSources(options, displayBalances)
    const fundedIds = new Set(funded.map(asset => asset.asset.asset.id))
    return [...funded, ...options.filter(asset => !fundedIds.has(asset.asset.asset.id))]
  }, [options, displayBalances])
  const zecSourceOptions = useMemo(
    () =>
      buildShieldSwapZecSourceOptions({
        network,
        sources: sourceChoices,
        balances: displayBalances,
        portfolio: model,
        enabledFlags: __ENABLED_CHAIN_FEATURE_FLAGS__,
        zcashAccountEnabled,
        keySource: useWalletStore.getState().getCurrentWallet()?.keySource
      }),
    [network, sourceChoices, displayBalances, model, zcashAccountEnabled]
  )
  const confidentialFromAssetId = fromId
    ? resolveShieldConfidentialFromAssetId(fromId, zecSourceOptions)
    : null
  const defaultSource = selectDefaultShieldWithdrawSource(
    options,
    displayBalances,
    model,
    null,
    network
  )
  const from = confidentialFromAssetId
    ? (sourceChoices.find(asset => asset.asset.asset.id === confidentialFromAssetId) ?? null)
    : (sourceChoices.find(
        asset =>
          asset.asset.asset.id === defaultSource?.asset.asset.id && asset.asset.asset.id !== toId
      ) ??
      sourceChoices.find(asset => asset.asset.asset.id !== toId) ??
      null)
  const ethereumUsdcContract = getEvmNetworkConfigs(network)
    .find(config => config.chainId === 'eip155:1')
    ?.usdcContract?.toLowerCase()
  const to = toId
    ? (options.find(asset => asset.asset.asset.id === toId) ?? null)
    : (options.find(
        asset =>
          asset.asset.asset.chainId === 'eip155:1' &&
          asset.asset.asset.namespace === 'erc20' &&
          asset.asset.asset.reference.toLowerCase() === ethereumUsdcContract &&
          asset.asset.asset.id !== from?.asset.asset.id
      ) ??
      options.find(
        asset =>
          asset.asset.asset.chainId === 'eip155:1' &&
          asset.asset.asset.kind === 'native' &&
          asset.asset.asset.id !== from?.asset.asset.id
      ) ??
      options.find(asset => asset.asset.asset.id !== from?.asset.asset.id) ??
      null)
  const canReverse = Boolean(
    to && sourceChoices.some(asset => asset.asset.asset.id === to.asset.asset.id)
  )
  const balance = shieldSwapFormBalance(from, displayBalances)
  const currentBalance = shieldSwapFormBalance(from, currentBalances)
  const amountError = shieldSwapFormAmountError(amount, from, displayBalances)
  const validAmount = Boolean(amount && from && currentBalances && !amountError)
  const previewRequest = useMemo(() => {
    if (!account || !canManageNear || !from || !to || !currentBalances || !validAmount) return null
    return buildShieldSwapRequest({
      network,
      keyDomainId: account.walletId,
      accountId: account.accountId,
      from,
      to,
      amount,
      balances: currentBalances,
      slippageBps
    })
  }, [
    network,
    account?.walletId,
    account?.accountId,
    canManageNear,
    from,
    to,
    currentBalances,
    validAmount,
    amount,
    slippageBps
  ])
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview
  } = useConfidentialFundingPreview(active ? previewRequest : null, scopeKey)
  const previewOutput =
    preview && to
      ? formatBaseUnitDecimalAmount(preview.amountOutRaw, to.asset.metadata.decimals)
      : null
  const fromToken = tokens.find(token => token.assetId === from?.managed.protocolAssetId) ?? null
  const toToken = tokens.find(token => token.assetId === to?.managed.protocolAssetId) ?? null
  const { fromFiat, toFiat } = getSwapAmountValues({
    amountIn: amount,
    amountOut: previewOutput ?? '',
    tokenInPrice: fromToken?.price,
    tokenOutPrice: toToken?.price
  })
  const pickable = (picker === 'from' ? sourceChoices : options).filter(
    asset =>
      asset.managed.protocolAssetId !==
        (picker === 'from' ? to?.managed.protocolAssetId : from?.managed.protocolAssetId) &&
      `${asset.asset.metadata.symbol} ${asset.asset.metadata.name} ${asset.chain.chain.displayName} ${asset.asset.asset.reference}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  )
  const fromPickerItems = useMemo((): readonly ShieldSourceTokenPickerItem[] => {
    if (picker !== 'from') return []
    const needle = search.trim().toLowerCase()
    const matchesSearch = (parts: readonly string[]) =>
      !needle || parts.join(' ').toLowerCase().includes(needle)
    const zecRows = zecSourceOptions
      .filter(option =>
        matchesSearch([
          option.symbol,
          option.chainName,
          option.kind === 'intents' ? 'confidential' : ''
        ])
      )
      .map(option =>
        Object.freeze({
          key: option.selectionId,
          assetId: option.selectionId,
          symbol: option.symbol,
          iconUrl: option.iconUrl,
          chainName: option.chainName,
          chainId: option.badgeBlockchain,
          badgeBlockchain: option.badgeBlockchain,
          nativeIconChain: 'zcash',
          availableRaw: option.availableRaw,
          decimals: option.decimals,
          priceUsd:
            tokens.find(token => token.assetId === option.intentsWalletAssetId)?.price ??
            (option.kind === 'native-shielded'
              ? tokens.find(token => token.blockchain === 'zec' && token.symbol === 'ZEC')?.price
              : null),
          disabledReason: option.disabledReason
        })
      )
    const nonZecRows = pickable
      .filter(asset => asset.asset.metadata.symbol.toUpperCase() !== 'ZEC')
      .map(asset =>
        Object.freeze({
          key: asset.asset.asset.id,
          assetId: asset.asset.asset.id,
          symbol: asset.asset.metadata.symbol,
          iconUrl: asset.asset.metadata.iconUrl,
          chainName: asset.chain.chain.displayName,
          chainId: asset.chain.chain.id,
          badgeBlockchain: resolveChainIconAlias(
            asset.chain.chain.family,
            asset.chain.chain.displayName,
            asset.chain.chain.id
          ),
          availableRaw: shieldFundingAvailableRaw(asset, displayBalances),
          decimals: asset.asset.metadata.decimals,
          priceUsd:
            tokens.find(token => token.assetId === asset.managed.protocolAssetId)?.price ?? null
        })
      )
      .filter(row => matchesSearch([row.symbol, row.chainName ?? '']))
    return Object.freeze([...zecRows, ...nonZecRows])
  }, [picker, pickable, search, zecSourceOptions, displayBalances, tokens])
  const pickerNetworks = useMemo(() => {
    const choices = picker === 'from' ? sourceChoices : options
    const networks = new Map<string, { id: string; label: string; iconChain: string }>()
    for (const asset of choices) {
      if (picker === 'from' && asset.asset.metadata.symbol.toUpperCase() === 'ZEC') continue
      const id = asset.chain.chain.id
      if (!networks.has(id)) {
        networks.set(id, {
          id,
          label: asset.chain.chain.displayName,
          iconChain: resolveChainIconAlias(
            asset.chain.chain.family,
            asset.chain.chain.displayName,
            id
          )
        })
      }
    }
    if (picker === 'from') {
      for (const option of zecSourceOptions) {
        if (!networks.has(option.badgeBlockchain)) {
          networks.set(option.badgeBlockchain, {
            id: option.badgeBlockchain,
            label: option.chainName,
            iconChain: option.badgeBlockchain
          })
        }
      }
    }
    return [...networks.values()]
  }, [picker, sourceChoices, options, zecSourceOptions])
  const pickerItems =
    picker === 'from'
      ? fromPickerItems
          .filter(item => {
            if (pickerNetwork === 'all') return true
            const chainId =
              item.chainId ??
              item.badgeBlockchain ??
              sourceChoices.find(asset => asset.asset.asset.id === item.assetId)?.chain.chain.id
            return chainId === pickerNetwork
          })
          .map(item => shieldSourceSelectionItem(item, hidden))
      : pickable
          .filter(asset => pickerNetwork === 'all' || asset.chain.chain.id === pickerNetwork)
          .map(asset => ({
            key: asset.asset.asset.id,
            title: asset.managed.protocolAssetId,
            symbol: formatSymbol(asset.asset.metadata.symbol),
            icon: (
              <TokenIcon
                assetId={asset.asset.asset.id}
                symbol={formatSymbol(asset.asset.metadata.symbol)}
                icon={asset.asset.metadata.iconUrl}
                blockchain={resolveChainIconAlias(
                  asset.chain.chain.family,
                  asset.chain.chain.displayName,
                  asset.chain.chain.id
                )}
                size={32}
              />
            ),
            subtitle: `${asset.chain.chain.displayName}${originIdentifiers.get(asset.asset.asset.id) ? ` · ${originIdentifiers.get(asset.asset.asset.id)}` : ''}`,
            balance: (
              <TokenBalanceDisplay
                amount={shieldSwapFormBalance(asset, displayBalances) ?? '—'}
                symbol={formatSymbol(asset.asset.metadata.symbol)}
                priceUsd={
                  tokens.find(token => token.assetId === asset.managed.protocolAssetId)?.price
                }
                approximateFiat
                balancesHidden={hidden}
              />
            ),
            balanceTitle: hidden
              ? undefined
              : (shieldSwapFormBalance(asset, displayBalances) ?? undefined)
          }))
  const fromZecSource =
    from?.asset.metadata.symbol.toUpperCase() === 'ZEC'
      ? zecSourceOptions.find(option => option.intentsWalletAssetId === from?.asset.asset.id)
      : undefined
  const toZecSource =
    to?.asset.metadata.symbol.toUpperCase() === 'ZEC'
      ? zecSourceOptions.find(option => option.intentsWalletAssetId === to?.asset.asset.id)
      : undefined
  const scopeStillCurrent = () => {
    const state = useWalletStore.getState()
    return (
      mounted.current &&
      latestScope.current === scopeKey &&
      state.currentWalletId === walletId &&
      state.currentAccountId === accountId &&
      state.currentNetwork === network
    )
  }
  const openActivity = (transactionId: string) => {
    if (!scopeStillCurrent() || !account) return
    setPrepared(null)
    setAmount('')
    setUncertain(false)
    setError(null)
    void openConfidentialActivity(
      {
        network,
        keyDomainId: account.walletId,
        accountId: account.accountId,
        transactionId
      },
      () => navigate(`/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`),
      prepared
        ? {
            operation: 'swap',
            amount: prepared.amount,
            symbol: formatSymbol(prepared.from.asset.metadata.symbol),
            receiveAmount: formatBaseUnitDecimalAmount(
              prepared.review.expectedOutputRaw,
              prepared.to.asset.metadata.decimals
            ),
            receiveSymbol: formatSymbol(prepared.to.asset.metadata.symbol),
            network: 'NEAR Confidential'
          }
        : undefined
    )
  }
  const refreshBalances = async () => {
    if (!account || !canManageNear || connecting || !scopeStillCurrent()) return
    setError(null)
    if (await loadBalances()) {
      if (scopeStillCurrent() && previewError === CONFIDENTIAL_PREVIEW_CONNECTION_ERROR)
        retryPreview()
    }
  }
  const prepare = async () => {
    if (
      !account ||
      !canManageNear ||
      !from ||
      !to ||
      !currentBalances ||
      !validAmount ||
      !previewRequest ||
      !preview ||
      preview.expiresAt <= Date.now() + 5_000 ||
      busy ||
      !scopeStillCurrent()
    )
      return
    setBusy(true)
    setError(null)
    try {
      const request = previewRequest
      const review = await confidentialFundingClient.prepare(request)
      if (!scopeStillCurrent()) {
        if (review.phase === 'prepared')
          void confidentialFundingClient.cancel(review.planId).catch(() => {})
        return
      }
      if (review.phase !== 'prepared') {
        openActivity(review.transactionId)
        return
      }
      if (!matchesShieldSwapReview(review, request)) {
        void confidentialFundingClient.cancel(review.planId).catch(() => {})
        throw new Error('Swap review changed. Try again.')
      }
      confirmationAttempt.current = null
      setUncertain(false)
      setAcceptedPlanId(review.planId)
      setPreviousRate(null)
      cancelledPlanId.current = null
      setPrepared({ review, request, from, to, amount })
    } catch (cause) {
      if (scopeStillCurrent())
        setError(cause instanceof Error ? cause.message : 'Swap quote unavailable')
    } finally {
      if (scopeStillCurrent()) setBusy(false)
    }
  }
  const inspectPlan = async (planId: string) => {
    const plan = await confidentialFundingClient.get(planId)
    if (!scopeStillCurrent()) return 'changed'
    if (hasShieldTransferStarted(plan)) {
      openActivity(plan.transactionId)
      return 'started'
    }
    if (isUnsignedShieldTerminal(plan)) {
      setPrepared(null)
      setUncertain(false)
      setError('Swap was not started. Try again.')
      return 'failed'
    }
    return plan.phase === 'prepared' ? 'prepared' : 'pending'
  }
  const refreshReview = async () => {
    if (!prepared || busy || uncertain || !canManageNear || !scopeStillCurrent()) return
    if (!previewRequest || JSON.stringify(previewRequest) !== JSON.stringify(prepared.request)) {
      setAcceptedPlanId(null)
      setError('Swap details changed. Go back and review again.')
      return
    }
    setBusy(true)
    setRefreshingReview(true)
    setAcceptedPlanId(null)
    setError(null)
    const current = prepared
    try {
      if (cancelledPlanId.current !== current.review.planId) {
        await confidentialFundingClient.cancel(current.review.planId)
        cancelledPlanId.current = current.review.planId
      }
      if (!scopeStillCurrent()) return
      const review = await confidentialFundingClient.prepare(current.request)
      if (!scopeStillCurrent()) {
        if (review.phase === 'prepared')
          void confidentialFundingClient.cancel(review.planId).catch(() => {})
        return
      }
      if (review.phase !== 'prepared') {
        openActivity(review.transactionId)
        return
      }
      if (!matchesShieldSwapReview(review, current.request)) {
        void confidentialFundingClient.cancel(review.planId).catch(() => {})
        throw new Error('Swap review changed. Try again.')
      }
      const changed =
        current.review.expectedOutputRaw !== review.expectedOutputRaw ||
        current.review.minimumOutputRaw !== review.minimumOutputRaw ||
        current.review.quoteAppFeeBps !== review.quoteAppFeeBps ||
        current.review.quoteWithdrawFeeRaw !== review.quoteWithdrawFeeRaw
      setPreviousRate(
        changed
          ? formatShieldSwapPreviewRate(
              current.amount,
              current.review.expectedOutputRaw,
              current.to.asset.metadata.decimals
            )
          : null
      )
      cancelledPlanId.current = null
      setPrepared({ ...current, review })
      if (!changed) setAcceptedPlanId(review.planId)
    } catch (cause) {
      if (scopeStillCurrent())
        setError(cause instanceof Error ? cause.message : 'Swap quote unavailable')
    } finally {
      if (scopeStillCurrent()) {
        setBusy(false)
        setRefreshingReview(false)
      }
    }
  }

  useEffect(() => {
    if (
      !active ||
      !prepared ||
      busy ||
      uncertain ||
      error ||
      acceptedPlanId !== prepared.review.planId
    )
      return
    const wait = Math.max(0, Math.min(60_000, prepared.review.expiresAt - Date.now() - 5_000))
    const timer = window.setTimeout(() => void refreshReview(), wait)
    return () => window.clearTimeout(timer)
  }, [active, prepared, busy, uncertain, error, acceptedPlanId])
  const cancelReview = async () => {
    if (!prepared || busy || !scopeStillCurrent()) return
    setBusy(true)
    try {
      if (
        confirmationAttempt.current === prepared.review.planId &&
        (await inspectPlan(prepared.review.planId)) !== 'prepared'
      )
        return
      if (cancelledPlanId.current !== prepared.review.planId)
        await confidentialFundingClient.cancel(prepared.review.planId)
      if (!scopeStillCurrent()) return
      setPrepared(null)
      setAcceptedPlanId(null)
      setUncertain(false)
    } catch (cause) {
      if (scopeStillCurrent())
        setError(cause instanceof Error ? cause.message : 'Unable to cancel review')
    } finally {
      if (scopeStillCurrent()) setBusy(false)
    }
  }
  const confirm = async () => {
    if (!prepared || busy || !canManageNear || !scopeStillCurrent()) return
    if (
      !uncertain &&
      (acceptedPlanId !== prepared.review.planId ||
        !previewRequest ||
        JSON.stringify(previewRequest) !== JSON.stringify(prepared.request) ||
        Boolean(error))
    )
      return
    setBusy(true)
    setError(null)
    try {
      if (uncertain) {
        const state = await inspectPlan(prepared.review.planId)
        if (!scopeStillCurrent()) return
        if (state === 'prepared') {
          setUncertain(false)
          setError('Swap was not started. Review and try again.')
        }
        return
      }
      if (prepared.review.expiresAt <= Date.now()) {
        setBusy(false)
        void refreshReview()
        return
      }
      confirmationAttempt.current = prepared.review.planId
      const plan = await confidentialFundingClient.confirm(
        prepared.review.planId,
        prepared.review.payloadFingerprint
      )
      if (hasShieldTransferStarted(plan)) openActivity(plan.transactionId)
      else await inspectPlan(plan.planId)
    } catch (cause) {
      try {
        const state = await inspectPlan(prepared.review.planId)
        if (!scopeStillCurrent()) return
        if (state === 'prepared') {
          setUncertain(false)
          setError(cause instanceof Error ? cause.message : 'Swap could not start')
        } else if (state === 'pending') {
          setUncertain(true)
          setError('Swap status is pending. Check status before trying again.')
        }
      } catch {
        if (scopeStillCurrent()) {
          setUncertain(true)
          setError('Swap status unavailable. Check status before trying again.')
        }
      }
    } finally {
      if (scopeStillCurrent()) setBusy(false)
    }
  }

  if (activeAccount && !canManageNear) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p role="alert" className="px-4 py-6 text-center text-sm text-muted">
          Shield unavailable for this account
        </p>
      </div>
    )
  }

  if (prepared) {
    const priceAcceptanceRequired = acceptedPlanId !== prepared.review.planId
    const output = formatBaseUnitDecimalAmount(
      prepared.review.expectedOutputRaw,
      prepared.to.asset.metadata.decimals
    )
    const minimum = formatBaseUnitAmount(
      prepared.review.minimumOutputRaw,
      prepared.to.asset.metadata.decimals
    )
    const fee = prepared.review.quoteWithdrawFeeRaw ?? '0'
    const feeAmount = formatBaseUnitAmount(fee, prepared.to.asset.metadata.decimals)
    const currentRate = formatShieldSwapPreviewRate(
      prepared.amount,
      prepared.review.expectedOutputRaw,
      prepared.to.asset.metadata.decimals
    )
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <TransactionReviewView
          variant="figma"
          title="Confirm Swap"
          asset={{
            assetId: prepared.from.asset.asset.id,
            symbol: formatSymbol(prepared.from.asset.metadata.symbol),
            icon: prepared.from.asset.metadata.iconUrl
          }}
          amount={prepared.amount}
          network=""
          exchange
          summary={
            <TransactionReviewExchangeSummary
              presentation="exchange"
              source={{
                asset: {
                  assetId: prepared.from.asset.asset.id,
                  symbol: formatSymbol(prepared.from.asset.metadata.symbol),
                  icon: prepared.from.asset.metadata.iconUrl
                },
                amount: prepared.amount
              }}
              destination={{
                asset: {
                  assetId: prepared.to.asset.asset.id,
                  symbol: formatSymbol(prepared.to.asset.metadata.symbol),
                  icon: prepared.to.asset.metadata.iconUrl
                },
                amount: output
              }}
              destinationLoading={refreshingReview}
            />
          }
          rows={[
            { label: 'Network', content: 'NEAR Confidential' },
            {
              label: 'Rate',
              content: (
                <span className="inline-flex max-w-full flex-col items-end gap-0.5 tabular-nums">
                  {priceAcceptanceRequired && previousRate && !refreshingReview && (
                    <span className="text-xs text-muted line-through">
                      1 {formatSymbol(prepared.from.asset.metadata.symbol)} = {previousRate}{' '}
                      {formatSymbol(prepared.to.asset.metadata.symbol)}
                    </span>
                  )}
                  <span>
                    1 {formatSymbol(prepared.from.asset.metadata.symbol)} = {currentRate}{' '}
                    {formatSymbol(prepared.to.asset.metadata.symbol)}
                  </span>
                </span>
              )
            },
            {
              label: 'Minimum receive',
              content: refreshingReview ? (
                <span className="inline-block h-4 w-24 animate-pulse rounded bg-card" />
              ) : (
                <AmountDisplay
                  value={minimum}
                  symbol={formatSymbol(prepared.to.asset.metadata.symbol)}
                />
              )
            },
            ...(showReviewMore
              ? [
                  {
                    label: 'Service fee',
                    content: `${((prepared.review.quoteAppFeeBps ?? 0) / 100).toString()}%`
                  },
                  {
                    label: 'Fees',
                    content: (
                      <AmountDisplay
                        value={feeAmount}
                        symbol={formatSymbol(prepared.to.asset.metadata.symbol)}
                        profile="fee"
                      />
                    )
                  },
                  {
                    label: 'Slippage',
                    content: `${((prepared.review.slippageBps ?? 0) / 100).toString()}%`
                  },
                  {
                    label: 'Used account',
                    content: activeAccount?.accountDisplayName ?? '—'
                  },
                  ...(prepared.review.quoteTimeEstimateSeconds === undefined
                    ? []
                    : [
                        {
                          label: 'Estimated time',
                          content: formatShieldQuoteTime(prepared.review.quoteTimeEstimateSeconds)
                        }
                      ])
                ]
              : [])
          ]}
          afterRows={
            <div className="space-y-3 pt-3">
              <button
                type="button"
                onClick={() => setShowReviewMore(value => !value)}
                aria-expanded={showReviewMore}
                className="flex w-full items-center justify-center gap-1 text-sm text-muted hover:text-foreground"
              >
                {showReviewMore ? 'Show less' : 'Show more'}
                <Icon
                  icon={showReviewMore ? 'lucide:chevron-up' : 'lucide:chevron-down'}
                  width={14}
                />
              </button>
              {!refreshingReview && (
                <button
                  type="button"
                  onClick={() => void refreshReview()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground disabled:opacity-50"
                  aria-label="Refresh quote"
                >
                  <Icon icon="lucide:refresh-cw" width={14} /> Refresh quote
                </button>
              )}
            </div>
          }
          error={
            error ? (
              <p role="alert" className="mt-3 text-sm text-warning">
                {error}
              </p>
            ) : undefined
          }
          confirmLabel={
            uncertain
              ? 'Check status'
              : priceAcceptanceRequired && !error
                ? 'Accept new price'
                : 'Confirm'
          }
          confirmTone={priceAcceptanceRequired && !error && !uncertain ? 'warning' : 'default'}
          confirming={busy}
          submitting={
            busy && !refreshingReview && confirmationAttempt.current === prepared.review.planId
          }
          preparing={refreshingReview}
          confirmDisabled={
            Boolean(error) ||
            (priceAcceptanceRequired && !previousRate) ||
            (!uncertain && prepared.review.expiresAt <= Date.now())
          }
          onCancel={() => void cancelReview()}
          onConfirm={() => {
            if (priceAcceptanceRequired && !uncertain) {
              if (
                !busy &&
                !error &&
                previousRate &&
                prepared.review.expiresAt > Date.now() &&
                previewRequest &&
                JSON.stringify(previewRequest) === JSON.stringify(prepared.request)
              ) {
                setAcceptedPlanId(prepared.review.planId)
                setPreviousRate(null)
              }
              return
            }
            void confirm()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
        <SwapAssetCard
          direction="From"
          token={fromToken}
          tokenBadgeBlockchain={fromZecSource?.badgeBlockchain}
          tokenNetworkLabel={fromZecSource?.chainName}
          amount={amount}
          fiatValue={fromToken?.price ? fromFiat : ''}
          balance={hidden ? '••••' : (balance ?? '—')}
          tokenSelectDisabled={tokens.length === 0}
          onTokenSelect={() => {
            setSearch('')
            setPickerNetwork('all')
            setPicker('from')
          }}
          tokenSelectLocked={busy}
          amountFocusToken={
            active && amountFocusToken && amountFocusToken > 0 ? amountFocusToken : undefined
          }
          autoFocusAmount={active}
          onAmountChange={value => {
            if (!fromId && from) setFromId(from.asset.asset.id)
            setAmount(value)
          }}
          validationMessage={amountError ?? undefined}
          onMaxClick={() => {
            if (!from || currentBalance === null) return
            if (!fromId) setFromId(from.asset.asset.id)
            setAmount(currentBalance)
          }}
          maxDisabled={busy || connecting || currentBalance === null || currentBalance === '0'}
          maxDisabledReason={
            !currentBalances ? 'Shield balance unavailable' : 'No available balance'
          }
        />
        <div className="relative border-t border-white/10 pt-2">
          <Button
            type="button"
            aria-label="Switch assets"
            disabled={busy || !from || !to || !canReverse}
            title={!canReverse ? 'Destination has no available Shield balance' : 'Switch assets'}
            onClick={() => {
              if (!from || !to || !canReverse) return
              setFromId(to.asset.asset.id)
              setToId(from.asset.asset.id)
              setAmount('')
            }}
            className="absolute -top-3.5 left-1/2 z-10 size-7 -translate-x-1/2 rounded-md bg-[#373741] p-0 text-foreground hover:bg-popover disabled:opacity-40"
            variant="secondary"
          >
            <Icon icon="lucide:arrow-down-up" width={16} height={16} />
          </Button>
          <SwapAssetCard
            direction="To"
            token={toToken}
            tokenBadgeBlockchain={toZecSource?.badgeBlockchain}
            tokenNetworkLabel={toZecSource?.chainName}
            amount={previewOutput ?? ''}
            fiatValue={toToken?.price ? toFiat : ''}
            onTokenSelect={() => {
              setSearch('')
              setPickerNetwork('all')
              setPicker('to')
            }}
            tokenSelectDisabled={tokens.length === 0}
            tokenSelectLocked={busy}
            isReadOnly
            isAmountLoading={previewLoading}
            isEstimatedAmount={Boolean(previewOutput)}
          />
        </div>
        {preview && from && to && previewOutput && (
          <SwapProviderCard
            slippage={slippage}
            providerName="near-confidential"
            outputAmount={previewOutput}
            outputSymbol={to.asset.metadata.symbol}
            details={
              preview.appFeeBps !== undefined || preview.timeEstimateSeconds !== undefined ? (
                <div className="mt-1.5 space-y-1.5 text-muted">
                  {preview.appFeeBps !== undefined && (
                    <div className="flex items-center justify-between gap-2">
                      <span>Service fee</span>
                      <span className="text-foreground">{preview.appFeeBps / 100}%</span>
                    </div>
                  )}
                  {preview.timeEstimateSeconds !== undefined && (
                    <div className="flex items-center justify-between gap-2">
                      <span>Est. time</span>
                      <span className="text-foreground">
                        {formatShieldQuoteTime(preview.timeEstimateSeconds)}
                      </span>
                    </div>
                  )}
                </div>
              ) : undefined
            }
          />
        )}
        {previewError && (
          <div
            role="alert"
            className="mt-3 flex items-center justify-between gap-2 text-xs text-warning"
          >
            <span>
              {previewError === CONFIDENTIAL_PREVIEW_CONNECTION_ERROR
                ? 'Refresh Shield balances to get a quote.'
                : previewError}
            </span>
            <button
              type="button"
              disabled={connecting}
              onClick={
                previewError === CONFIDENTIAL_PREVIEW_CONNECTION_ERROR
                  ? () => void refreshBalances()
                  : retryPreview
              }
              className="shrink-0 text-primary disabled:opacity-45"
            >
              {previewError === CONFIDENTIAL_PREVIEW_CONNECTION_ERROR
                ? 'Refresh balances'
                : 'Retry'}
            </button>
          </div>
        )}
        {(error || balanceError) && (
          <p role="alert" className="mt-3 text-xs text-warning">
            {error || balanceError}
          </p>
        )}
        {status === 'error' && currentBalances && (
          <Button variant="ghost" onClick={() => void refresh(true)} className="w-full">
            Refresh Shield balances
          </Button>
        )}
        {!currentBalances && canManageNear && connecting && (
          <p role="status" className="mt-4 text-center text-sm text-muted">
            Loading Shield balances…
          </p>
        )}
        {!currentBalances && canManageNear && !connecting && balanceError && (
          <Button
            variant="outline"
            size="wallet"
            onClick={() => void refreshBalances()}
            className="mt-4 w-full"
          >
            Retry
          </Button>
        )}
      </div>
      <div className="page-footer">
        <Button
          size="wallet"
          className="w-full disabled:bg-card disabled:text-muted disabled:opacity-100"
          isLoading={busy}
          disabled={
            !canManageNear ||
            !currentBalances ||
            !from ||
            !to ||
            !validAmount ||
            !preview ||
            previewLoading ||
            busy
          }
          onClick={() => void prepare()}
        >
          Swap
        </Button>
      </div>
      <Dialog open={active && picker !== null} onOpenChange={open => !open && setPicker(null)}>
        <DialogContent
          showCloseButton={false}
          className="!inset-0 !h-dvh !max-h-dvh !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-none !border-0 !p-0 !gap-0 flex flex-col bg-background shadow-none"
        >
          <div className="relative flex h-14 shrink-0 items-center justify-center px-4">
            <button
              type="button"
              aria-label="Back"
              onClick={() => setPicker(null)}
              className="wallet-interactive absolute left-4 flex size-8 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Icon icon="lucide:chevron-left" width={22} height={22} />
            </button>
            <DialogTitle className="text-lg font-medium">Select Token</DialogTitle>
          </div>
          <DialogDescription className="sr-only">Choose a token for this swap</DialogDescription>
          <div className="min-h-0 flex-1 px-4 pb-2">
            <TokenSelectorView
              search={search}
              onSearchChange={setSearch}
              networks={pickerNetworks}
              selectedNetwork={pickerNetwork}
              onNetworkChange={setPickerNetwork}
              items={pickerItems}
              selectedKey={
                picker === 'from'
                  ? (zecSourceOptions.find(
                      option => option.intentsWalletAssetId === confidentialFromAssetId
                    )?.selectionId ??
                    fromId ??
                    undefined)
                  : to?.asset.asset.id
              }
              lowBalanceKeys={
                new Set(
                  picker === 'from'
                    ? fromPickerItems
                        .filter(item => {
                          try {
                            return BigInt(item.availableRaw) <= 0n
                          } catch {
                            return true
                          }
                        })
                        .map(item => item.key)
                    : pickable
                        .filter(asset => shieldSwapFormBalance(asset, displayBalances) === '0')
                        .map(asset => asset.asset.asset.id)
                )
              }
              onSelect={key => {
                if (picker === 'to') {
                  setToId(key)
                } else if (key === SHIELD_SWAP_ZEC_NATIVE_SELECTION_ID) {
                  onSelectNativeZecSwap?.()
                } else {
                  const intents = zecSourceOptions.find(option => option.kind === 'intents')
                  setFromId(
                    key === SHIELD_SWAP_ZEC_INTENTS_SELECTION_ID
                      ? (intents?.intentsWalletAssetId ?? key)
                      : key
                  )
                  setAmount('')
                }
                setPicker(null)
              }}
              emptyMessage={
                status === 'loading' ? 'Loading Shield tokens…' : 'No Shield tokens found'
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
