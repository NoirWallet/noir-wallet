import { isZcashHardwareKeySource } from '@/core/wallet/hardware-wallet-data'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useNavigate } from '../../provider/Router'
import { openModal } from '../../provider/ModalManager'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { useTransactionResultStore } from '@/store/transaction-result-store'
import { useSettingsStore } from '@/store/settings-store'
import { getChainEndpointRuntimeKey } from '@/core/chains/chain-endpoint-settings'
import {
  resolveEvmFeatureRuntimePolicy,
  resolveSolanaFeatureRuntimePolicy
} from '@/core/chains/feature-runtime-policy'
import { getConfidentialTransferEstimate } from '@/config/intents'
import {
  deriveFeeByTier,
  deriveFeeByTierFromEstimate,
  marginalFeeForTier,
  staticFeeFallbackZats
} from '@/core/zcash/fee-policy'
import { isZecToken } from '@/core/services/intents-api'
import type {
  RheaSwapEvmSignatureReview,
  RheaSwapNearTransactionBatchReview,
  RheaSwapQuoteView,
  RheaSwapReviewView,
  RheaSwapSolanaTransactionReview
} from '@/core/services/rhea-swap'
import {
  formatChainName,
  formatNumber,
  formatSortAddress,
  formatSymbol,
  getChainFromAssetId
} from '@/lib/format'
import { useSwapPreferences } from '@/store/swap-store'
import { toast } from '@/store/toast-store'
import { useTransaction } from '../../hooks/useTransaction'
import { useFeeEstimate } from '../../hooks/useFeeEstimate'
import { useMaxTransferEstimate } from '../../hooks/useMaxTransferEstimate'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import {
  openHardwareSignAndWait,
  openHardwareSignTab,
  openHardwareBitcoinSignTab,
  openHardwareEvmSignTab
} from '@/lib/hardware-tab'
import { isSidePanelSurface } from '@/lib/extension-display-mode'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent } from '@/lib/analytics'
import type { TrackOptions } from '@/lib/analytics'
import { calculateSwapUsdAmount } from '@/lib/analytics/swap'
import { SwapTokenSelector } from '../../components/swap/SwapTokenSelector'
import { SlippageSettingContent } from '../../components/swap/SlippageSetting'
import { SwapReviewView } from '../../components/swap/SwapReviewView'
import { SwapInputView } from '../../components/swap/SwapInputView'
import { useSwapState } from '../../hooks/useSwapState'
import {
  filterCrossChainSendDestinations,
  getCrossChainSendTokenGroup,
  isCrossChainSendChainEnabled,
  isCrossChainSendDestination,
  isCrossChainSendRecipientValid
} from '@/popup/services/cross-chain-send-assets'
import { AddressSelectorModal } from '../../components/account/AddressSelector'
import { PageHeader } from '../../components/common/PageHeader'
import { SendRouteMenu } from '../../components/transaction/SendRouteMenu'
import { Button } from '../../components/ui/button'
import {
  ExecutionAccountBadge,
  ExecutionAccountSelectorDialog,
  AccountAddressSelectorButton
} from '../../components/account/ExecutionAccountSelector'
import { useWalletActionExecutionMode } from '../../hooks/useWalletActionExecutionMode'
import Big, { safeBig } from '@/lib/big'
import { calculatePrivateFundingSourceAmount } from '@/core/transactions/private-funding'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { classifyError } from '@/lib/errors'
import { createDebugRequestId, logDebugTiming, traceDebugStage } from '@/lib/debug-performance'
import { logger } from '@/lib/logger'
import { EvmWalletClientError, evmWalletClient } from '@/popup/services/evm-wallet-client'
import {
  resolveSwapMaximumAdjustment,
  resolveZcashSwapMaximumAdjustment
} from '@/popup/services/swap-maximum'
import { useTransferMaximum } from '@/popup/hooks/useTransferMaximum'
import {
  estimateRheaRouteMaximum,
  fallbackTransferMaximum
} from '@/popup/services/transfer-maximum'
import {
  createRheaSwapBinding,
  listWalletSwapSourceTokens,
  quoteDepositTransferClient,
  resolveRheaSwapDestinationIdentity,
  resolveWalletOwnedQuoteAsset,
  resolveWalletQuoteReceiveTarget,
  resolveWalletSwapSourceToken,
  selectWalletOwnedQuoteAssetExecution,
  type QuoteDepositExecutionMode,
  type PreparedQuoteDepositTransfer
} from '@/popup/services/quote-deposit-transfer-client'
import {
  receiveTargetsClient,
  type AdditionalReceiveTargetsView
} from '@/popup/services/receive-targets-client'
import type { PortfolioReadModel } from '@/core/portfolio'
import {
  formatBaseUnitAmount,
  formatBaseUnitDecimalAmount,
  parseDisplayUnitAmount
} from '@/popup/components/portfolio/portfolio-format'
import { usePortfolioUpdates } from '@/popup/hooks/usePortfolioUpdates'
import {
  createSwapTokenPreferenceScope,
  resolveSwapTokenSelection
} from '@/popup/services/swap-token-selection'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import {
  isPortfolioModelForScope,
  readCachedPortfolio,
  refreshPortfolioFromCache
} from '@/popup/services/portfolio-cache'
import { DEFAULT_NETWORK_FEE_TIER, type NetworkFeeTier } from '@/core/transactions/domain'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { getRheaSwapErrorMessage, rheaSwapClient } from '@/popup/services/rhea-swap-client'
import { requiredRheaEvmApproval } from '@/popup/services/rhea-evm-approval'
import { TransactionReviewView } from '@/popup/components/transaction/TransactionReviewView'
import { NetworkFeeTierPicker } from '@/popup/components/transaction/NetworkFeeTierPicker'
import {
  buildLiveSwapQuoteRequest,
  createSwapQuoteRefreshTarget,
  isSwapQuoteRefreshReady,
  type SwapQuoteRefreshTarget,
  buildWalletSwapSourceBalances,
  filterConfidentialFundingSourceTokens,
  getPreparedSwapNetworkFee,
  isPreparedSwapFeeUnaffordable,
  isRheaSwapQuoteFresh,
  isSwapSourceAmountInsufficient,
  resolveConfidentialFundingDestinationToken,
  resolveLockedWalletSwapSourceToken,
  resolvePreferredSwapSourceAssetId,
  resolveSwapRefreshChainId,
  resolveSwapExecutionSourceMode,
  resolveSwapReviewAction
} from '@/popup/services/swap-page-model'
import {
  resolvePortfolioTransferAvailability,
  resolveZcashTransferAvailability
} from '@/popup/services/transfer-availability'

type SwapViewStep = 'input' | 'review' | 'approval-pending'
const LIVE_QUOTE_DEBOUNCE_MS = 800
const CROSS_CHAIN_SEND_CAPABILITIES = Object.freeze({
  evm: resolveEvmFeatureRuntimePolicy(__ENABLED_CHAIN_FEATURE_FLAGS__).newOperationsEnabled,
  solana: resolveSolanaFeatureRuntimePolicy(__ENABLED_CHAIN_FEATURE_FLAGS__).newOperationsEnabled
})

interface SwapWalletSourcesSnapshot {
  readonly portfolio: PortfolioReadModel | null
  readonly receiveTargets: AdditionalReceiveTargetsView | null
}

type PendingRheaEvmAfterApproval = Readonly<{
  readonly approval: Readonly<{ readonly spender: string; readonly amountRaw: string }>
}>

type PendingRheaSigningReview =
  | Readonly<{ kind: 'evm-signature'; review: RheaSwapEvmSignatureReview }>
  | Readonly<{ kind: 'solana-transaction'; review: RheaSwapSolanaTransactionReview }>
  | Readonly<{ kind: 'near-transaction-batch'; review: RheaSwapNearTransactionBatchReview }>

const swapWalletSourcesCache = new Map<string, SwapWalletSourcesSnapshot>()
const MAX_SWAP_WALLET_SOURCE_SCOPES = 8

function cacheSwapWalletSources(scope: string, snapshot: SwapWalletSourcesSnapshot): void {
  swapWalletSourcesCache.delete(scope)
  swapWalletSourcesCache.set(scope, snapshot)
  while (swapWalletSourcesCache.size > MAX_SWAP_WALLET_SOURCE_SCOPES) {
    const oldest = swapWalletSourcesCache.keys().next().value
    if (oldest === undefined) break
    swapWalletSourcesCache.delete(oldest)
  }
}

export function Swap({ purpose = 'swap' }: { purpose?: 'swap' | 'cross-chain-send' }) {
  const { goBack, navigate, replace } = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const crossChainSendRequested = purpose === 'cross-chain-send'
  const requestedSourceAssetId = searchParams.get('source')
  const returnToSendAssetId =
    location.state &&
    typeof location.state === 'object' &&
    'returnToSendAssetId' in location.state &&
    location.state.returnToSendAssetId === requestedSourceAssetId
      ? requestedSourceAssetId
      : null
  const returnFromCrossChainSend = () => {
    if (returnToSendAssetId) {
      replace(`/send?assetId=${encodeURIComponent(returnToSendAssetId)}`)
    } else {
      goBack()
    }
  }
  const privateTransferRequested = searchParams.get('privateTransfer') === '1'
  const autoReviewRequested = searchParams.get('review') === '1'
  const privateTransferRecipient = searchParams.get('recipient') ?? ''
  const privateTransferAmount = searchParams.get('amount') ?? ''
  const privateDestinationRequested = searchParams.get('privateDestination') === '1'
  const privateFundingRequestId = searchParams.get('privateFundingRequestId')
  const privateFundingDestinationChain = searchParams.get('destinationChain')
  const privateFundingDestinationAsset = searchParams.get('destinationAsset')
  const privateFundingMinimumRaw = searchParams.get('minimumOutputRaw')
  const privateFundingSuggestedOutputRaw = searchParams.get('suggestedOutputRaw')
  const privateFundingAmount = searchParams.get('amount') ?? ''
  const isPrivateFunding = Boolean(
    privateDestinationRequested && /^\d+$/.test(privateFundingDestinationChain ?? '')
  )
  const lockedAssetFlowRequested = isPrivateFunding || privateTransferRequested
  const privateBalanceTransferRequested = Boolean(
    searchParams.get('balanceTransfer') === '1' && lockedAssetFlowRequested
  )
  const directSubmitRequested = Boolean(
    searchParams.get('submit') === '1' &&
    autoReviewRequested &&
    lockedAssetFlowRequested &&
    !privateBalanceTransferRequested
  )
  const currentAccount = useWalletStore(state => state.getCurrentAccount())
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const legacyHardwareWallet = useWalletStore(state =>
    isZcashHardwareKeySource(state.getCurrentWallet()?.keySource)
  )
  const { activeAccount: storageV2Account } = useActiveAccountNetworks()
  const effectiveAccount = resolveEffectiveActiveAccountIdentity({
    currentWalletId,
    currentAccountId,
    nativeAccount: storageV2Account
  })
  const effectiveWalletId = effectiveAccount?.walletId ?? null
  const effectiveAccountId = effectiveAccount?.accountId ?? null
  const isHardwareWallet =
    storageV2Account?.walletSource.kind === 'hardware' || legacyHardwareWallet
  const isLedgerWallet =
    storageV2Account?.walletSource.kind === 'hardware' &&
    storageV2Account.walletSource.hardware.vendor === 'ledger'
  const feeTier = useSettingsStore(state => state.feeTier)
  const setFeeTier = useSettingsStore(state => state.setFeeTier)
  const chainEndpointRuntimeKey = useSettingsStore(state =>
    getChainEndpointRuntimeKey(state.chainEndpointSettings)
  )
  const walletSourcesScope =
    effectiveWalletId && effectiveAccountId
      ? `${effectiveWalletId}:${effectiveAccountId}:${chainEndpointRuntimeKey}`
      : null
  const retainedWalletSources = walletSourcesScope
    ? swapWalletSourcesCache.get(walletSourcesScope)
    : undefined
  const getCurrentBalance = useAccountDataStore(state => state.getCurrentBalance)
  const storeBalance = getCurrentBalance()

  const zecPrice = useWalletStore(state => state.zecPrice)
  const swapPreferenceScope = createSwapTokenPreferenceScope(effectiveWalletId, effectiveAccountId)
  const savedTokenSelection = useSwapPreferences(state =>
    swapPreferenceScope ? state.tokenSelections[swapPreferenceScope] : undefined
  )
  const [swapPreferencesHydrated, setSwapPreferencesHydrated] = useState(
    useSwapPreferences.persist.hasHydrated()
  )
  const defaultSwapChainId =
    storageV2Account?.walletSource.kind === 'private-key'
      ? (storageV2Account.networks.find(
          network =>
            network.chain.id === useSettingsStore.getState().chainEndpointSettings.activeEvmChainId
        )?.chain.id ?? storageV2Account.networks[0]?.chain.id)
      : undefined
  const swap = useSwapState(
    lockedAssetFlowRequested || crossChainSendRequested ? null : swapPreferenceScope,
    {
      sourceAssetId: requestedSourceAssetId,
      destinationAssetId: privateFundingDestinationAsset,
      destinationApiChainId: privateFundingDestinationChain,
      defaultSourceChainId:
        isPrivateFunding && privateFundingDestinationChain
          ? `eip155:${privateFundingDestinationChain}`
          : defaultSwapChainId
    }
  )
  const { addRecentRecipientAddress, getRecentRecipientAddresses } = useSwapPreferences()
  const { setResult, updateSwapOriginTransaction } = useTransactionResultStore()
  const { sendTransaction } = useTransaction()

  const [viewStep, setViewStep] = useState<SwapViewStep>('input')
  const [quoteResult, setQuoteResult] = useState<RheaSwapQuoteView | null>(null)
  const [rheaReview, setRheaReview] = useState<RheaSwapReviewView | null>(null)
  const [liveQuoteKey, setLiveQuoteKey] = useState<string | null>(null)
  const [quoteReceivedAt, setQuoteReceivedAt] = useState<number | null>(null)
  const [quoteRefreshTick, setQuoteRefreshTick] = useState(0)
  const [quoteRetryable, setQuoteRetryable] = useState(false)
  const [isPreparingReview, setIsPreparingReview] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [isPrivateFundingSubmitting, setIsPrivateFundingSubmitting] = useState(false)
  const [directTransferError, setDirectTransferError] = useState<string | null>(null)
  const [networkFeeTier, setNetworkFeeTier] = useState<NetworkFeeTier>(DEFAULT_NETWORK_FEE_TIER)
  const [maxSelected, setMaxSelected] = useState(searchParams.get('maximum') === '1')
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false)
  const [destinationSelectorOpen, setDestinationSelectorOpen] = useState(false)
  const [useCustomRecipient, setUseCustomRecipient] = useState(false)
  const [portfolio, setPortfolio] = useState<PortfolioReadModel | null>(
    retainedWalletSources?.portfolio ?? null
  )
  const [receiveTargets, setReceiveTargets] = useState<AdditionalReceiveTargetsView | null>(
    retainedWalletSources?.receiveTargets ?? null
  )
  const [walletSourcesTraceId] = useState(() => createDebugRequestId('swap-wallet-sources'))
  const [walletSourcesLoading, setWalletSourcesLoading] = useState(true)
  const [preparedQuoteTransfer, setPreparedQuoteTransfer] =
    useState<PreparedQuoteDepositTransfer | null>(null)
  const [rheaSigningReview, setRheaSigningReview] = useState<PendingRheaSigningReview | null>(null)
  const [pendingRheaEvmAfterApproval, setPendingRheaEvmAfterApproval] =
    useState<PendingRheaEvmAfterApproval | null>(null)
  const pendingQuoteTransfer = useRef<PreparedQuoteDepositTransfer | null>(null)
  const pendingRheaSigningQuote = useRef<Readonly<{
    kind: PendingRheaSigningReview['kind']
    quoteHandle: string
  }> | null>(null)
  const activeScopeRef = useRef<string | null | undefined>(undefined)
  const quoteRequestSequence = useRef(0)
  const preparingReview = useRef(false)
  const lastRequestedQuoteKey = useRef<string | null>(null)
  const maxQuoteAdjustmentCount = useRef(0)
  const maxSourceBalanceRaw = useRef<string | null>(null)
  const reviewAfterQuoteRefresh = useRef<SwapQuoteRefreshTarget | null>(null)
  const initializedPrivateFundingScope = useRef<string | null>(null)
  const initializedPrivateFundingAmountScope = useRef<string | null>(null)
  const initializedPrivateTransferScope = useRef<string | null>(null)
  const autoReviewStartedScope = useRef<string | null>(null)
  const directSubmitStartedScope = useRef<string | null>(null)
  const privateExecutionSupported = Boolean(
    storageV2Account?.networks.some(
      network => network.chain.family === 'evm' && network.privateExecutionAddress
    )
  )
  const walletActionMode = useWalletActionExecutionMode(
    privateExecutionSupported,
    effectiveWalletId,
    effectiveAccountId
  )
  const sourceMode: QuoteDepositExecutionMode = walletActionMode.mode
  const setSourceMode = walletActionMode.setMode
  const destinationWalletActionMode = useWalletActionExecutionMode(
    privateExecutionSupported,
    effectiveWalletId,
    effectiveAccountId
  )
  const setDestinationMode = destinationWalletActionMode.setMode

  useEffect(() => {
    if (useSwapPreferences.persist.hasHydrated()) {
      setSwapPreferencesHydrated(true)
      return
    }
    return useSwapPreferences.persist.onFinishHydration(() => {
      setSwapPreferencesHydrated(true)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const retained = walletSourcesScope ? swapWalletSourcesCache.get(walletSourcesScope) : undefined
    setPortfolio(retained?.portfolio ?? null)
    setReceiveTargets(retained?.receiveTargets ?? null)
    if (!effectiveWalletId || !effectiveAccountId) {
      setWalletSourcesLoading(false)
      return () => {
        cancelled = true
      }
    }
    // Retained data keeps the screen responsive, but actions wait for the current
    // Bitcoin account-type selection to be read from the Background.
    setWalletSourcesLoading(true)
    void (async () => {
      const startedAt = performance.now()
      try {
        const scope = {
          walletId: effectiveWalletId,
          accountId: effectiveAccountId,
          endpointRuntimeKey: chainEndpointRuntimeKey
        }
        const [cached, targets] = await Promise.all([
          traceDebugStage(walletSourcesTraceId, 'read-cached-portfolio', () =>
            readCachedPortfolio(scope)
          ),
          traceDebugStage(walletSourcesTraceId, 'load-receive-targets', () =>
            receiveTargetsClient.getAdditionalTargets({
              keyDomainId: effectiveWalletId,
              accountId: effectiveAccountId
            })
          )
        ])
        if (cancelled) return
        logDebugTiming(
          walletSourcesTraceId,
          `sources-ready assets=${cached?.assets.length ?? 0} targets=${targets?.targets.length ?? 0}`,
          startedAt
        )
        setPortfolio(cached)
        setReceiveTargets(targets)
        setWalletSourcesLoading(false)
        if (walletSourcesScope) {
          cacheSwapWalletSources(walletSourcesScope, {
            portfolio: cached,
            receiveTargets: targets
          })
        }
      } catch {
        // Keep the last verified cached portfolio when a refresh is unavailable.
      } finally {
        if (!cancelled) setWalletSourcesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    effectiveWalletId,
    effectiveAccountId,
    chainEndpointRuntimeKey,
    walletSourcesScope,
    walletSourcesTraceId
  ])

  const readLatestPortfolio = useCallback(async () => {
    if (!effectiveWalletId || !effectiveAccountId) return
    const startedAt = performance.now()
    const latest = await traceDebugStage(walletSourcesTraceId, 'read-portfolio-update', () =>
      readCachedPortfolio({
        walletId: effectiveWalletId,
        accountId: effectiveAccountId
      })
    )
    logDebugTiming(
      walletSourcesTraceId,
      `portfolio-update assets=${latest?.assets.length ?? 0}`,
      startedAt
    )
    if (
      activeScopeRef.current?.startsWith(`${effectiveWalletId}:${effectiveAccountId}:`) &&
      isPortfolioModelForScope(latest, effectiveWalletId, effectiveAccountId)
    ) {
      setPortfolio(latest)
      setWalletSourcesLoading(false)
    }
  }, [effectiveWalletId, effectiveAccountId, walletSourcesTraceId])

  usePortfolioUpdates(effectiveWalletId, effectiveAccountId, readLatestPortfolio)

  const walletOwnedSourceBase = useMemo(
    () =>
      !swap.isZecSource && swap.tokenIn && portfolio
        ? resolveWalletOwnedQuoteAsset(swap.tokenIn, portfolio, receiveTargets)
        : null,
    [swap.isZecSource, swap.tokenIn, portfolio, receiveTargets]
  )
  const sourcePrivateExecutionAddress = useMemo(
    () =>
      walletOwnedSourceBase?.family === 'evm'
        ? storageV2Account?.networks.find(
            network => network.chain.id === walletOwnedSourceBase.chain.chain.id
          )?.privateExecutionAddress
        : undefined,
    [storageV2Account, walletOwnedSourceBase]
  )
  const mainWalletOwnedSource = useMemo(
    () =>
      walletOwnedSourceBase
        ? selectWalletOwnedQuoteAssetExecution(walletOwnedSourceBase, 'main')
        : null,
    [walletOwnedSourceBase]
  )
  const privateWalletOwnedSource = useMemo(
    () =>
      walletOwnedSourceBase
        ? selectWalletOwnedQuoteAssetExecution(
            walletOwnedSourceBase,
            'private',
            sourcePrivateExecutionAddress
          )
        : null,
    [sourcePrivateExecutionAddress, walletOwnedSourceBase]
  )
  const executionSourceMode: QuoteDepositExecutionMode = privateTransferRequested
    ? 'private'
    : resolveSwapExecutionSourceMode({
        requestedMode: sourceMode,
        isPrivateFunding,
        sourceFamily: walletOwnedSourceBase?.family ?? null,
        privateSourceAvailable: Boolean(privateWalletOwnedSource)
      })
  const walletOwnedSource =
    executionSourceMode === 'private' ? privateWalletOwnedSource : mainWalletOwnedSource
  const walletSwapSourceTokens = useMemo(() => {
    const startedAt = performance.now()
    const tokens = listWalletSwapSourceTokens(swap.sourceTokens, portfolio, receiveTargets, {
      includeZcash: Boolean(
        currentAccount?.addresses.shielded && currentAccount.addresses.transparent
      )
    })
    const available = isPrivateFunding
      ? filterConfidentialFundingSourceTokens(tokens, portfolio, receiveTargets)
      : tokens
    logDebugTiming(
      walletSourcesTraceId,
      `source-map catalog=${swap.sourceTokens.length} mapped=${available.length}`,
      startedAt
    )
    return available
  }, [
    isPrivateFunding,
    swap.sourceTokens,
    portfolio,
    receiveTargets,
    currentAccount?.addresses.shielded,
    currentAccount?.addresses.transparent,
    walletSourcesTraceId
  ])
  const quotedSwapSourceKeys = useMemo(
    () => new Set(swap.sourceTokens.map(token => `${token.blockchain}:${token.assetId}`)),
    [swap.sourceTokens]
  )
  const walletSwapSourceBalances = useMemo<ReadonlyMap<string, string>>(() => {
    const startedAt = performance.now()
    const balances = buildWalletSwapSourceBalances({
      tokens: walletSwapSourceTokens,
      portfolio,
      receiveTargets,
      zcashAvailable: storeBalance?.available || '0',
      evmExecutionMode: isPrivateFunding ? 'main' : executionSourceMode
    })
    logDebugTiming(walletSourcesTraceId, `source-balances mapped=${balances.size}`, startedAt)
    return balances
  }, [
    executionSourceMode,
    isPrivateFunding,
    portfolio,
    receiveTargets,
    storeBalance?.available,
    walletSwapSourceTokens,
    walletSourcesTraceId
  ])
  const preferredSwapSourceAssetId = useMemo(
    () => resolvePreferredSwapSourceAssetId(walletSwapSourceTokens, portfolio, receiveTargets),
    [portfolio, receiveTargets, walletSwapSourceTokens]
  )
  const isZecDestination = isZecToken(swap.tokenOut)
  const walletSourceQuoteTarget = useMemo(
    () =>
      !swap.isZecSource && swap.tokenIn && portfolio
        ? resolveWalletQuoteReceiveTarget(swap.tokenIn, portfolio, receiveTargets)
        : null,
    [swap.isZecSource, swap.tokenIn, portfolio, receiveTargets]
  )
  const swapRefreshChainId = resolveSwapRefreshChainId(swap.tokenIn, receiveTargets)
  useEffect(() => {
    if (!swapRefreshChainId || !effectiveWalletId || !effectiveAccountId) return
    let cancelled = false
    const scope = {
      walletId: effectiveWalletId,
      accountId: effectiveAccountId,
      endpointRuntimeKey: chainEndpointRuntimeKey
    }
    const startedAt = performance.now()
    void traceDebugStage(walletSourcesTraceId, 'read-refresh-source', () =>
      readCachedPortfolio(scope)
    )
      .then(cached =>
        cancelled
          ? null
          : traceDebugStage(walletSourcesTraceId, 'refresh-source-chain', () =>
              refreshPortfolioFromCache(scope, cached, {
                refreshChainIds: [swapRefreshChainId],
                additionalChainIds: [swapRefreshChainId]
              })
            )
      )
      .then(refreshed => {
        logDebugTiming(
          walletSourcesTraceId,
          `source-chain-ready assets=${refreshed?.assets.length ?? 0}`,
          startedAt
        )
        if (
          cancelled ||
          !isPortfolioModelForScope(refreshed, effectiveWalletId, effectiveAccountId)
        )
          return
        setPortfolio(refreshed)
        if (walletSourcesScope)
          cacheSwapWalletSources(walletSourcesScope, { portfolio: refreshed, receiveTargets })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [
    swapRefreshChainId,
    effectiveWalletId,
    effectiveAccountId,
    chainEndpointRuntimeKey,
    walletSourcesScope,
    receiveTargets,
    walletSourcesTraceId
  ])
  const walletDestinationTarget = useMemo(
    () =>
      !isZecDestination && swap.tokenOut && portfolio
        ? resolveWalletQuoteReceiveTarget(swap.tokenOut, portfolio, receiveTargets)
        : null,
    [isZecDestination, swap.tokenOut, portfolio, receiveTargets]
  )
  const destinationPrivateExecutionAddress = useMemo(
    () =>
      walletDestinationTarget?.kind === 'evm'
        ? storageV2Account?.networks.find(
            network => network.chain.id === walletDestinationTarget.chain.id
          )?.privateExecutionAddress
        : undefined,
    [storageV2Account, walletDestinationTarget]
  )
  const destinationMode: QuoteDepositExecutionMode = destinationPrivateExecutionAddress
    ? destinationWalletActionMode.mode
    : 'main'
  const privateFundingDestinationToken = useMemo(
    () =>
      isPrivateFunding
        ? resolveConfidentialFundingDestinationToken({
            tokens: swap.destinationTokens,
            destinationChain: privateFundingDestinationChain,
            destinationAsset: privateFundingDestinationAsset,
            portfolio,
            receiveTargets
          })
        : null,
    [
      isPrivateFunding,
      privateFundingDestinationAsset,
      privateFundingDestinationChain,
      portfolio,
      receiveTargets,
      swap.destinationTokens
    ]
  )

  const managedDestinationAddress = isZecDestination
    ? currentAccount?.addresses[swap.addressType]
    : (isPrivateFunding || destinationMode === 'private') && walletDestinationTarget?.kind === 'evm'
      ? destinationPrivateExecutionAddress
      : walletDestinationTarget?.address
  const requiresRecipientAddress =
    !isPrivateFunding && !isZecDestination && (!walletDestinationTarget || useCustomRecipient)
  const resolvedRecipientAddress = requiresRecipientAddress
    ? swap.recipientAddress
    : managedDestinationAddress || ''
  const resolvedRefundAddress = swap.isZecSource
    ? currentAccount?.addresses.transparent || ''
    : !isPrivateFunding && executionSourceMode === 'private'
      ? walletOwnedSource?.refundAddress || ''
      : walletSourceQuoteTarget?.address || ''
  const canSwitchTokens = Boolean(
    !isPrivateFunding &&
    !privateTransferRequested &&
    swap.tokenOut &&
    quotedSwapSourceKeys.has(`${swap.tokenOut.blockchain}:${swap.tokenOut.assetId}`)
  )
  const requestedSourceToken = useMemo(() => {
    if (!requestedSourceAssetId) return null
    const resolved = resolveWalletSwapSourceToken(
      requestedSourceAssetId,
      swap.sourceTokens,
      portfolio,
      receiveTargets
    )
    if (!resolved) return null
    return (
      swap.sourceTokens.find(
        token => token.assetId === resolved.assetId && token.blockchain === resolved.blockchain
      ) ?? null
    )
  }, [requestedSourceAssetId, swap.sourceTokens, portfolio, receiveTargets])
  const lockedSourceToken = useMemo(
    () =>
      requestedSourceAssetId
        ? resolveLockedWalletSwapSourceToken({
            requestedToken: requestedSourceToken,
            sourceTokens: swap.sourceTokens,
            walletSourceTokens: walletSwapSourceTokens
          })
        : null,
    [requestedSourceAssetId, requestedSourceToken, swap.sourceTokens, walletSwapSourceTokens]
  )
  const lockedSourceMatchesRequest = Boolean(
    !requestedSourceAssetId ||
    (lockedSourceToken &&
      swap.tokenIn?.assetId === lockedSourceToken.assetId &&
      swap.tokenIn.rheaChainId === lockedSourceToken.rheaChainId &&
      swap.tokenIn.rheaAddress === lockedSourceToken.rheaAddress)
  )
  const lockedDestinationMatchesRequest = Boolean(
    !lockedAssetFlowRequested ||
    (isPrivateFunding
      ? privateFundingDestinationToken &&
        swap.tokenOut?.rheaChainId === privateFundingDestinationToken.rheaChainId &&
        swap.tokenOut.rheaAddress === privateFundingDestinationToken.rheaAddress
      : lockedSourceToken &&
        swap.tokenOut?.assetId === lockedSourceToken.assetId &&
        swap.tokenOut.blockchain === lockedSourceToken.blockchain)
  )
  const lockedAssetFlowReady = lockedSourceMatchesRequest && lockedDestinationMatchesRequest
  const crossChainSendSourceReady = Boolean(
    requestedSourceAssetId &&
    lockedSourceMatchesRequest &&
    swap.tokenIn &&
    getCrossChainSendTokenGroup(swap.tokenIn) &&
    isCrossChainSendChainEnabled(swap.tokenIn, CROSS_CHAIN_SEND_CAPABILITIES)
  )
  const crossChainSendDestinationReady = Boolean(
    swap.tokenOut &&
    isCrossChainSendDestination(swap.tokenIn, swap.tokenOut, CROSS_CHAIN_SEND_CAPABILITIES)
  )
  const crossChainSendRecipientReady = isCrossChainSendRecipientValid(
    swap.tokenOut,
    resolvedRecipientAddress
  )

  useEffect(() => {
    setUseCustomRecipient(privateTransferRequested)
  }, [privateTransferRequested, swap.tokenOut?.assetId])

  useEffect(() => {
    if (
      isPrivateFunding ||
      privateTransferRequested ||
      !requestedSourceToken ||
      swap.tokenIn?.assetId === requestedSourceToken.assetId
    ) {
      return
    }
    const sourceToken = swap.sourceTokens.find(
      token =>
        token.assetId === requestedSourceToken.assetId &&
        token.blockchain === requestedSourceToken.blockchain
    )
    if (sourceToken) swap.selectTokenIn(sourceToken)
  }, [
    isPrivateFunding,
    privateTransferRequested,
    requestedSourceToken,
    swap.selectTokenIn,
    swap.sourceTokens,
    swap.tokenIn?.assetId
  ])

  useEffect(() => {
    if (swap.isZecSource) setSourceSelectorOpen(false)
  }, [swap.isZecSource])

  useEffect(() => {
    if (
      (sourceMode === 'private' || privateTransferRequested) &&
      walletOwnedSourceBase?.family === 'evm' &&
      !privateWalletOwnedSource &&
      !walletSourcesLoading
    ) {
      if (!privateTransferRequested) setSourceMode('main')
      setMaxSelected(false)
      swap.updateAmountIn('')
    }
  }, [
    privateWalletOwnedSource,
    setSourceMode,
    sourceMode,
    privateTransferRequested,
    swap.updateAmountIn,
    walletOwnedSourceBase?.family,
    walletSourcesLoading
  ])

  const discardPreparedQuoteTransfer = useCallback(async () => {
    const prepared = pendingQuoteTransfer.current
    const signingQuote = pendingRheaSigningQuote.current
    pendingQuoteTransfer.current = null
    pendingRheaSigningQuote.current = null
    setPreparedQuoteTransfer(null)
    setPendingRheaEvmAfterApproval(null)
    setRheaSigningReview(null)
    await Promise.all([
      prepared ? quoteDepositTransferClient.reject(prepared).catch(() => {}) : Promise.resolve(),
      signingQuote
        ? (signingQuote.kind === 'evm-signature'
            ? rheaSwapClient.cancelEvmSignature(signingQuote.quoteHandle)
            : signingQuote.kind === 'solana-transaction'
              ? rheaSwapClient.cancelSolanaTransaction(signingQuote.quoteHandle)
              : rheaSwapClient.cancelNearTransactionBatch(signingQuote.quoteHandle)
          ).catch(() => {})
        : Promise.resolve()
    ])
  }, [])

  useEffect(() => {
    const activeScope =
      effectiveWalletId && effectiveAccountId
        ? `${effectiveWalletId}:${effectiveAccountId}:${chainEndpointRuntimeKey}`
        : null
    const previousScope = activeScopeRef.current
    activeScopeRef.current = activeScope
    if (previousScope === undefined || previousScope === activeScope) return

    quoteRequestSequence.current += 1
    initializedPrivateFundingScope.current = null
    initializedPrivateFundingAmountScope.current = null
    setIsPrivateFundingSubmitting(false)
    setDirectTransferError(null)
    directSubmitStartedScope.current = null
    void discardPreparedQuoteTransfer()
    setViewStep('input')
    setQuoteResult(null)
    setLiveQuoteKey(null)
    lastRequestedQuoteKey.current = null
    setMaxSelected(false)
    swap.resetSwap()
  }, [
    effectiveWalletId,
    effectiveAccountId,
    chainEndpointRuntimeKey,
    discardPreparedQuoteTransfer,
    swap.resetSwap
  ])

  useEffect(() => {
    if (
      !swapPreferencesHydrated ||
      !swapPreferenceScope ||
      (lockedAssetFlowRequested && swap.areTokensLoading) ||
      walletSourcesLoading ||
      walletSwapSourceTokens.length === 0
    ) {
      return
    }
    if (isPrivateFunding) {
      const walletSourceIds = new Set(walletSwapSourceTokens.map(token => token.assetId))
      const initializationScope = [
        walletSourcesScope,
        privateFundingDestinationChain,
        privateFundingDestinationAsset,
        requestedSourceAssetId,
        privateFundingAmount
      ].join(':')
      const needsInitialization = initializedPrivateFundingScope.current !== initializationScope
      const currentSource = swap.sourceTokens.find(
        token => token.assetId === swap.tokenIn?.assetId && walletSourceIds.has(token.assetId)
      )
      const positiveBalanceSource = walletSwapSourceTokens.find(token => {
        const balance = walletSwapSourceBalances.get(token.assetId)
        return balance !== undefined && safeBig(balance).gt(0)
      })
      const sourceToken = requestedSourceAssetId
        ? lockedSourceToken
        : ((needsInitialization
            ? swap.sourceTokens.find(
                token =>
                  token.assetId === privateFundingDestinationToken?.assetId &&
                  walletSourceIds.has(token.assetId)
              )
            : currentSource) ??
          currentSource ??
          positiveBalanceSource ??
          swap.sourceTokens.find(token => token.assetId === preferredSwapSourceAssetId) ??
          swap.sourceTokens.find(token => walletSourceIds.has(token.assetId)))
      initializedPrivateFundingScope.current = initializationScope
      if (
        sourceToken &&
        (sourceToken.assetId !== swap.tokenIn?.assetId ||
          sourceToken.rheaChainId !== swap.tokenIn.rheaChainId ||
          sourceToken.rheaAddress !== swap.tokenIn.rheaAddress)
      ) {
        swap.selectTokenIn(sourceToken)
      } else if (requestedSourceAssetId && !sourceToken && swap.tokenIn) {
        swap.clearTokenPairForFlow()
      }
      if (needsInitialization && privateFundingAmount) {
        swap.updateAmountIn(privateFundingAmount)
      }
      if (
        privateFundingDestinationToken &&
        (swap.tokenOut?.rheaChainId !== privateFundingDestinationToken.rheaChainId ||
          swap.tokenOut.rheaAddress !== privateFundingDestinationToken.rheaAddress)
      ) {
        swap.selectTokenOutForFlow(privateFundingDestinationToken)
      } else if (
        !privateFundingDestinationToken &&
        (needsInitialization || !swap.destinationTokensLoading) &&
        swap.tokenOut
      ) {
        swap.clearTokenOutForFlow()
      }
      return
    }
    if (privateTransferRequested) {
      const sourceToken = lockedSourceToken
      const destinationToken = sourceToken
        ? swap.destinationTokens.find(
            token =>
              token.assetId === sourceToken.assetId && token.blockchain === sourceToken.blockchain
          )
        : undefined
      const initializationScope = [
        walletSourcesScope,
        requestedSourceToken?.assetId,
        privateTransferRecipient,
        privateTransferAmount
      ].join(':')
      if (sourceToken && destinationToken) {
        if (
          swap.tokenIn?.assetId !== sourceToken.assetId ||
          swap.tokenIn.blockchain !== sourceToken.blockchain ||
          swap.tokenOut?.assetId !== destinationToken.assetId ||
          swap.tokenOut.blockchain !== destinationToken.blockchain
        ) {
          swap.setTokenPair(sourceToken, destinationToken)
        }
      } else if (!swap.areTokensLoading && swap.tokenIn) {
        swap.clearTokenPairForFlow()
      }
      if (
        initializedPrivateTransferScope.current !== initializationScope &&
        sourceToken &&
        destinationToken
      ) {
        initializedPrivateTransferScope.current = initializationScope
        swap.setRecipientAddress(privateTransferRecipient)
        swap.updateAmountIn(privateTransferAmount)
        setUseCustomRecipient(true)
      }
      return
    }
    if (crossChainSendRequested) {
      const sourceToken = lockedSourceToken
      if (
        !sourceToken ||
        !getCrossChainSendTokenGroup(sourceToken) ||
        !isCrossChainSendChainEnabled(sourceToken, CROSS_CHAIN_SEND_CAPABILITIES)
      ) {
        if (!swap.areTokensLoading && swap.tokenIn) swap.clearTokenPairForFlow()
        return
      }
      if (
        swap.tokenIn?.assetId !== sourceToken.assetId ||
        swap.tokenIn.rheaChainId !== sourceToken.rheaChainId
      ) {
        swap.setTokenPair(sourceToken, null)
      } else if (
        swap.tokenOut &&
        !isCrossChainSendDestination(sourceToken, swap.tokenOut, CROSS_CHAIN_SEND_CAPABILITIES)
      ) {
        swap.clearTokenOutForFlow()
      }
      return
    }
    const resolved = resolveSwapTokenSelection({
      tokens: swap.tokens,
      sourceTokens: swap.sourceTokens,
      crossChainDestinationTokens: swap.crossChainDestinationTokens,
      walletSourceTokens: walletSwapSourceTokens,
      savedSelection: savedTokenSelection,
      requestedSourceAssetId: requestedSourceToken?.assetId,
      preferredSourceAssetId: preferredSwapSourceAssetId
    })
    if (
      (swap.areTokensLoading &&
        savedTokenSelection?.tokenInId &&
        !swap.sourceTokens.some(token => token.assetId === savedTokenSelection.tokenInId)) ||
      (swap.destinationTokensLoading &&
        savedTokenSelection?.tokenOutId &&
        resolved?.tokenOut?.assetId !== savedTokenSelection.tokenOutId)
    )
      return
    if (
      !resolved ||
      (swap.tokenIn?.assetId === resolved.tokenIn.assetId &&
        swap.tokenOut?.assetId === resolved.tokenOut?.assetId)
    ) {
      return
    }
    const tokenIn = swap.tokens.find(
      token =>
        token.assetId === resolved.tokenIn.assetId &&
        token.blockchain === resolved.tokenIn.blockchain
    )
    const tokenOut = resolved.tokenOut
      ? (swap.tokens.find(
          token =>
            token.assetId === resolved.tokenOut?.assetId &&
            token.blockchain === resolved.tokenOut.blockchain
        ) ?? null)
      : null
    if (tokenIn) swap.setTokenPair(tokenIn, tokenOut)
  }, [
    preferredSwapSourceAssetId,
    privateFundingDestinationToken,
    privateFundingDestinationChain,
    privateFundingDestinationAsset,
    privateFundingAmount,
    isPrivateFunding,
    crossChainSendRequested,
    lockedAssetFlowRequested,
    privateTransferRequested,
    privateTransferRecipient,
    privateTransferAmount,
    requestedSourceAssetId,
    requestedSourceToken?.assetId,
    lockedSourceToken,
    savedTokenSelection,
    swapPreferencesHydrated,
    swapPreferenceScope,
    swap.areTokensLoading,
    swap.destinationTokensLoading,
    swap.sourceTokens,
    swap.crossChainDestinationTokens,
    swap.tokenIn?.assetId,
    swap.tokenIn?.decimals,
    swap.tokenOut?.assetId,
    swap.tokens,
    swap.setTokenPair,
    swap.selectTokenIn,
    swap.selectTokenOutForFlow,
    swap.clearTokenOutForFlow,
    swap.clearTokenPairForFlow,
    walletSourcesLoading,
    walletSourcesScope,
    walletSwapSourceBalances,
    walletSwapSourceTokens
  ])

  const privateFundingSuggestedAmount = useMemo(() => {
    if (
      !privateFundingRequestId ||
      !privateFundingSuggestedOutputRaw ||
      !swap.tokenIn ||
      !privateFundingDestinationToken
    ) {
      return null
    }

    return calculatePrivateFundingSourceAmount({
      suggestedOutputRaw: privateFundingSuggestedOutputRaw,
      source: {
        chainId: swap.tokenIn.rheaChainId,
        address: swap.tokenIn.rheaAddress,
        decimals: swap.tokenIn.decimals,
        price: swap.tokenIn.price
      },
      destination: {
        chainId: privateFundingDestinationToken.rheaChainId,
        address: privateFundingDestinationToken.rheaAddress,
        decimals: privateFundingDestinationToken.decimals,
        price: privateFundingDestinationToken.price
      }
    })
  }, [
    privateFundingDestinationToken,
    privateFundingRequestId,
    privateFundingSuggestedOutputRaw,
    swap.tokenIn
  ])

  useEffect(() => {
    if (!privateFundingSuggestedAmount || !swap.tokenIn) return
    const amountScope = [
      walletSourcesScope,
      privateFundingRequestId,
      swap.tokenIn.rheaChainId,
      swap.tokenIn.rheaAddress,
      privateFundingSuggestedOutputRaw
    ].join(':')
    if (initializedPrivateFundingAmountScope.current === amountScope) return
    initializedPrivateFundingAmountScope.current = amountScope
    setMaxSelected(false)
    swap.updateAmountIn(privateFundingSuggestedAmount)
  }, [
    privateFundingRequestId,
    privateFundingSuggestedAmount,
    privateFundingSuggestedOutputRaw,
    swap.tokenIn,
    swap.updateAmountIn,
    walletSourcesScope
  ])

  useEffect(
    () => () => {
      quoteRequestSequence.current += 1
      const prepared = pendingQuoteTransfer.current
      pendingQuoteTransfer.current = null
      if (prepared) void quoteDepositTransferClient.reject(prepared).catch(() => {})
    },
    []
  )

  const rawSpendable = swap.isZecSource ? storeBalance?.available || '0' : '0'
  const walletAmountRaw = useMemo(() => {
    if (!walletOwnedSource || !swap.amountIn) return null
    try {
      return parseDisplayUnitAmount(swap.amountIn, walletOwnedSource.asset.metadata.decimals)
    } catch {
      return null
    }
  }, [walletOwnedSource, swap.amountIn])

  const maxTransfer = useMaxTransferEstimate({
    to: swap.depositAddress,
    feeTier,
    enabled: swap.isZecSource && !!swap.depositAddress
  })
  const isMaxTransferAmount =
    !!maxTransfer.maxAmount && safeBig(swap.amountIn || '0').eq(maxTransfer.maxAmount)

  // Estimate as soon as we have a deposit address, so the input page reflects
  // the live tier fee instead of waiting until the review step.
  const feeEstimate = useFeeEstimate({
    type: 'send',
    to: swap.depositAddress,
    amount: swap.amountIn,
    enabled: swap.isZecSource && !!swap.depositAddress && !maxSelected && !isMaxTransferAmount
  })
  const feeByTier = deriveFeeByTier(feeEstimate.feeZats, feeEstimate.error)
  const maxFeeByTier = deriveFeeByTierFromEstimate(
    maxTransfer.fee ? safeBig(maxTransfer.fee).mul(1e8).toNumber() : null,
    feeTier,
    maxTransfer.error
  )
  const isMaxFeeMode = maxSelected || isMaxTransferAmount
  const displayedFeeByTier = isMaxFeeMode ? maxFeeByTier : feeByTier
  const displayedFeeLoading = isMaxFeeMode ? maxTransfer.loading : feeEstimate.loading
  const standardFeeZats = feeByTier.standard ?? staticFeeFallbackZats('standard')
  const selectedFeeZats = feeByTier[feeTier] ?? staticFeeFallbackZats(feeTier)
  const estimatedFeeZec = safeBig(selectedFeeZats).div(1e8).toFixed()
  // Approximate while no live estimate is in flight or resolved (e.g. before a
  // quote has produced a deposit address). UI uses this to avoid implying the
  // ZIP-317 fallback figure is the real network fee.
  const feeIsApproximate =
    swap.isZecSource &&
    !displayedFeeLoading &&
    displayedFeeByTier.standard === null &&
    displayedFeeByTier.fast === null
  const zcashAvailability = resolveZcashTransferAvailability({
    availableBalance: rawSpendable,
    selectedFeeZats,
    standardFeeZats,
    maximumAmount: maxTransfer.maxAmount
  })
  const routeMaximum = useTransferMaximum({
    enabled:
      viewStep === 'input' &&
      !swap.isZecSource &&
      walletOwnedSource?.asset.asset.kind === 'native' &&
      Boolean(swap.tokenIn && swap.tokenOut && resolvedRecipientAddress) &&
      (!crossChainSendRequested ||
        (crossChainSendSourceReady &&
          crossChainSendDestinationReady &&
          crossChainSendRecipientReady)) &&
      !walletSourcesLoading &&
      BigInt(walletOwnedSource.asset.balance.availableRaw) > 0n,
    requestKey: `${walletSourcesScope}:${swap.tokenIn?.assetId}:${swap.tokenOut?.assetId}:${walletOwnedSource?.refundAddress}:${walletOwnedSource?.asset.balance.availableRaw}:${resolvedRecipientAddress}:${executionSourceMode}:${destinationMode}:${swap.slippage}:${networkFeeTier}`,
    fallback: () => {
      if (!walletOwnedSource) throw new Error('No Swap source')
      return fallbackTransferMaximum(walletOwnedSource)
    },
    estimate: async () => {
      if (!walletOwnedSource || !swap.tokenIn || !swap.tokenOut)
        throw new Error('Incomplete Swap route')
      return estimateRheaRouteMaximum({
        source: walletOwnedSource,
        tokenIn: swap.tokenIn,
        tokenOut: swap.tokenOut,
        recipient: resolvedRecipientAddress,
        confidential:
          isPrivateFunding || executionSourceMode === 'private' || destinationMode === 'private',
        executionMode: executionSourceMode,
        feeTier: networkFeeTier,
        slippageBps: swap.slippage
      })
    }
  })
  useEffect(() => {
    if (
      !maxSelected ||
      viewStep !== 'input' ||
      !walletOwnedSource ||
      walletOwnedSource.asset.asset.kind !== 'native'
    ) {
      if (!maxSelected) maxSourceBalanceRaw.current = null
      return
    }
    const sourceBalanceRaw = walletOwnedSource.asset.balance.availableRaw
    const balanceChanged =
      maxSourceBalanceRaw.current !== null && maxSourceBalanceRaw.current !== sourceBalanceRaw
    maxSourceBalanceRaw.current = sourceBalanceRaw
    if (balanceChanged) {
      reviewAfterQuoteRefresh.current = null
      maxQuoteAdjustmentCount.current = 0
    }
    if (routeMaximum.value) {
      if (reviewAfterQuoteRefresh.current === null)
        swap.updateAmountIn(
          formatBaseUnitDecimalAmount(routeMaximum.value.amountRaw, swap.tokenIn?.decimals ?? 18)
        )
      return
    }
    if (routeMaximum.loading || reviewAfterQuoteRefresh.current !== null) return
    swap.updateAmountIn(
      formatBaseUnitDecimalAmount(
        fallbackTransferMaximum(walletOwnedSource).amountRaw,
        walletOwnedSource.asset.metadata.decimals
      )
    )
    void routeMaximum.request()
  }, [
    maxSelected,
    routeMaximum.value,
    routeMaximum.loading,
    viewStep,
    walletOwnedSource?.asset.balance.availableRaw,
    walletOwnedSource?.asset.asset.kind,
    swap.updateAmountIn,
    swap.tokenIn?.decimals
  ])
  const walletAvailability = walletOwnedSource
    ? resolvePortfolioTransferAvailability({
        balanceRaw: walletOwnedSource.asset.balance.availableRaw,
        decimals: walletOwnedSource.asset.metadata.decimals,
        isNative: walletOwnedSource.asset.asset.kind === 'native',
        maximumRaw: routeMaximum.value?.amountRaw ?? null
      })
    : null
  const walletSpendableBalance = walletAvailability?.display ?? '0'
  const mainWalletSpendableBalance = mainWalletOwnedSource
    ? resolvePortfolioTransferAvailability({
        balanceRaw: mainWalletOwnedSource.asset.balance.availableRaw,
        decimals: mainWalletOwnedSource.asset.metadata.decimals,
        isNative: mainWalletOwnedSource.asset.asset.kind === 'native',
        maximumRaw: null
      }).display
    : undefined
  const privateWalletSpendableBalance = privateWalletOwnedSource
    ? resolvePortfolioTransferAvailability({
        balanceRaw: privateWalletOwnedSource.asset.balance.availableRaw,
        decimals: privateWalletOwnedSource.asset.metadata.decimals,
        isNative: privateWalletOwnedSource.asset.asset.kind === 'native',
        maximumRaw: null
      }).display
    : undefined
  const spendableBalance = swap.isZecSource ? zcashAvailability.amount : walletSpendableBalance
  const networkFee = maxTransfer.fee && isMaxTransferAmount ? maxTransfer.fee : estimatedFeeZec

  const hasInsufficientFunds = isSwapSourceAmountInsufficient({
    isZecSource: swap.isZecSource,
    amount: swap.amountIn,
    amountRaw: walletAmountRaw,
    sourceAvailableRaw: walletAvailability?.amountRaw ?? null,
    sourceSelected: !!swap.tokenIn,
    zcashAvailable: zcashAvailability.amount
  })
  const hasInvalidWalletAmount =
    !!walletOwnedSource &&
    !!swap.amountIn &&
    safeBig(swap.amountIn).gt(0) &&
    walletAmountRaw === null
  const preparedFeeUnaffordable = isPreparedSwapFeeUnaffordable(preparedQuoteTransfer)

  const liveQuoteRequest = useMemo(() => {
    return buildLiveSwapQuoteRequest({
      tokenIn: swap.tokenIn,
      tokenOut: swap.tokenOut,
      amountIn: swap.amountIn,
      slippage: swap.slippage,
      refundAddress: resolvedRefundAddress,
      recipientAddress: resolvedRecipientAddress,
      confidentiality:
        isPrivateFunding ||
        executionSourceMode === 'private' ||
        (!requiresRecipientAddress && destinationMode === 'private')
          ? 'basic'
          : undefined,
      blocked:
        walletActionMode.loading ||
        destinationWalletActionMode.loading ||
        (crossChainSendRequested &&
          (currentNetwork !== 'mainnet' ||
            !crossChainSendSourceReady ||
            !crossChainSendDestinationReady ||
            !crossChainSendRecipientReady)) ||
        (lockedAssetFlowRequested && !lockedAssetFlowReady) ||
        (isPrivateFunding && !privateFundingDestinationToken) ||
        hasInvalidWalletAmount ||
        (!swap.isZecSource && walletSourcesLoading)
    })
  }, [
    swap.tokenIn?.assetId,
    swap.tokenIn?.decimals,
    swap.tokenOut?.assetId,
    swap.amountIn,
    swap.slippage,
    swap.isZecSource,
    resolvedRefundAddress,
    resolvedRecipientAddress,
    executionSourceMode,
    destinationMode,
    requiresRecipientAddress,
    walletActionMode.loading,
    destinationWalletActionMode.loading,
    hasInvalidWalletAmount,
    walletSourcesLoading,
    isPrivateFunding,
    privateFundingDestinationToken,
    lockedAssetFlowRequested,
    lockedAssetFlowReady,
    crossChainSendRequested,
    currentNetwork,
    crossChainSendSourceReady,
    crossChainSendDestinationReady,
    crossChainSendRecipientReady
  ])

  const swapEventBase = useCallback(
    (): TrackOptions => ({
      pageId: PAGE_IDS.SWAP,
      inputAmount: swap.amountIn,
      inputSymbol: swap.tokenIn?.symbol,
      inputTokenCode: swap.tokenIn?.assetId,
      outputAmount: swap.amountOut,
      outputSymbol: swap.tokenOut?.symbol,
      outputTokenCode: swap.tokenOut?.assetId,
      usdAmount: calculateSwapUsdAmount({
        amountIn: swap.amountIn,
        inputPrice: swap.isZecSource && zecPrice > 0 ? zecPrice : swap.tokenIn?.price,
        amountOut: swap.amountOut,
        outputPrice: swap.tokenOut?.price
      }),
      extra: { direction: swap.isZecSource ? 'zec_source' : 'multichain_source' }
    }),
    [swap, zecPrice]
  )

  useEffect(() => {
    if (viewStep !== 'input') {
      reviewAfterQuoteRefresh.current = null
      swap.setIsQuoting(false)
      return
    }
    const requestSequence = ++quoteRequestSequence.current
    const requestKey = liveQuoteRequest?.key ?? null
    const requestChanged = lastRequestedQuoteKey.current !== requestKey
    lastRequestedQuoteKey.current = requestKey

    if (requestChanged) {
      setQuoteResult(null)
      setRheaReview(null)
      setLiveQuoteKey(null)
      setQuoteReceivedAt(null)
      swap.setAmountOut('')
      swap.setDepositAddress('')
    }
    swap.setQuoteError(null)
    setQuoteRetryable(false)

    if (!liveQuoteRequest || !swap.tokenIn || !swap.tokenOut) {
      swap.setIsQuoting(false)
      return
    }

    const tokenIn = swap.tokenIn
    const tokenOut = swap.tokenOut
    swap.setIsQuoting(true)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await rheaSwapClient.quote({
            fromChain: tokenIn.rheaChainId,
            toChain: tokenOut.rheaChainId,
            tokenIn: {
              chain: tokenIn.rheaChainId,
              address: tokenIn.rheaAddress,
              symbol: tokenIn.symbol,
              decimals: tokenIn.decimals,
              isNative: tokenIn.isNative
            },
            tokenOut: {
              chain: tokenOut.rheaChainId,
              address: tokenOut.rheaAddress,
              symbol: tokenOut.symbol,
              decimals: tokenOut.decimals,
              isNative: tokenOut.isNative
            },
            amountIn: liveQuoteRequest.amount,
            slippageBps: liveQuoteRequest.slippageTolerance,
            sender: resolvedRefundAddress,
            recipient: resolvedRecipientAddress,
            ...(liveQuoteRequest.confidentiality === undefined
              ? {}
              : { confidentiality: liveQuoteRequest.confidentiality })
          })
          if (requestSequence !== quoteRequestSequence.current) return
          setQuoteResult(result)
          setLiveQuoteKey(liveQuoteRequest.key)
          setQuoteReceivedAt(result.receivedAt)
          swap.setAmountOut(formatBaseUnitAmount(result.estimatedOut, tokenOut.decimals))
          swap.setDepositAddress('')
        } catch (error) {
          if (requestSequence !== quoteRequestSequence.current) return
          const classified = classifyError(error)
          console.error('[Private Transfer] Quote failed', {
            flow: isPrivateFunding
              ? 'main-to-private'
              : privateTransferRequested
                ? 'private-transfer'
                : 'swap',
            sourceAsset: tokenIn.assetId,
            destinationAsset: tokenOut.assetId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            errorMessage: classified.technicalMessage
          })
          reviewAfterQuoteRefresh.current = null
          setQuoteResult(null)
          setLiveQuoteKey(null)
          setQuoteReceivedAt(null)
          swap.setAmountOut('')
          swap.setDepositAddress('')
          swap.setQuoteError(getRheaSwapErrorMessage(error))
          setQuoteRetryable(classified.retryable)
        } finally {
          if (requestSequence === quoteRequestSequence.current) swap.setIsQuoting(false)
        }
      })()
    }, LIVE_QUOTE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    viewStep,
    quoteRefreshTick,
    liveQuoteRequest,
    resolvedRefundAddress,
    resolvedRecipientAddress,
    swap.tokenIn?.assetId,
    swap.tokenIn?.symbol,
    swap.tokenOut?.assetId,
    swap.tokenOut?.symbol,
    swap.amountIn,
    swap.isZecSource,
    swap.setAmountOut,
    swap.setDepositAddress,
    swap.setIsQuoting,
    swap.setQuoteError,
    swap.updateAmountIn,
    isPrivateFunding
  ])

  const reviewLiveQuote = useCallback(
    async (feeTierOverride?: NetworkFeeTier) => {
      if (hasInsufficientFunds || preparingReview.current) return
      const result = quoteResult
      const requestKey = liveQuoteRequest?.key
      const { tokenIn, tokenOut } = swap
      if (
        !result ||
        !requestKey ||
        liveQuoteKey !== requestKey ||
        !tokenIn ||
        !tokenOut ||
        !isRheaSwapQuoteFresh(result)
      ) {
        reviewAfterQuoteRefresh.current = createSwapQuoteRefreshTarget(liveQuoteRequest)
        setQuoteResult(null)
        setLiveQuoteKey(null)
        setQuoteReceivedAt(null)
        swap.setAmountOut('')
        swap.setDepositAddress('')
        setQuoteRefreshTick(current => current + 1)
        return
      }
      if (
        isPrivateFunding &&
        privateFundingMinimumRaw &&
        /^\d+$/.test(privateFundingMinimumRaw) &&
        BigInt(result.minAmountOut) < BigInt(privateFundingMinimumRaw)
      ) {
        const message = `Increase the amount to receive enough ${tokenOut.symbol}`
        swap.setQuoteError(message)
        if (directSubmitRequested) setDirectTransferError(message)
        return
      }

      preparingReview.current = true
      setIsPreparingReview(true)
      const requestSequence = ++quoteRequestSequence.current
      const requestId = createDebugRequestId('swap-prepare')
      let failedStage = 'discard-previous-preparation'
      const measure = <T,>(stage: string, operation: () => Promise<T>): Promise<T> => {
        failedStage = stage
        return traceDebugStage(requestId, stage, operation)
      }
      try {
        await measure('discard-previous-preparation', discardPreparedQuoteTransfer)
        if (requestSequence !== quoteRequestSequence.current) return
        const review = await measure('rhea-prepare', () =>
          rheaSwapClient.prepare(result.quoteHandle)
        )
        if (requestSequence !== quoteRequestSequence.current) return
        if (maxSelected && !swap.isZecSource && walletOwnedSource) {
          const adjustment = await measure('resolve-maximum', () =>
            resolveSwapMaximumAdjustment(
              {
                source: walletOwnedSource,
                review,
                currentAmount: swap.amountIn,
                feeTier: feeTierOverride ?? networkFeeTier,
                executionMode: executionSourceMode,
                refreshFees: feeTierOverride !== undefined,
                adjustmentCount: maxQuoteAdjustmentCount.current
              },
              {
                getEvmTransactionPlan: rheaSwapClient.getEvmTransactionPlan,
                estimateMaximum: quoteDepositTransferClient.estimateMaximum
              }
            )
          )
          if (requestSequence !== quoteRequestSequence.current) return
          if (adjustment) {
            maxQuoteAdjustmentCount.current = adjustment.adjustmentCount
            if (feeTierOverride) setNetworkFeeTier(feeTierOverride)
            await rheaSwapClient.discard(result.quoteHandle)
            if (requestSequence !== quoteRequestSequence.current) return
            reviewAfterQuoteRefresh.current = createSwapQuoteRefreshTarget(liveQuoteRequest, {
              decimal: adjustment.amount,
              decimals: walletOwnedSource.asset.metadata.decimals
            })
            setViewStep('input')
            swap.updateAmountIn(adjustment.amount)
            return
          }
        }
        if (swap.isZecSource) {
          if (
            review.execution.kind !== 'zcash-transfer' ||
            !review.execution.target ||
            review.execution.amountRaw !== review.amountIn
          ) {
            throw new Error('RHEA Swap Zcash build does not match the quoted source amount')
          }

          const transferTarget = review.execution.target
          const marginalFeeZats = marginalFeeForTier(feeTier)
          if (maxSelected) {
            const estimate = await measure('zcash-estimate-maximum', () =>
              zcashWalletRuntimeClient.estimateMaxTransfer({
                to: transferTarget,
                marginalFeeZats,
                debugRequestId: requestId
              })
            ).catch(() => null)
            if (requestSequence !== quoteRequestSequence.current) return
            const exactMax = estimate ? safeBig(estimate.maxAmountZats).div(1e8).toFixed() : null
            const adjustment = resolveZcashSwapMaximumAdjustment({
              currentAmount: swap.amountIn,
              exactMaximum: exactMax,
              adjustmentCount: maxQuoteAdjustmentCount.current
            })
            if (adjustment) {
              maxQuoteAdjustmentCount.current = adjustment.adjustmentCount
              await rheaSwapClient.discard(result.quoteHandle).catch(() => {})
              if (requestSequence !== quoteRequestSequence.current) return
              reviewAfterQuoteRefresh.current = createSwapQuoteRefreshTarget(liveQuoteRequest, {
                decimal: adjustment.amount,
                decimals: tokenIn.decimals
              })
              setViewStep('input')
              swap.updateAmountIn(adjustment.amount)
              return
            }
          }

          await measure('zcash-estimate-fee', () =>
            zcashWalletRuntimeClient.estimateTransferFee({
              to: transferTarget,
              amount: swap.amountIn,
              marginalFeeZats,
              debugRequestId: requestId
            })
          )
          if (requestSequence !== quoteRequestSequence.current) return
        } else {
          if (!walletOwnedSource) throw new Error('The selected source asset is unavailable')
          const destination = resolveRheaSwapDestinationIdentity(tokenOut, portfolio)
          const binding = createRheaSwapBinding({
            source: walletOwnedSource,
            destinationAssetId: destination.assetId,
            destinationChainId: destination.chainId,
            tokenIn,
            tokenOut,
            recipient: resolvedRecipientAddress,
            quote: result,
            review,
            ...(privateTransferRequested ||
            privateBalanceTransferRequested ||
            crossChainSendRequested
              ? { userAction: 'transfer' as const }
              : {}),
            ...(liveQuoteRequest?.confidentiality === undefined
              ? {}
              : { confidentiality: liveQuoteRequest.confidentiality })
          })
          let prepared: PreparedQuoteDepositTransfer | null = null
          let pendingEvmAfterApproval: PendingRheaEvmAfterApproval | null = null
          if (
            walletOwnedSource.family === 'bitcoin' &&
            review.execution.kind === 'bitcoin-transfer'
          ) {
            if (!review.execution.target || review.execution.amountRaw !== review.amountIn) {
              throw new Error('RHEA Swap Bitcoin build does not match the quoted source amount')
            }
            const depositAddress = review.execution.target
            prepared = await measure('bitcoin-prepare-deposit', () =>
              quoteDepositTransferClient.prepare({
                source: walletOwnedSource,
                depositAddress,
                amountRaw: review.amountIn,
                rheaSwapBinding: binding,
                feeTier: feeTierOverride ?? networkFeeTier
              })
            )
          } else if (
            walletOwnedSource.family === 'evm' &&
            review.execution.kind === 'evm-transaction'
          ) {
            const plan = await measure('rhea-evm-plan', () =>
              rheaSwapClient.getEvmTransactionPlan(result.quoteHandle)
            )
            const requiredApproval = await measure('evm-check-allowance', () =>
              requiredRheaEvmApproval({
                approval: plan.approval,
                chainId: walletOwnedSource.chain.chain.id,
                owner: walletOwnedSource.refundAddress,
                executionMode: executionSourceMode,
                getTokenAllowance: evmWalletClient.getTokenAllowance
              })
            )
            if (requiredApproval) {
              if (isHardwareWallet && !isLedgerWallet) {
                throw new Error('ERC-20 approval Swap routes are not yet supported with Keystone')
              }
              const approvalReview = await measure('evm-prepare-approval', () =>
                evmWalletClient.prepareContractCall(
                  {
                    chainId: walletOwnedSource.chain.chain.id,
                    contractAddress: requiredApproval.transaction.to,
                    valueRaw: requiredApproval.transaction.value,
                    calldata: requiredApproval.transaction.data
                  },
                  {
                    feeTier: feeTierOverride ?? networkFeeTier,
                    executionMode: executionSourceMode,
                    debugRequestId: requestId
                  }
                )
              )
              pendingEvmAfterApproval = {
                approval: Object.freeze({
                  spender: requiredApproval.spender,
                  amountRaw: requiredApproval.amountRaw
                })
              }
              prepared = Object.freeze({
                family: 'evm' as const,
                source: walletOwnedSource,
                review: approvalReview
              })
            } else {
              const isNativeTransfer =
                walletOwnedSource.asset.asset.kind === 'native' && plan.transaction.data === '0x'
              const evmReview = isNativeTransfer
                ? await measure('evm-prepare-transfer', () =>
                    evmWalletClient.prepareTransfer(
                      {
                        assetId: walletOwnedSource.asset.asset.id,
                        recipient: plan.transaction.to,
                        amountRaw: plan.transaction.value
                      },
                      {
                        rheaSwapBinding: binding,
                        feeTier: feeTierOverride ?? networkFeeTier,
                        executionMode: executionSourceMode,
                        debugRequestId: requestId
                      }
                    )
                  )
                : await measure('evm-prepare-contract-call', () =>
                    evmWalletClient.prepareContractCall(
                      {
                        chainId: walletOwnedSource.chain.chain.id,
                        contractAddress: plan.transaction.to,
                        valueRaw: plan.transaction.value,
                        calldata: plan.transaction.data
                      },
                      {
                        rheaSwapBinding: binding,
                        feeTier: feeTierOverride ?? networkFeeTier,
                        executionMode: executionSourceMode,
                        debugRequestId: requestId
                      }
                    )
                  )
              prepared = Object.freeze({
                family: 'evm' as const,
                source: walletOwnedSource,
                review: evmReview
              })
            }
          } else if (
            walletOwnedSource.family === 'evm' &&
            review.execution.kind === 'evm-signature'
          ) {
            if (isHardwareWallet && !isLedgerWallet) {
              throw new Error('EVM signature Swap routes are not supported with Keystone')
            }
            const signaturePlan = await measure('rhea-evm-signature-plan', () =>
              rheaSwapClient.getEvmSignaturePlan(result.quoteHandle)
            )
            const requiredApproval = await measure('evm-check-allowance', () =>
              requiredRheaEvmApproval({
                approval: signaturePlan.approval,
                chainId: walletOwnedSource.chain.chain.id,
                owner: walletOwnedSource.refundAddress,
                executionMode: executionSourceMode,
                getTokenAllowance: evmWalletClient.getTokenAllowance
              })
            )
            if (requiredApproval) {
              const approvalReview = await measure('evm-prepare-approval', () =>
                evmWalletClient.prepareContractCall(
                  {
                    chainId: walletOwnedSource.chain.chain.id,
                    contractAddress: requiredApproval.transaction.to,
                    valueRaw: requiredApproval.transaction.value,
                    calldata: requiredApproval.transaction.data
                  },
                  {
                    feeTier: feeTierOverride ?? networkFeeTier,
                    executionMode: executionSourceMode,
                    debugRequestId: requestId
                  }
                )
              )
              pendingEvmAfterApproval = {
                approval: Object.freeze({
                  spender: requiredApproval.spender,
                  amountRaw: requiredApproval.amountRaw
                })
              }
              prepared = Object.freeze({
                family: 'evm' as const,
                source: walletOwnedSource,
                review: approvalReview
              })
            } else {
              const signatureReview = await measure('rhea-prepare-evm-signature', () =>
                rheaSwapClient.prepareEvmSignature(result.quoteHandle, binding, executionSourceMode)
              )
              if (requestSequence !== quoteRequestSequence.current) {
                await rheaSwapClient.cancelEvmSignature(result.quoteHandle).catch(() => {})
                return
              }
              pendingRheaSigningQuote.current = {
                kind: 'evm-signature',
                quoteHandle: result.quoteHandle
              }
              setRheaSigningReview({ kind: 'evm-signature', review: signatureReview })
            }
          } else if (
            walletOwnedSource.family === 'solana' &&
            review.execution.kind === 'solana-transaction'
          ) {
            if (isHardwareWallet && !isLedgerWallet) {
              throw new Error('Solana Swap routes are not supported with Keystone')
            }
            const solanaReview = await measure('rhea-prepare-solana', () =>
              rheaSwapClient.prepareSolanaTransaction(result.quoteHandle, binding)
            )
            if (requestSequence !== quoteRequestSequence.current) {
              await rheaSwapClient.cancelSolanaTransaction(result.quoteHandle).catch(() => {})
              return
            }
            pendingRheaSigningQuote.current = {
              kind: 'solana-transaction',
              quoteHandle: result.quoteHandle
            }
            setRheaSigningReview({ kind: 'solana-transaction', review: solanaReview })
          } else if (
            walletOwnedSource.family === 'near' &&
            review.execution.kind === 'near-transaction-batch'
          ) {
            if (isHardwareWallet && !isLedgerWallet) {
              throw new Error('NEAR Swap routes are not supported with Keystone')
            }
            const nearReview = await measure('rhea-prepare-near', () =>
              rheaSwapClient.prepareNearTransactionBatch(result.quoteHandle, binding)
            )
            if (requestSequence !== quoteRequestSequence.current) {
              await rheaSwapClient.cancelNearTransactionBatch(result.quoteHandle).catch(() => {})
              return
            }
            pendingRheaSigningQuote.current = {
              kind: 'near-transaction-batch',
              quoteHandle: result.quoteHandle
            }
            setRheaSigningReview({ kind: 'near-transaction-batch', review: nearReview })
          } else {
            throw new Error('This RHEA Swap execution is not supported by the source Wallet')
          }
          if (requestSequence !== quoteRequestSequence.current) {
            if (prepared) await quoteDepositTransferClient.reject(prepared).catch(() => {})
            return
          }
          if (prepared) {
            pendingQuoteTransfer.current = prepared
            setPreparedQuoteTransfer(prepared)
            setPendingRheaEvmAfterApproval(pendingEvmAfterApproval)
          }
        }
        setRheaReview(review)
        swap.setDepositAddress(
          review.execution.kind === 'zcash-transfer' ||
            review.execution.kind === 'bitcoin-transfer' ||
            review.execution.kind === 'evm-transaction'
            ? (review.execution.target ?? '')
            : ''
        )

        if (requiresRecipientAddress && swap.recipientAddress) {
          addRecentRecipientAddress(tokenOut.blockchain, swap.recipientAddress)
        }
        sendAnalyticsEvent(ANALYTICS_EVENTS.SWAP_QUOTED, {
          ...swapEventBase(),
          outputAmount: swap.amountOut
        })
        setViewStep('review')
      } catch (error) {
        if (requestSequence === quoteRequestSequence.current) {
          logger.warn(
            `[Timing] ${requestId} failed-stage=${failedStage} category=${error instanceof Error ? error.name : 'UnknownError'}`
          )
          await discardPreparedQuoteTransfer()
          if (isPrivateFunding) {
            setIsPrivateFundingSubmitting(false)
          }
          const message = getRheaSwapErrorMessage(error)
          if (directSubmitRequested) setDirectTransferError(message)
          toast.error(message)
        }
        if (feeTierOverride) throw error
      } finally {
        preparingReview.current = false
        setIsPreparingReview(false)
      }
    },
    [
      quoteResult,
      liveQuoteRequest,
      liveQuoteKey,
      quoteReceivedAt,
      hasInsufficientFunds,
      swap,
      walletOwnedSource,
      portfolio,
      resolvedRecipientAddress,
      requiresRecipientAddress,
      feeTier,
      networkFeeTier,
      executionSourceMode,
      isHardwareWallet,
      isLedgerWallet,
      addRecentRecipientAddress,
      discardPreparedQuoteTransfer,
      swapEventBase,
      isPrivateFunding,
      crossChainSendRequested,
      mainWalletOwnedSource,
      walletDestinationTarget,
      privateFundingRequestId,
      privateFundingMinimumRaw,
      effectiveWalletId,
      effectiveAccountId,
      directSubmitRequested,
      networkFeeTier
    ]
  )

  useEffect(() => {
    if (
      !autoReviewRequested ||
      viewStep !== 'input' ||
      !lockedAssetFlowReady ||
      hasInsufficientFunds
    ) {
      return
    }
    const scope = [
      walletSourcesScope,
      isPrivateFunding ? 'fund' : privateTransferRequested ? 'transfer' : 'swap',
      swap.tokenIn?.assetId,
      swap.tokenOut?.assetId,
      swap.amountIn,
      resolvedRecipientAddress
    ].join(':')
    if (autoReviewStartedScope.current === scope) return

    if (isPrivateFunding || privateTransferRequested) {
      if (
        swap.isQuoting ||
        !quoteResult ||
        !liveQuoteRequest ||
        liveQuoteKey !== liveQuoteRequest.key ||
        !isRheaSwapQuoteFresh(quoteResult)
      ) {
        return
      }
    } else {
      return
    }

    autoReviewStartedScope.current = scope
    void reviewLiveQuote()
  }, [
    autoReviewRequested,
    hasInsufficientFunds,
    isPrivateFunding,
    isPrivateFundingSubmitting,
    liveQuoteKey,
    liveQuoteRequest,
    lockedAssetFlowReady,
    mainWalletOwnedSource,
    privateTransferRequested,
    quoteResult,
    resolvedRecipientAddress,
    reviewLiveQuote,
    swap.amountIn,
    swap.isQuoting,
    swap.tokenIn?.assetId,
    swap.tokenOut?.assetId,
    viewStep,
    walletDestinationTarget,
    walletSourcesScope
  ])

  useEffect(() => {
    if (
      !isSwapQuoteRefreshReady(reviewAfterQuoteRefresh.current, liveQuoteRequest, liveQuoteKey) ||
      swap.isQuoting ||
      !quoteResult ||
      !liveQuoteRequest ||
      liveQuoteKey !== liveQuoteRequest.key ||
      !isRheaSwapQuoteFresh(quoteResult)
    ) {
      return
    }
    reviewAfterQuoteRefresh.current = null
    void reviewLiveQuote()
  }, [
    liveQuoteKey,
    liveQuoteRequest,
    quoteReceivedAt,
    quoteResult,
    reviewLiveQuote,
    swap.isQuoting
  ])

  const navigateToSwapResult = useCallback(
    (
      txHash?: string,
      originChain?: string,
      activityTransactionId?: string,
      signedOrder?: boolean,
      zcashTransaction?: { accountKey: string; transactionId?: string }
    ) => {
      setIsPrivateFundingSubmitting(false)
      setResult(
        {
          type: 'swap',
          depositAddress: swap.depositAddress,
          status: null,
          tokenInSymbol: swap.tokenIn?.symbol || '',
          tokenOutSymbol: swap.tokenOut?.symbol || '',
          amountIn: swap.amountIn,
          amountOut: swap.amountOut,
          destinationAsset: swap.tokenOut?.assetId,
          destinationChain: swap.tokenOut?.blockchain,
          originChain: originChain || getChainFromAssetId(swap.tokenIn?.assetId || ''),
          originTxHash: txHash,
          activityTransactionId,
          ...(zcashTransaction
            ? {
                zcashAccountKey: zcashTransaction.accountKey,
                zcashTransactionId: zcashTransaction.transactionId
              }
            : {}),
          signedOrder,
          sourceExecutionMode: executionSourceMode,
          rheaQuoteHandle: quoteResult?.quoteHandle,
          ...(crossChainSendRequested
            ? { actionName: 'Cross-chain Send' }
            : privateBalanceTransferRequested || directSubmitRequested || isPrivateFunding
              ? { actionName: 'Transfer' }
              : {}),
          ...(privateFundingRequestId
            ? { approvalRequestIdAfterFunding: privateFundingRequestId }
            : {})
        },
        privateFundingRequestId
          ? `/approval?requestId=${encodeURIComponent(privateFundingRequestId)}`
          : '/'
      )
      navigate('/transaction-result')
    },
    [
      swap,
      quoteResult?.quoteHandle,
      navigate,
      setResult,
      directSubmitRequested,
      privateBalanceTransferRequested,
      isPrivateFunding,
      crossChainSendRequested,
      privateFundingRequestId,
      executionSourceMode
    ]
  )

  const refreshExpiredReview = useCallback(async () => {
    setIsPrivateFundingSubmitting(false)
    await discardPreparedQuoteTransfer()
    setViewStep('input')
    setQuoteResult(null)
    setRheaReview(null)
    setLiveQuoteKey(null)
    setQuoteReceivedAt(null)
    swap.setDepositAddress('')
    setQuoteRefreshTick(current => current + 1)
    toast.info('Swap review expired. Getting a new quote.')
  }, [discardPreparedQuoteTransfer, swap.setDepositAddress])

  const handleConfirmSwap = useCallback(async () => {
    const reviewAction = resolveSwapReviewAction({
      isZecSource: swap.isZecSource,
      hasDepositAddress: Boolean(swap.depositAddress),
      hasSigningReview: Boolean(rheaSigningReview),
      hasPreparedTransfer: Boolean(preparedQuoteTransfer)
    })
    if (reviewAction === 'unavailable') {
      await refreshExpiredReview()
      return
    }
    if (hasInsufficientFunds || preparedFeeUnaffordable) return
    const signingExpiresAt =
      rheaSigningReview?.review.expiresAt ??
      (preparedQuoteTransfer?.family === 'evm'
        ? preparedQuoteTransfer.review.review.expiresAt
        : null)
    if (signingExpiresAt !== null && signingExpiresAt <= Date.now()) {
      await refreshExpiredReview()
      return
    }
    if (reviewAction === 'wallet-signing' && rheaSigningReview) {
      const signingReview = rheaSigningReview.review
      const submitBase = swapEventBase()
      sendAnalyticsEvent(ANALYTICS_EVENTS.SWAP_SUBMITTED, {
        ...submitBase,
        hasTransaction: 1,
        extra: { ...submitBase.extra, sourceFamily: rheaSigningReview.kind }
      })
      setIsSending(true)
      try {
        const signedOrder = await (rheaSigningReview.kind === 'evm-signature'
          ? rheaSwapClient.confirmEvmSignature(
              signingReview.quoteHandle,
              signingReview.payloadFingerprint
            )
          : rheaSigningReview.kind === 'solana-transaction'
            ? rheaSwapClient.confirmSolanaTransaction(
                signingReview.quoteHandle,
                signingReview.payloadFingerprint
              )
            : rheaSwapClient.confirmNearTransactionBatch(
                signingReview.quoteHandle,
                signingReview.payloadFingerprint
              ))
        pendingRheaSigningQuote.current = null
        setRheaSigningReview(null)
        sendAnalyticsEvent(ANALYTICS_EVENTS.SWAP_DEPOSIT_SENT, {
          ...submitBase,
          hasTransaction: 1,
          params: { from_token: swap.tokenIn?.symbol, to_token: swap.tokenOut?.symbol }
        })
        navigateToSwapResult(
          undefined,
          getChainFromAssetId(swap.tokenIn?.assetId || ''),
          signedOrder.graph.root.id,
          rheaSigningReview.kind === 'evm-signature'
        )
      } catch (error) {
        if (isPrivateFunding) {
          setIsPrivateFundingSubmitting(false)
        }
        const classified = classifyError(error)
        console.error('[Private Transfer] Signed execution failed', {
          flow: privateTransferRequested ? 'private-transfer' : 'swap',
          executionKind: rheaSigningReview.kind,
          quoteHandle: signingReview.quoteHandle,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: classified.technicalMessage
        })
        const message = getRheaSwapErrorMessage(error)
        if (directSubmitRequested) setDirectTransferError(message)
        toast.error(message)
      } finally {
        setIsSending(false)
      }
      return
    }
    if (!quoteResult || !isRheaSwapQuoteFresh(quoteResult)) {
      await refreshExpiredReview()
      return
    }
    if (reviewAction === 'zcash-transfer') {
      const quoteBinding =
        quoteResult && rheaReview
          ? {
              provider: 'rhea-cross-chain-dex' as const,
              quoteHandle: quoteResult.quoteHandle,
              executionId: rheaReview.executionId,
              router: rheaReview.router,
              isCrossChain: rheaReview.isCrossChain,
              destinationChain: swap.tokenOut?.blockchain,
              depositAddress: swap.depositAddress,
              originAsset: swap.tokenIn?.assetId,
              destinationAsset: swap.tokenOut?.assetId,
              expectedAmountOut: quoteResult.estimatedOut,
              minAmountOut: quoteResult.minAmountOut,
              recipient: resolvedRecipientAddress || undefined,
              deadline: quoteResult.expiresAt ?? undefined
            }
          : undefined

      const marginalFeeZats = marginalFeeForTier(feeTier)

      try {
        await zcashWalletRuntimeClient.estimateTransferFee({
          to: swap.depositAddress,
          amount: swap.amountIn,
          marginalFeeZats
        })
      } catch (error) {
        if (isPrivateFunding) {
          setIsPrivateFundingSubmitting(false)
        }
        const message = classifyError(error).userMessage
        swap.setQuoteError(message)
        setViewStep('input')
        toast.error(message)
        return
      }

      const submitBase = swapEventBase()
      sendAnalyticsEvent(ANALYTICS_EVENTS.SWAP_SUBMITTED, {
        ...submitBase,
        hasTransaction: 1,
        extra: { ...submitBase.extra, hardware: isHardwareWallet }
      })

      // Hardware wallets sign the deposit transfer via QR in a dedicated tab
      if (isHardwareWallet) {
        const { currentWalletId } = useWalletStore.getState()
        if (!currentWalletId || !currentAccount) return
        const request = {
          kind: 'swap' as const,
          walletId: currentWalletId,
          accountId: currentAccount.id,
          to: swap.depositAddress,
          amount: swap.amountIn,
          displayTo: resolvedRecipientAddress || undefined,
          quoteBinding,
          marginalFeeZats
        }
        if (!isSidePanelSurface(window.location.search)) {
          await openHardwareSignTab(request)
          window.close()
          return
        }

        setIsSending(true)
        try {
          const result = await openHardwareSignAndWait(request, { presentation: 'window' })
          if (result.status === 'success') {
            navigateToSwapResult(result.txHash, 'zcash', result.transactionId, false, {
              accountKey: result.accountKey,
              transactionId: result.transactionId
            })
          } else if (result.status === 'timeout') {
            toast.error('Hardware signing timed out', 'The swap review has been restored.')
          } else {
            toast.info('Hardware signing cancelled')
          }
        } catch (cause) {
          toast.error('Could not open hardware signing', classifyError(cause).userMessage)
        } finally {
          setIsSending(false)
        }
        return
      }

      navigateToSwapResult(undefined, 'zcash')
      setIsSending(true)

      let result: Awaited<ReturnType<typeof sendTransaction>>
      try {
        const fromAddress = currentAccount?.addresses.shielded || ''
        const sentBase = swapEventBase()
        const failedBase = swapEventBase()
        result = await sendTransaction({
          to: swap.depositAddress,
          amount: swap.amountIn,
          from: fromAddress,
          fromType: 'shielded',
          txType: 'swap',
          displayTo: resolvedRecipientAddress || undefined,
          quoteBinding,
          marginalFeeZats,
          analytics: {
            onSuccess: {
              name: ANALYTICS_EVENTS.SWAP_DEPOSIT_SENT,
              options: {
                ...sentBase,
                hasTransaction: 1,
                params: { from_token: swap.tokenIn?.symbol, to_token: swap.tokenOut?.symbol }
              }
            },
            onFail: {
              name: ANALYTICS_EVENTS.SWAP_FAILED,
              options: failedBase
            }
          }
        })
      } catch (cause) {
        result = { step: 'failed', error: classifyError(cause).userMessage }
      } finally {
        setIsSending(false)
      }

      if (result.step === 'success') {
        if (result.txHash && result.transactionId && result.accountKey) {
          updateSwapOriginTransaction('zcash', result.txHash, {
            accountKey: result.accountKey,
            transactionId: result.transactionId
          })
        }
        if (
          result.txHash &&
          result.transactionId &&
          result.accountKey &&
          quoteResult &&
          rheaReview &&
          effectiveWalletId &&
          effectiveAccountId
        ) {
          try {
            await rheaSwapClient.recordTransactionSubmission(quoteResult.quoteHandle, result.txHash)
            await rheaSwapClient.startMonitoring({
              quoteHandle: quoteResult.quoteHandle,
              accountKey: result.accountKey,
              walletId: effectiveWalletId,
              accountId: effectiveAccountId,
              transactionId: result.transactionId,
              isCrossChain: rheaReview.isCrossChain,
              destinationAsset: swap.tokenOut?.assetId,
              destinationChain: swap.tokenOut?.blockchain
            })
            await rheaSwapClient.reportSubmission(quoteResult.quoteHandle)
          } catch {
            toast.error('Swap was broadcast, but RHEA status reporting will retry later')
          }
        }
      } else if (result.step === 'pending') {
        const currentResult = useTransactionResultStore.getState().data
        if (
          currentResult?.type === 'swap' &&
          currentResult.depositAddress === swap.depositAddress
        ) {
          setResult(
            {
              type: 'zcash',
              step: 'pending',
              amount: swap.amountIn,
              error: result.error,
              accountKey: result.accountKey,
              transactionId: result.transactionId,
              timestamp: result.timestamp
            },
            '/'
          )
        }
      } else {
        setResult(
          {
            type: 'zcash',
            step: 'failed',
            amount: swap.amountIn,
            customTitle: 'Swap Failed',
            customDescription: result.error || 'Failed to send ZEC to deposit address.',
            error: result.error
          },
          '/'
        )
      }
    } else if (reviewAction === 'wallet-transfer' && preparedQuoteTransfer) {
      const submitBase = swapEventBase()
      sendAnalyticsEvent(ANALYTICS_EVENTS.SWAP_SUBMITTED, {
        ...submitBase,
        hasTransaction: 1,
        extra: { ...submitBase.extra, sourceFamily: preparedQuoteTransfer.family }
      })
      setIsSending(true)
      try {
        const submission = await quoteDepositTransferClient.approve(preparedQuoteTransfer)
        pendingQuoteTransfer.current = null
        setPreparedQuoteTransfer(null)
        if (submission.value.status === 'external-signature-required') {
          try {
            await (submission.family === 'bitcoin'
              ? openHardwareBitcoinSignTab(submission.value.transactionId)
              : openHardwareEvmSignTab(submission.value.transactionId))
          } catch (handoffError) {
            await quoteDepositTransferClient.reject(preparedQuoteTransfer)
            throw handoffError
          }
          window.close()
          return
        }
        if (pendingRheaEvmAfterApproval) {
          if (submission.value.status !== 'broadcast') {
            setIsPrivateFundingSubmitting(false)
            setPendingRheaEvmAfterApproval(null)
            setViewStep('input')
            setQuoteResult(null)
            setRheaReview(null)
            setLiveQuoteKey(null)
            swap.setQuoteError(
              'Token approval is signed but still waiting to broadcast. Resume it from Activity before requesting a new quote.'
            )
            toast.error('Token approval is signed but still waiting to broadcast')
            return
          }
          if (quoteResult) void rheaSwapClient.discard(quoteResult.quoteHandle).catch(() => {})
          setPendingRheaEvmAfterApproval(null)
          setQuoteResult(null)
          setRheaReview(null)
          setLiveQuoteKey(null)
          setQuoteReceivedAt(null)
          setViewStep('approval-pending')
          return
        }
        const origin = submission.value.graph.segments.find(segment => segment.role === 'origin')
        sendAnalyticsEvent(ANALYTICS_EVENTS.SWAP_DEPOSIT_SENT, {
          ...submitBase,
          hasTransaction: 1,
          params: { from_token: swap.tokenIn?.symbol, to_token: swap.tokenOut?.symbol }
        })
        navigateToSwapResult(
          origin?.evidence?.transactionHash,
          getChainFromAssetId(swap.tokenIn?.assetId || ''),
          submission.value.graph.root.id
        )
      } catch (error) {
        if (isPrivateFunding) {
          setIsPrivateFundingSubmitting(false)
        }
        if (
          preparedQuoteTransfer.family === 'evm' &&
          error instanceof EvmWalletClientError &&
          error.code === 'expired'
        ) {
          await refreshExpiredReview()
          return
        }
        const classified = classifyError(error)
        console.error('[Private Transfer] Transaction execution failed', {
          flow: privateTransferRequested ? 'private-transfer' : 'swap',
          quoteHandle: quoteResult.quoteHandle,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: classified.technicalMessage
        })
        const message = getRheaSwapErrorMessage(error)
        if (directSubmitRequested) setDirectTransferError(message)
        toast.error(message)
      } finally {
        setIsSending(false)
      }
    }
  }, [
    swap.depositAddress,
    swap.isZecSource,
    swap.amountIn,
    swap.addressType,
    swap.tokenIn,
    swap.tokenOut,
    currentAccount,
    isHardwareWallet,
    feeTier,
    navigateToSwapResult,
    setResult,
    sendTransaction,
    swapEventBase,
    preparedQuoteTransfer,
    preparedFeeUnaffordable,
    hasInsufficientFunds,
    quoteResult,
    rheaReview,
    effectiveWalletId,
    effectiveAccountId,
    updateSwapOriginTransaction,
    resolvedRecipientAddress,
    discardPreparedQuoteTransfer,
    refreshExpiredReview,
    pendingRheaEvmAfterApproval,
    networkFeeTier,
    rheaSigningReview,
    executionSourceMode,
    isPrivateFunding,
    privateFundingRequestId,
    directSubmitRequested,
    navigate
  ])

  useEffect(() => {
    if (!directSubmitRequested || viewStep !== 'review' || isSending || directTransferError) return
    const submitScope = rheaSigningReview
      ? `signing:${rheaSigningReview.kind}:${rheaSigningReview.review.quoteHandle}`
      : preparedQuoteTransfer
        ? `transfer:${preparedQuoteTransfer.family}:${preparedQuoteTransfer.review.graph.root.id}`
        : null
    if (!submitScope || directSubmitStartedScope.current === submitScope) return
    directSubmitStartedScope.current = submitScope
    void handleConfirmSwap()
  }, [
    directSubmitRequested,
    directTransferError,
    handleConfirmSwap,
    isSending,
    preparedQuoteTransfer,
    rheaSigningReview,
    viewStep
  ])

  const handleSelectToken = useCallback(
    async (type: 'in' | 'out') => {
      if (crossChainSendRequested && type === 'in') return
      if (
        (type === 'in' && swap.sourceTokens.length === 0) ||
        (type === 'out' && swap.destinationTokens.length === 0 && !crossChainSendRequested)
      ) {
        return
      }
      await openModal({
        title: crossChainSendRequested ? 'SELECT NETWORK' : 'SELECT ASSET',
        showCloseButton: true,
        body: (_resolve, close) => (
          <SwapTokenSelector
            initialTokens={
              type === 'in'
                ? swap.sourceTokens
                : crossChainSendRequested
                  ? filterCrossChainSendDestinations(
                      swap.tokenIn,
                      swap.destinationTokens,
                      CROSS_CHAIN_SEND_CAPABILITIES
                    )
                  : swap.destinationTokens
            }
            loadTokens={(onTokens, isCancelled) =>
              swap
                .loadSelectorTokens(
                  type === 'in' ? 'from' : 'cross-chain-to',
                  tokens =>
                    onTokens(
                      crossChainSendRequested && type === 'out'
                        ? filterCrossChainSendDestinations(
                            swap.tokenIn,
                            tokens,
                            CROSS_CHAIN_SEND_CAPABILITIES
                          )
                        : tokens
                    ),
                  isCancelled
                )
                .then(tokens =>
                  crossChainSendRequested && type === 'out'
                    ? filterCrossChainSendDestinations(
                        swap.tokenIn,
                        tokens,
                        CROSS_CHAIN_SEND_CAPABILITIES
                      )
                    : tokens
                )
            }
            balanceScope={
              effectiveWalletId && effectiveAccountId
                ? {
                    walletId: effectiveWalletId,
                    accountId: effectiveAccountId,
                    initialPortfolio: portfolio,
                    receiveTargets,
                    zcashAvailable: storeBalance?.available || '0',
                    evmExecutionMode: isPrivateFunding ? 'main' : executionSourceMode
                  }
                : undefined
            }
            excludeAssetId={type === 'in' ? swap.tokenOut?.assetId : swap.tokenIn?.assetId}
            emptyMessage={
              type === 'in'
                ? 'No source assets are available'
                : 'No destination assets are available'
            }
            selectedToken={(type === 'in' ? swap.tokenIn : swap.tokenOut) || undefined}
            onSelect={token => {
              if (
                type === 'out' &&
                crossChainSendRequested &&
                !isCrossChainSendDestination(swap.tokenIn, token, CROSS_CHAIN_SEND_CAPABILITIES)
              )
                return
              close()
              setMaxSelected(false)
              if (type === 'in') {
                swap.selectTokenIn(token)
              } else if (
                !crossChainSendRequested ||
                isCrossChainSendDestination(swap.tokenIn, token, CROSS_CHAIN_SEND_CAPABILITIES)
              ) {
                swap.selectTokenOut(token)
              }
            }}
          />
        )
      })
    },
    [
      swap,
      effectiveWalletId,
      effectiveAccountId,
      portfolio,
      receiveTargets,
      storeBalance?.available,
      isPrivateFunding,
      executionSourceMode,
      crossChainSendRequested
    ]
  )

  const handleSelectZecAddress = useCallback(async () => {
    await openModal({
      title: 'Select Address',
      showCloseButton: true,
      body: (_resolve, close) => (
        <AddressSelectorModal
          selectedType={swap.addressType}
          onSelect={type => {
            swap.setAddressType(type)
            close()
          }}
          showCopy={false}
        />
      )
    })
  }, [swap])

  const handleOpenSlippageSetting = useCallback(async () => {
    await openModal({
      title: 'Slippage Tolerance',
      showCloseButton: true,
      body: (_resolve, close) => (
        <SlippageSettingContent
          currentSlippage={swap.slippage}
          onSave={newSlippage => {
            swap.setSlippage(newSlippage)
            close()
          }}
        />
      )
    })
  }, [swap])

  const handleReturnToInput = useCallback(() => {
    quoteRequestSequence.current += 1
    setIsPrivateFundingSubmitting(false)
    void discardPreparedQuoteTransfer()
    if (privateBalanceTransferRequested) {
      goBack()
      return
    }
    setViewStep('input')
  }, [discardPreparedQuoteTransfer, goBack, privateBalanceTransferRequested])

  const handleSourceModeChange = (mode: QuoteDepositExecutionMode) => {
    if (mode === sourceMode || (mode === 'private' && !privateWalletOwnedSource)) return
    quoteRequestSequence.current += 1
    void discardPreparedQuoteTransfer()
    setQuoteResult(null)
    setLiveQuoteKey(null)
    setQuoteReceivedAt(null)
    setSourceMode(mode)
    setMaxSelected(false)
    maxQuoteAdjustmentCount.current = 0
    swap.updateAmountIn('')
  }

  const sourceAccountAction =
    viewStep === 'input' &&
    !isPrivateFunding &&
    !privateTransferRequested &&
    walletOwnedSourceBase?.family === 'evm' ? (
      <AccountAddressSelectorButton
        mode={sourceMode}
        address={walletOwnedSource?.refundAddress}
        ariaLabel={`Choose source account, current ${sourceMode}`}
        disabled={walletActionMode.loading}
        onClick={() => setSourceSelectorOpen(true)}
      />
    ) : undefined

  const destinationAccountAction =
    viewStep === 'input' &&
    !isPrivateFunding &&
    !privateTransferRequested &&
    walletDestinationTarget ? (
      <AccountAddressSelectorButton
        mode={requiresRecipientAddress ? 'custom' : destinationMode}
        address={resolvedRecipientAddress || undefined}
        ariaLabel={`Choose destination account, current ${requiresRecipientAddress ? 'custom' : destinationMode}`}
        disabled={destinationWalletActionMode.loading}
        onClick={() => setDestinationSelectorOpen(true)}
      />
    ) : undefined

  const getHeaderProps = () => {
    switch (viewStep) {
      case 'review':
        return { showBack: true, onBack: handleReturnToInput }
      default:
        return {
          showBack: true,
          ...(crossChainSendRequested ? { onBack: returnFromCrossChainSend } : {})
        }
    }
  }

  // Render content based on view step
  const renderContent = () => {
    if (viewStep === 'approval-pending') {
      return (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-12 text-center"
          role="status"
        >
          <h2 className="text-base font-semibold">Token approval submitted</h2>
          <p className="mt-2 max-w-72 text-sm leading-5 text-muted">
            Wait for the approval to confirm in Activity, then start a new Swap with a fresh quote.
          </p>
          <Button className="mt-5 min-w-32" onClick={() => navigate('/?tab=activity')}>
            View Activity
          </Button>
        </div>
      )
    }
    const reviewedQuote = quoteResult
    if (viewStep === 'review' && reviewedQuote && rheaReview && swap.tokenIn && swap.tokenOut) {
      const minAmountOut = reviewedQuote.minAmountOut
      const priceImpact =
        swap.tokenIn.price && swap.tokenOut.price
          ? Math.max(
              0,
              (1 -
                safeBig(swap.amountOut || 0).toNumber() /
                  safeBig(swap.amountIn || 1).toNumber() /
                  (swap.tokenIn.price / swap.tokenOut.price)) *
                100
            )
          : 0

      if (privateBalanceTransferRequested && walletOwnedSource) {
        const sourceNetworkFee = getPreparedSwapNetworkFee(preparedQuoteTransfer)
        const sourceMode = isPrivateFunding ? 'main' : 'private'
        const destinationMode = isPrivateFunding ? 'private' : 'main'
        const reviewRows = [
          ...(swap.depositAddress
            ? [
                {
                  label: 'Send To',
                  content: (
                    <span className="font-mono text-muted" title={swap.depositAddress}>
                      {formatSortAddress(swap.depositAddress)}
                    </span>
                  )
                }
              ]
            : []),
          { label: 'Network', content: walletOwnedSource.chain.chain.displayName },
          {
            label: 'From',
            content: (
              <span className="inline-flex min-w-0 max-w-full items-center justify-end gap-1.5">
                <span
                  className="truncate font-mono text-muted"
                  title={walletOwnedSource.refundAddress}
                >
                  {formatSortAddress(walletOwnedSource.refundAddress)}
                </span>
                <ExecutionAccountBadge mode={sourceMode} />
              </span>
            )
          },
          {
            label: 'Receive in',
            content: <ExecutionAccountBadge mode={destinationMode} />
          },
          {
            label: 'You receive',
            content: `${formatNumber(swap.amountOut, { rm: Big.roundDown, useUnit: true, useSubscript: true })} ${formatSymbol(swap.tokenOut.symbol)}`
          },
          ...(getConfidentialTransferEstimate(walletOwnedSource.chain.chain.id)
            ? [
                {
                  label: 'Estimated time',
                  content: getConfidentialTransferEstimate(walletOwnedSource.chain.chain.id)
                }
              ]
            : []),
          ...(sourceNetworkFee
            ? [
                {
                  label: 'Network fee',
                  content:
                    (walletOwnedSource.family === 'evm' ||
                      walletOwnedSource.family === 'bitcoin') &&
                    preparedQuoteTransfer ? (
                      <NetworkFeeTierPicker
                        chainFamily={walletOwnedSource.family}
                        tier={networkFeeTier}
                        amount={sourceNetworkFee.amount}
                        symbol={sourceNetworkFee.symbol}
                        onTierChange={async nextTier => {
                          await reviewLiveQuote(nextTier)
                          setNetworkFeeTier(nextTier)
                        }}
                        disabled={isSending}
                      />
                    ) : (
                      <span className="whitespace-nowrap font-mono">
                        {formatNumber(sourceNetworkFee.amount, {
                          rm: Big.roundDown,
                          useUnit: true,
                          useSubscript: true
                        })}{' '}
                        {sourceNetworkFee.symbol}
                      </span>
                    )
                }
              ]
            : []),
          ...(pendingRheaEvmAfterApproval
            ? [
                {
                  label: 'Approval',
                  content: `${formatNumber(
                    formatBaseUnitAmount(
                      pendingRheaEvmAfterApproval.approval.amountRaw,
                      swap.tokenIn.decimals
                    ),
                    { useUnit: true }
                  )} ${formatSymbol(swap.tokenIn.symbol)}`
                }
              ]
            : [])
        ]

        return (
          <TransactionReviewView
            title="Review Transfer"
            showTitle={false}
            asset={{
              assetId: swap.tokenIn.assetId,
              symbol: formatSymbol(swap.tokenIn.symbol),
              icon: swap.tokenIn.icon ?? swap.tokenIn.coingeckoIcon ?? undefined,
              blockchain: swap.tokenIn.blockchain
            }}
            amount={formatNumber(swap.amountIn, { useUnit: true })}
            network={walletOwnedSource.chain.chain.displayName}
            rows={reviewRows}
            error={
              hasInsufficientFunds || preparedFeeUnaffordable ? (
                <p className="mt-3 px-1 text-xs text-warning">
                  Amount exceeds balance at this fee. Go back to lower the amount or switch fee
                  tier.
                </p>
              ) : undefined
            }
            confirmLabel={
              pendingRheaEvmAfterApproval ? `Approve ${swap.tokenIn.symbol}` : 'Confirm'
            }
            confirming={isSending}
            confirmDisabled={hasInsufficientFunds || preparedFeeUnaffordable}
            onCancel={handleReturnToInput}
            onConfirm={handleConfirmSwap}
          />
        )
      }

      return (
        <SwapReviewView
          destinationDetails={
            (crossChainSendRequested || privateTransferRequested) && swap.tokenOut
              ? {
                  network: formatChainName(swap.tokenOut.blockchain),
                  recipient: resolvedRecipientAddress
                }
              : undefined
          }
          arrivalEstimate={
            (isPrivateFunding || privateTransferRequested) && walletOwnedSource
              ? (getConfidentialTransferEstimate(walletOwnedSource.chain.chain.id) ?? undefined)
              : undefined
          }
          tokenIn={swap.tokenIn}
          tokenOut={swap.tokenOut}
          amountIn={swap.amountIn}
          amountOut={swap.amountOut}
          minAmountOut={minAmountOut}
          priceImpact={priceImpact}
          fromFiat={swap.fromFiat}
          toFiat={swap.toFiat}
          slippage={swap.slippage}
          onConfirm={handleConfirmSwap}
          isLoading={isSending}
          confirmLabel={
            crossChainSendRequested
              ? 'Confirm Send'
              : privateBalanceTransferRequested
                ? 'Confirm transfer'
                : isPrivateFunding || privateTransferRequested
                  ? 'Confirm'
                  : undefined
          }
          feeTier={swap.isZecSource ? feeTier : undefined}
          onFeeTierChange={swap.isZecSource ? setFeeTier : undefined}
          feeByTier={swap.isZecSource ? displayedFeeByTier : undefined}
          feeLoading={swap.isZecSource ? displayedFeeLoading : undefined}
          selectedFeeZec={swap.isZecSource ? networkFee : undefined}
          sourceNetworkFee={getPreparedSwapNetworkFee(preparedQuoteTransfer)}
          sourceFeeTier={
            walletOwnedSource?.family === 'evm' || walletOwnedSource?.family === 'bitcoin'
              ? networkFeeTier
              : undefined
          }
          sourceFeeFamily={
            walletOwnedSource?.family === 'evm' || walletOwnedSource?.family === 'bitcoin'
              ? walletOwnedSource.family
              : undefined
          }
          onSourceFeeTierChange={
            walletOwnedSource?.family === 'evm' || walletOwnedSource?.family === 'bitcoin'
              ? async nextTier => {
                  await reviewLiveQuote(nextTier)
                  setNetworkFeeTier(nextTier)
                }
              : undefined
          }
          sourceTransferDetails={
            walletOwnedSource
              ? {
                  network: walletOwnedSource.chain.chain.displayName,
                  chainIcon: resolveChainIconAlias(
                    walletOwnedSource.chain.chain.family,
                    walletOwnedSource.chain.chain.displayName
                  ),
                  sender: walletOwnedSource.refundAddress,
                  depositAddress: swap.depositAddress || null
                }
              : undefined
          }
          approvalDetails={
            pendingRheaEvmAfterApproval
              ? {
                  spender: pendingRheaEvmAfterApproval.approval.spender,
                  amount: formatBaseUnitAmount(
                    pendingRheaEvmAfterApproval.approval.amountRaw,
                    swap.tokenIn.decimals
                  ),
                  symbol: swap.tokenIn.symbol
                }
              : undefined
          }
          hasSigningReview={Boolean(rheaSigningReview)}
          signingActionLabel={
            privateBalanceTransferRequested
              ? 'Confirm transfer'
              : rheaSigningReview?.kind === 'solana-transaction' ||
                  rheaSigningReview?.kind === 'near-transaction-batch'
                ? 'Sign & Submit Swap'
                : 'Sign Swap Order'
          }
          insufficient={hasInsufficientFunds || preparedFeeUnaffordable}
        />
      )
    }

    const recentRecipient = swap.tokenOut
      ? getRecentRecipientAddresses(swap.tokenOut.blockchain)
      : []
    const hasWalletSource = swap.isZecSource
      ? Boolean(currentAccount?.addresses.shielded && currentAccount.addresses.transparent)
      : Boolean(walletOwnedSource)
    const canGetQuote =
      hasWalletSource &&
      liveQuoteRequest !== null &&
      liveQuoteKey === liveQuoteRequest.key &&
      quoteResult !== null &&
      !swap.isQuoting
    const quoteFeeUsd = null

    return (
      <SwapInputView
        tokenIn={swap.tokenIn}
        tokenOut={swap.tokenOut}
        isZecSource={swap.isZecSource}
        isZecDestination={isZecDestination}
        requiresRecipientAddress={requiresRecipientAddress}
        canUseWalletDestination={Boolean(walletDestinationTarget)}
        canSwitchTokens={canSwitchTokens}
        amountIn={swap.amountIn}
        estimatedOut={swap.displayOut}
        isEstimatedOut={swap.isEstimatedOut}
        fromFiat={swap.fromFiat}
        toFiat={swap.toFiat}
        rate={swap.rate}
        addressType={swap.addressType}
        destinationAddress={resolvedRecipientAddress}
        spendableBalance={spendableBalance}
        recipientAddress={swap.recipientAddress}
        slippage={swap.slippage}
        networkFee={networkFee}
        quoteFeeUsd={quoteFeeUsd}
        isQuoting={swap.isQuoting}
        quoteError={
          crossChainSendRequested &&
          swap.tokenOut &&
          resolvedRecipientAddress &&
          !crossChainSendRecipientReady
            ? 'Enter a valid address on the destination network.'
            : isPrivateFunding && !swap.destinationTokensLoading && !privateFundingDestinationToken
              ? 'This asset is not available for Confidential funding.'
              : isPrivateFunding &&
                  quoteResult &&
                  privateFundingMinimumRaw &&
                  /^\d+$/.test(privateFundingMinimumRaw) &&
                  BigInt(quoteResult.minAmountOut) < BigInt(privateFundingMinimumRaw)
                ? `Increase the amount to receive enough ${swap.tokenOut?.symbol ?? 'Gas'}`
                : swap.quoteError
        }
        maxLoading={routeMaximum.loading || maxTransfer.loading}
        catalogError={swap.catalogError}
        sourceAssetsLoading={swap.sourceTokens.length === 0}
        destinationAssetsLoading={
          crossChainSendRequested
            ? swap.destinationTokensLoading && swap.destinationTokens.length === 0
            : swap.destinationTokens.length === 0
        }
        canGetQuote={
          canGetQuote &&
          !(
            isPrivateFunding &&
            quoteResult &&
            privateFundingMinimumRaw &&
            /^\d+$/.test(privateFundingMinimumRaw) &&
            BigInt(quoteResult.minAmountOut) < BigInt(privateFundingMinimumRaw)
          )
        }
        hasInsufficientFunds={hasInsufficientFunds}
        insufficientMessage={
          !swap.isZecSource && swap.tokenIn
            ? `Insufficient ${swap.tokenIn.symbol} balance`
            : undefined
        }
        walletManagedRefundAddress={resolvedRefundAddress || undefined}
        recentRecipientAddresses={recentRecipient}
        feeIsApproximate={feeIsApproximate}
        sourceAddress={
          isPrivateFunding
            ? swap.isZecSource
              ? currentAccount?.addresses.shielded
              : resolvedRefundAddress
            : !swap.isZecSource
              ? walletOwnedSource?.refundAddress
              : undefined
        }
        sourceBadge={
          isPrivateFunding
            ? 'Public'
            : !swap.isZecSource
              ? executionSourceMode === 'private'
                ? 'Confidential'
                : 'Public'
              : undefined
        }
        onAmountInChange={value => {
          reviewAfterQuoteRefresh.current = null
          setMaxSelected(false)
          maxQuoteAdjustmentCount.current = 0
          swap.updateAmountIn(value)
        }}
        onMaxClick={
          swap.isZecSource
            ? () => {
                reviewAfterQuoteRefresh.current = null
                setMaxSelected(true)
                maxQuoteAdjustmentCount.current = 0
                swap.updateAmountIn(spendableBalance)
                void maxTransfer.request()
              }
            : walletOwnedSource
              ? () => {
                  reviewAfterQuoteRefresh.current = null
                  setMaxSelected(true)
                  maxQuoteAdjustmentCount.current = 0
                  if (walletOwnedSource.asset.asset.kind !== 'native') {
                    swap.updateAmountIn(walletSpendableBalance)
                  }
                }
              : undefined
        }
        onRecipientAddressChange={swap.setRecipientAddress}
        onUseCustomRecipientChange={value => {
          if (!privateTransferRequested) setUseCustomRecipient(value)
        }}
        onSelectToken={type => {
          if (
            privateTransferRequested ||
            (type === 'out' && isPrivateFunding) ||
            (type === 'in' && crossChainSendRequested)
          )
            return
          void handleSelectToken(type)
        }}
        onSelectZecAddress={handleSelectZecAddress}
        onSwitchTokens={() => {
          if (!canSwitchTokens) return
          reviewAfterQuoteRefresh.current = null
          setMaxSelected(false)
          swap.switchTokens()
        }}
        onRetryTokenCatalog={swap.retryTokenCatalog}
        onRetryQuote={
          swap.quoteError && quoteRetryable && liveQuoteRequest
            ? () => {
                reviewAfterQuoteRefresh.current = null
                swap.setQuoteError(null)
                swap.setIsQuoting(true)
                setQuoteRefreshTick(current => current + 1)
              }
            : undefined
        }
        onOpenSlippageSetting={handleOpenSlippageSetting}
        onGetQuote={() => {
          void reviewLiveQuote()
        }}
        sourceAccountAction={sourceAccountAction}
        destinationAccountAction={destinationAccountAction}
        destinationBadge={
          isPrivateFunding
            ? 'Confidential'
            : !requiresRecipientAddress && walletDestinationTarget?.kind === 'evm'
              ? destinationMode === 'private'
                ? 'Confidential'
                : 'Public'
              : undefined
        }
        destinationAssetLocked={isPrivateFunding || privateTransferRequested}
        sourceAssetLocked={privateTransferRequested || crossChainSendRequested}
        hideSwitchAssets={isPrivateFunding || privateTransferRequested || crossChainSendRequested}
        hideReceiveAddress={isPrivateFunding}
        actionLabel={
          isPrivateFunding
            ? privateFundingRequestId
              ? 'Add Gas'
              : 'Transfer to Confidential'
            : privateTransferRequested
              ? 'Send Privately'
              : crossChainSendRequested
                ? 'Review Send'
                : 'Swap'
        }
        actionLoading={isPrivateFundingSubmitting || isPreparingReview}
      />
    )
  }

  const directTransferStatusError =
    directTransferError ??
    (lockedAssetFlowRequested &&
    !swap.areTokensLoading &&
    !swap.destinationTokensLoading &&
    !walletSourcesLoading &&
    !lockedAssetFlowReady
      ? 'The selected asset is not available for Confidential transfers.'
      : null) ??
    (hasInsufficientFunds && swap.tokenIn && !walletSourcesLoading && lockedAssetFlowReady
      ? `Insufficient ${swap.tokenIn.symbol} balance`
      : null) ??
    (isPrivateFunding && !swap.destinationTokensLoading && !privateFundingDestinationToken
      ? 'This asset is not available for Confidential transfers.'
      : swap.quoteError)
  const preparingSimplifiedTransfer = lockedAssetFlowRequested && viewStep === 'input'
  const crossChainSendUnavailable = crossChainSendRequested
    ? currentNetwork !== 'mainnet'
      ? 'Cross-chain Send is available in Mainnet Mode.'
      : !requestedSourceAssetId
        ? 'Select an asset in Send first.'
        : !swap.areTokensLoading && !walletSourcesLoading && !crossChainSendSourceReady
          ? swap.catalogError
            ? 'Could not load cross-chain assets.'
            : 'This asset is not available for cross-chain Send.'
          : null
    : null

  return (
    <div className="page-container">
      <PageHeader
        title={
          viewStep === 'approval-pending'
            ? 'Token approval'
            : lockedAssetFlowRequested
              ? 'Transfer'
              : crossChainSendRequested
                ? viewStep === 'review'
                  ? 'Review Send'
                  : 'Send'
                : viewStep === 'review'
                  ? 'Review Swap'
                  : 'Swap'
        }
        {...(directSubmitRequested || viewStep === 'approval-pending' ? {} : getHeaderProps())}
        rightContent={
          crossChainSendRequested && viewStep === 'input' && requestedSourceAssetId ? (
            <SendRouteMenu
              route="cross-chain"
              onChange={route => {
                if (route === 'onchain') {
                  returnFromCrossChainSend()
                }
              }}
            />
          ) : undefined
        }
      />
      {crossChainSendUnavailable ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
          <Icon icon="lucide:circle-alert" width={24} height={24} className="text-warning" />
          <p className="mt-4 text-sm text-muted" role="alert">
            {crossChainSendUnavailable}
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={swap.catalogError ? swap.retryTokenCatalog : () => navigate('/send')}
          >
            {swap.catalogError ? 'Retry' : 'Back to Send'}
          </Button>
        </div>
      ) : viewStep === 'approval-pending' ? (
        renderContent()
      ) : directSubmitRequested || preparingSimplifiedTransfer ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 pb-16 text-center"
          role={directTransferStatusError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span
            className={
              directTransferStatusError
                ? 'flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning'
                : 'flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'
            }
          >
            <Icon
              icon={directTransferStatusError ? 'lucide:circle-alert' : 'lucide:loader-circle'}
              width={24}
              height={24}
              className={directTransferStatusError ? undefined : 'animate-spin'}
            />
          </span>
          <h2 className="mt-4 text-base font-semibold">
            {directTransferStatusError
              ? 'Transfer failed'
              : preparingSimplifiedTransfer && !directSubmitRequested
                ? 'Preparing transfer'
                : 'Confirming transfer'}
          </h2>
          <p className="mt-2 max-w-72 text-sm leading-5 text-muted">
            {directTransferStatusError ??
              (preparingSimplifiedTransfer && !directSubmitRequested
                ? 'Preparing transfer details for review.'
                : 'Preparing and submitting the confidential transfer. Keep the wallet open.')}
          </p>
          {directTransferStatusError && (
            <Button variant="outline" className="mt-5 min-w-28" onClick={goBack}>
              Back
            </Button>
          )}
        </div>
      ) : (
        renderContent()
      )}
      {!swap.isZecSource && !isPrivateFunding && !privateTransferRequested && (
        <ExecutionAccountSelectorDialog
          open={sourceSelectorOpen}
          onOpenChange={setSourceSelectorOpen}
          value={sourceMode}
          onSelect={handleSourceModeChange}
          privateAvailable={Boolean(privateWalletOwnedSource)}
          mainAddress={mainWalletOwnedSource?.refundAddress}
          privateAddress={privateWalletOwnedSource?.refundAddress}
          mainBalance={mainWalletSpendableBalance}
          privateBalance={privateWalletSpendableBalance}
          symbol={swap.tokenIn?.symbol}
        />
      )}
      {!isPrivateFunding && !privateTransferRequested && walletDestinationTarget && (
        <ExecutionAccountSelectorDialog
          open={destinationSelectorOpen}
          onOpenChange={setDestinationSelectorOpen}
          purpose="destination"
          value={requiresRecipientAddress ? 'custom' : destinationMode}
          onSelect={mode => {
            quoteRequestSequence.current += 1
            void discardPreparedQuoteTransfer()
            setQuoteResult(null)
            setLiveQuoteKey(null)
            setQuoteReceivedAt(null)
            setDestinationMode(mode)
            setUseCustomRecipient(false)
          }}
          privateAvailable={Boolean(destinationPrivateExecutionAddress)}
          mainAddress={walletDestinationTarget.address}
          privateAddress={destinationPrivateExecutionAddress}
          onCustomAddress={() => setUseCustomRecipient(true)}
        />
      )}
    </div>
  )
}
