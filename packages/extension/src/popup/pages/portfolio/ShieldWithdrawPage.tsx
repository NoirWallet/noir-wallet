import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import type { PortfolioReadModel, PortfolioAssetView } from '@/core/portfolio'
import type { AssetPriceReadModel } from '@/core/prices'
import { Icon } from '@iconify/react'
import nearLogo from '@/images/figma-near-confidential.svg'
import { isAddress } from 'viem'
import { resolveEvmChainIconAlias } from '@/config/icons'
import type { IntentsManagedAsset } from '@/core/services/intents-managed-assets'
import { fetchSwapTokens, getCachedTokens, type SwapToken } from '@/core/services/intents-api'
import type { ConfidentialFundingReview } from '@/core/services/confidential-funding'
import {
  formatBaseUnitAmount,
  formatBaseUnitDecimalAmount,
  formatTokenQuantity
} from '@/lib/number-format'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { formatSymbol } from '@/lib/format'
import { useWalletStore } from '@/store/wallet-store'
import { useSettingsStore } from '@/store/settings-store'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { useConfidentialFundingPreview } from '@/popup/hooks/useConfidentialFundingPreview'
import { useShieldBalances } from '@/popup/hooks/useShieldBalances'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { assetPriceClient } from '@/popup/services/asset-price-client'
import { findAssetPrice } from '@/core/prices'
import { getPrivateTransferChainIds } from '@/popup/services/private-balance-transfer'
import { useNavigate } from '@/popup/provider/Router'
import { SlippageSettingContent } from '@/popup/components/swap/SlippageSetting'
import {
  SendSourceSection,
  SendFieldLabel,
  SendAmountInputCard,
  SendRouteInfoCard,
  SendRecipientInputCard
} from '@/popup/components/transaction/SendInputCards'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import {
  ShieldSourceTokenPickerRows,
  type ShieldSourceTokenPickerItem
} from '@/popup/components/tokens/ShieldSourceTokenPickerRows'
import { sortSendAssetsByBalanceValue } from '@/popup/pages/transactions/send-asset-order'
import { RecipientSelector } from '@/popup/components/transaction/RecipientSelector'
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
  buildExternalShieldWithdrawRequest,
  hasShieldTransferStarted,
  formatShieldQuoteTime,
  isUnsignedShieldTerminal,
  matchesExternalShieldWithdrawReview,
  listShieldFundingAssets,
  listShieldSendDestinations,
  shieldPortfolioBalances,
  shieldFundingAvailableRaw,
  shieldFundingSources,
  selectDefaultShieldWithdrawSource,
  resolveShieldManagedAsset,
  selectShieldWithdrawDestinationForNetwork,
  type ShieldFundingAsset
} from '@/popup/services/shield-transfer'
import {
  normalizePrivateBalanceTransferInput,
  resolvePrivateBalanceTransferAmount
} from '@/popup/services/private-balance-transfer'

function withdrawChainIconAlias(chain: ShieldFundingAsset['chain']['chain']): string {
  return chain.family === 'evm'
    ? resolveEvmChainIconAlias(chain.id)
    : resolveChainIconAlias(chain.family, chain.displayName)
}

export function ShieldWithdrawPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const target = new URLSearchParams(params)
  target.set('sourceMode', 'shield')
  return (
    <Navigate to={`/send?${target}`} replace state={{ ...location.state, sendEntry: 'shield' }} />
  )
}

export interface ShieldWithdrawEntry {
  readonly assetId: string | null
  readonly networkId: string | null
  readonly recipient: string
  readonly provider: string | null
}

export interface ShieldWithdrawSourcePickerState {
  readonly items: readonly ShieldSourceTokenPickerItem[]
  readonly selectedAssetId?: string
  readonly balancesHidden: boolean
  readonly onSelect: (assetId: string) => void
}

export function ShieldWithdrawForm({
  active,
  entry,
  onStateChange,
  model,
  initialAsset,
  refresh,
  onSelectPublic,
  onOpenSourcePicker,
  onSourcePickerState,
  sourceSelectorActive = false
}: {
  readonly active: boolean
  readonly entry: Readonly<ShieldWithdrawEntry>
  readonly onStateChange: (state: { readonly reviewing: boolean; readonly busy: boolean }) => void
  readonly model: PortfolioReadModel | null
  readonly initialAsset: PortfolioAssetView | null
  readonly refresh: (force?: boolean) => Promise<void>
  readonly onSelectPublic: (assetId: string | null, recipient: string) => void
  readonly onOpenSourcePicker?: () => void
  readonly onSourcePickerState?: (state: ShieldWithdrawSourcePickerState) => void
  readonly sourceSelectorActive?: boolean
}) {
  const { navigate } = useNavigate()
  const providerIsNear = entry.provider === null || entry.provider === 'near-confidential'
  const routeAssetId = entry.assetId ?? ''
  const routeNetworkId = entry.networkId
  const routeRecipient = entry.recipient
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)
  const balancesHidden = useSettingsStore(state => state.balancesHidden)
  const { activeAccount } = useActiveAccountNetworks()
  const account = resolveEffectiveActiveAccountIdentity({
    currentWalletId,
    currentAccountId,
    nativeAccount: activeAccount
  })
  const canManageNear =
    providerIsNear && getPrivateTransferChainIds(activeAccount, network === 'mainnet').length > 0
  const scopeKey = `${network}:${account?.walletId ?? ''}:${account?.accountId ?? ''}`
  const latestScope = useRef(scopeKey)
  latestScope.current = scopeKey
  const entryKey = JSON.stringify([routeAssetId, routeNetworkId, routeRecipient, entry.provider])
  const latestEntry = useRef(entryKey)
  latestEntry.current = entryKey
  const activeRef = useRef(active)
  activeRef.current = active
  const formRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const [catalogTokens, setCatalogTokens] = useState<readonly SwapToken[]>(getCachedTokens)
  const [managedAssets, setManagedAssets] = useState<readonly IntentsManagedAsset[]>(() =>
    resolveManagedIntentsCatalog(getCachedTokens())
  )
  const [priceSnapshot, setPriceSnapshot] = useState<{
    scopeKey: string
    value: AssetPriceReadModel
  } | null>(null)
  const [sourceId, setSourceId] = useState(routeAssetId)
  const [destinationNetworkId, setDestinationNetworkId] = useState<string | null>(routeNetworkId)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState(isAddress(routeRecipient) ? routeRecipient : '')
  const [picker, setPicker] = useState<'source' | 'network' | 'recipient' | 'slippage' | null>(null)
  const [slippage, setSlippage] = useState(0.5)
  const [prepared, setPrepared] = useState<Readonly<{
    review: ConfidentialFundingReview
    request: PrepareConfidentialFundingRequest
    source: ShieldFundingAsset
    destination: ShieldFundingAsset
    amount: string
  }> | null>(null)
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

  useLayoutEffect(() => {
    if (active || !formRef.current?.contains(document.activeElement)) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }, [active])

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
    if (!active && prepared && confirmationAttempt.current) setUncertain(true)
  }, [active, prepared])

  useEffect(() => {
    setSourceId(routeAssetId)
    setDestinationNetworkId(routeNetworkId)
    setAmount('')
    setRecipient(isAddress(routeRecipient) ? routeRecipient : '')
    setPicker(null)
    setPrepared(null)
    setBusy(false)
    setUncertain(false)
    setError(null)
    confirmationAttempt.current = null
  }, [scopeKey, routeAssetId, routeNetworkId, routeRecipient])

  useEffect(() => {
    if (!active && !sourceSelectorActive) return
    let current = true
    const load = async () => {
      try {
        if (getCachedTokens().length === 0) {
          const cached = await swapTokenCatalogClient.readCached()
          if (current && cached.length) {
            setCatalogTokens(cached)
            setManagedAssets(resolveManagedIntentsCatalog(cached))
          }
        }
        const refreshed = await fetchSwapTokens()
        if (current && refreshed.length) {
          setCatalogTokens(refreshed)
          setManagedAssets(resolveManagedIntentsCatalog(refreshed))
        }
      } catch {
        // Cached portfolio remains visible while the token catalog is unavailable.
      }
    }
    void load()
    return () => {
      current = false
    }
  }, [active, sourceSelectorActive, network])

  useEffect(() => {
    if (!active) return
    let current = true
    void assetPriceClient
      .getPrices('read')
      .then(value => {
        if (current && value && value.status !== 'error') setPriceSnapshot({ scopeKey, value })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [active, scopeKey])

  const options = useMemo(
    () => listShieldFundingAssets(model, managedAssets, catalogTokens, network),
    [model, managedAssets, catalogTokens, network]
  )
  const displayBalances = currentBalances ?? shieldPortfolioBalances(model)
  const fundedSources = shieldFundingSources(options, displayBalances)
  const prices = priceSnapshot?.scopeKey === scopeKey ? priceSnapshot.value : null
  const fundedAssetIds = new Set(fundedSources.map(item => item.asset.asset.id))
  const sources = [
    ...fundedSources,
    ...options.filter(item => !fundedAssetIds.has(item.asset.asset.id))
  ]
  const sourcePickerItems = useMemo(
    () =>
      sortSendAssetsByBalanceValue(
        sources.map(item => ({
          key: item.asset.asset.id,
          amount: formatBaseUnitDecimalAmount(
            shieldFundingAvailableRaw(item, displayBalances),
            item.asset.metadata.decimals
          ),
          priceUsd: findAssetPrice(prices, item.asset.asset.id)?.priceUsd ?? null,
          item
        }))
      ).map(row => ({
        key: row.item.asset.asset.id,
        assetId: row.item.asset.asset.id,
        symbol: row.item.asset.metadata.symbol,
        iconUrl: row.item.asset.metadata.iconUrl,
        chainName: row.item.chain.chain.displayName,
        availableRaw: shieldFundingAvailableRaw(row.item, displayBalances),
        decimals: row.item.asset.metadata.decimals
      })),
    [displayBalances, prices, sources]
  )
  const routedPublicAsset = model?.assets.find(item => item.asset.id === sourceId)
  const routedManaged = routedPublicAsset
    ? resolveShieldManagedAsset(routedPublicAsset, managedAssets, catalogTokens, network)
    : null
  const source = sourceId
    ? (sources.find(item => item.asset.asset.id === sourceId) ??
      sources.find(item => item.managed.protocolAssetId === routedManaged?.protocolAssetId) ??
      null)
    : selectDefaultShieldWithdrawSource(options, displayBalances, model, prices, network)
  const selectedSourceAssetId = source?.asset.asset.id
  const pickerStateKey = JSON.stringify([
    scopeKey,
    sourcePickerItems,
    selectedSourceAssetId,
    balancesHidden
  ])
  const reportedPickerState = useRef<{
    key: string
    callback: typeof onSourcePickerState
  } | null>(null)
  useEffect(() => {
    if (!onSourcePickerState) return
    if (
      reportedPickerState.current?.key === pickerStateKey &&
      reportedPickerState.current.callback === onSourcePickerState
    )
      return
    reportedPickerState.current = { key: pickerStateKey, callback: onSourcePickerState }
    onSourcePickerState({
      items: sourcePickerItems,
      selectedAssetId: selectedSourceAssetId,
      balancesHidden,
      onSelect: assetId => {
        if (assetId === selectedSourceAssetId) {
          setPicker(null)
          return
        }
        setSourceId(assetId)
        setDestinationNetworkId(null)
        setRecipient('')
        setAmount('')
        setPicker(null)
      }
    })
  }, [onSourcePickerState, pickerStateKey])
  const keepSelectedSource = () => {
    if (!sourceId && source) setSourceId(source.asset.asset.id)
  }
  const destinations = source ? listShieldSendDestinations(source, options, network) : []
  const selectedDestinationNetworkId = destinationNetworkId ?? source?.chain.chain.id ?? null
  const destination =
    source && selectedDestinationNetworkId
      ? selectShieldWithdrawDestinationForNetwork(
          destinations,
          source,
          selectedDestinationNetworkId
        )
      : null
  const destinationNetwork = destination?.chain.chain
  const availableRaw = shieldFundingAvailableRaw(source, displayBalances)
  const displayedAsset = source?.asset ?? initialAsset
  const amountState = source
    ? resolvePrivateBalanceTransferAmount({
        amount,
        decimals: source.asset.metadata.decimals,
        availableRaw,
        sourceLabel: 'Shield'
      })
    : null
  const recipientValid = isAddress(recipient.trim()) && !/^0x0{40}$/i.test(recipient.trim())
  const previewRequest = useMemo(() => {
    if (
      !account ||
      !canManageNear ||
      !currentBalances ||
      !source ||
      !destination ||
      !amountState?.amountRaw ||
      !recipientValid
    )
      return null
    return buildExternalShieldWithdrawRequest({
      network,
      keyDomainId: account.walletId,
      accountId: account.accountId,
      amountRaw: amountState.amountRaw,
      recipient: recipient.trim(),
      source,
      destination,
      slippageBps: Math.round(slippage * 100)
    })
  }, [
    network,
    account?.walletId,
    account?.accountId,
    canManageNear,
    currentBalances,
    source,
    destination,
    amountState?.amountRaw,
    slippage,
    recipient,
    recipientValid
  ])
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview
  } = useConfidentialFundingPreview(active ? previewRequest : null, scopeKey)

  const scopeStillCurrent = () => {
    const wallet = useWalletStore.getState()
    return (
      activeRef.current &&
      mounted.current &&
      latestScope.current === scopeKey &&
      latestEntry.current === entryKey &&
      wallet.currentWalletId === currentWalletId &&
      wallet.currentAccountId === currentAccountId &&
      wallet.currentNetwork === network
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
      () => {
        if (activeRef.current)
          navigate(`/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`)
      },
      prepared
        ? {
            operation: 'send',
            amount: prepared.amount,
            symbol: formatSymbol(prepared.source.asset.metadata.symbol),
            from: 'Shield · NEAR Confidential',
            recipient: prepared.review.destinationAddress,
            network: prepared.destination.chain.chain.displayName
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
      !source ||
      !destination ||
      !amountState?.amountRaw ||
      !recipientValid ||
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
      if (!matchesExternalShieldWithdrawReview(review, request)) {
        void confidentialFundingClient.cancel(review.planId).catch(() => {})
        throw new Error('Send review changed. Try again.')
      }
      confirmationAttempt.current = null
      setUncertain(false)
      setPrepared({ review, request, source, destination, amount })
    } catch (cause) {
      if (scopeStillCurrent())
        setError(cause instanceof Error ? cause.message : 'Send quote unavailable')
    } finally {
      if (mounted.current && latestScope.current === scopeKey && latestEntry.current === entryKey)
        setBusy(false)
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
      setError('Send was not started. Try again.')
      return 'failed'
    }
    return plan.phase === 'prepared' ? 'prepared' : 'pending'
  }
  const cancelReview = async () => {
    if (!prepared || busy || !scopeStillCurrent()) return
    setBusy(true)
    try {
      if (confirmationAttempt.current === prepared.review.planId) {
        const state = await inspectPlan(prepared.review.planId)
        if (state !== 'prepared') return
      }
      await confidentialFundingClient.cancel(prepared.review.planId)
      if (!mounted.current || latestScope.current !== scopeKey || latestEntry.current !== entryKey)
        return
      setPrepared(null)
      setUncertain(false)
    } catch (cause) {
      if (scopeStillCurrent())
        setError(cause instanceof Error ? cause.message : 'Unable to cancel review')
    } finally {
      if (mounted.current && latestScope.current === scopeKey && latestEntry.current === entryKey)
        setBusy(false)
    }
  }
  const confirm = async () => {
    if (!prepared || busy || !canManageNear || !scopeStillCurrent()) return
    setBusy(true)
    setError(null)
    try {
      if (uncertain) {
        const state = await inspectPlan(prepared.review.planId)
        if (!scopeStillCurrent()) return
        if (state === 'prepared') {
          setUncertain(false)
          setError('Send was not started. Review and try again.')
        }
        return
      }
      if (prepared.review.expiresAt <= Date.now())
        throw new Error('Send quote expired. Review again.')
      confirmationAttempt.current = prepared.review.planId
      const plan = await confidentialFundingClient.confirm(
        prepared.review.planId,
        prepared.review.payloadFingerprint
      )
      if (hasShieldTransferStarted(plan)) openActivity(plan.transactionId)
      else await inspectPlan(plan.planId)
    } catch (cause) {
      if (!scopeStillCurrent()) return
      try {
        const state = await inspectPlan(prepared.review.planId)
        if (!scopeStillCurrent()) return
        if (state === 'prepared') {
          setUncertain(false)
          setError(cause instanceof Error ? cause.message : 'Send could not start')
        } else if (state === 'pending') {
          setUncertain(true)
          setError('Send status is pending. Check status before trying again.')
        }
      } catch {
        if (scopeStillCurrent()) {
          setUncertain(true)
          setError('Send status unavailable. Check status before trying again.')
        }
      }
    } finally {
      if (mounted.current && latestScope.current === scopeKey && latestEntry.current === entryKey)
        setBusy(false)
    }
  }

  if (activeAccount && !canManageNear) {
    return (
      <div ref={formRef} className="flex min-h-0 flex-1 flex-col">
        <p role="alert" className="px-4 py-6 text-center text-sm text-muted">
          Shield unavailable for this account
        </p>
      </div>
    )
  }

  if (prepared) {
    const output = formatBaseUnitDecimalAmount(
      prepared.review.expectedOutputRaw,
      prepared.destination.asset.metadata.decimals
    )
    const minimum = formatBaseUnitAmount(
      prepared.review.minimumOutputRaw,
      prepared.destination.asset.metadata.decimals
    )
    return (
      <div ref={formRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TransactionReviewView
          variant="figma"
          title="Confirm Send"
          asset={{
            assetId: prepared.source.asset.asset.id,
            symbol: formatSymbol(prepared.source.asset.metadata.symbol),
            icon: prepared.source.asset.metadata.iconUrl
          }}
          amount={prepared.amount}
          network={prepared.destination.chain.chain.displayName}
          summary={
            <TransactionReviewExchangeSummary
              presentation="single"
              destinationLabel="Recipient receives"
              destinationPrefix=""
              source={{
                asset: {
                  assetId: prepared.source.asset.asset.id,
                  symbol: formatSymbol(prepared.source.asset.metadata.symbol),
                  icon: prepared.source.asset.metadata.iconUrl
                },
                amount: prepared.amount
              }}
              destination={{
                asset: {
                  assetId: prepared.destination.asset.asset.id,
                  symbol: formatSymbol(prepared.destination.asset.metadata.symbol),
                  icon: prepared.destination.asset.metadata.iconUrl
                },
                amount: output
              }}
            />
          }
          rows={[
            { label: 'From', content: 'Shield · NEAR Confidential' },
            { label: 'Recipient', content: prepared.review.destinationAddress },
            {
              label: 'Network',
              content: (
                <span className="inline-flex items-center gap-1.5">
                  <ChainIcon
                    chain={withdrawChainIconAlias(prepared.destination.chain.chain)}
                    width={16}
                    height={16}
                    className="shrink-0 rounded-sm"
                  />
                  {prepared.destination.chain.chain.displayName}
                </span>
              )
            },
            {
              label: 'Recipient receives',
              content: (
                <AmountDisplay
                  value={output}
                  symbol={formatSymbol(prepared.destination.asset.metadata.symbol)}
                />
              )
            },
            {
              label: 'Minimum receive',
              content: (
                <AmountDisplay
                  value={minimum}
                  symbol={formatSymbol(prepared.destination.asset.metadata.symbol)}
                />
              )
            },
            ...(prepared.review.quoteTimeEstimateSeconds === undefined
              ? []
              : [
                  {
                    label: 'Estimated time',
                    content: formatShieldQuoteTime(prepared.review.quoteTimeEstimateSeconds)
                  }
                ]),
            ...(prepared.review.sourceNetworkFee
              ? [
                  {
                    label: 'Network fee',
                    content: (
                      <AmountDisplay
                        value={formatBaseUnitDecimalAmount(
                          prepared.review.sourceNetworkFee.raw,
                          prepared.review.sourceNetworkFee.decimals
                        )}
                        symbol={formatSymbol(prepared.review.sourceNetworkFee.symbol)}
                        profile="fee"
                      />
                    )
                  }
                ]
              : [])
          ]}
          error={
            error ? (
              <p role="alert" className="mt-3 text-sm text-warning">
                {error}
              </p>
            ) : undefined
          }
          confirmLabel={uncertain ? 'Check status' : 'Confirm'}
          confirming={busy}
          submitting={busy && confirmationAttempt.current === prepared.review.planId}
          onCancel={() => void cancelReview()}
          onConfirm={() => void confirm()}
        />
      </div>
    )
  }

  return (
    <div ref={formRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-5 pt-4">
        <SendSourceSection
          domain="shield"
          availableDomains={['public', 'shield']}
          disabled={busy}
          onDomainChange={domain => {
            if (domain === 'public') {
              const publicAssetId = [source?.asset, destination?.asset, initialAsset]
                .map(asset => asset?.asset.id)
                .find(id => model?.assets.some(item => item.asset.id === id))
              onSelectPublic(publicAssetId ?? null, isAddress(recipient) ? recipient : '')
            }
          }}
          amountInput={
            <SendAmountInputCard
              ariaLabel="Send amount"
              disabled={busy}
              available={availableRaw}
              symbol={formatSymbol(displayedAsset?.metadata.symbol)}
              inline
              value={amount}
              onChange={value => {
                const next = normalizePrivateBalanceTransferInput(value)
                if (next !== null) {
                  keepSelectedSource()
                  setAmount(next)
                }
              }}
            />
          }
          assetSelector={
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (onOpenSourcePicker) onOpenSourcePicker()
                else setPicker('source')
              }}
              className="wallet-interactive flex h-9 max-w-full items-center gap-2 rounded-full bg-wallet-surface px-2.5 text-sm enabled:hover:bg-wallet-selected enabled:active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {displayedAsset && (
                <TokenIcon
                  assetId={displayedAsset.asset.id}
                  symbol={formatSymbol(displayedAsset.metadata.symbol)}
                  icon={displayedAsset.metadata.iconUrl}
                  size={24}
                />
              )}
              {displayedAsset ? formatSymbol(displayedAsset.metadata.symbol) : 'Token'}
              <Icon icon="lucide:chevron-down" width={16} height={16} />
            </button>
          }
          balance={
            <span
              className="min-w-0 truncate"
              title={
                source && !balancesHidden
                  ? formatBaseUnitDecimalAmount(availableRaw, source.asset.metadata.decimals)
                  : undefined
              }
            >
              {balancesHidden
                ? '••••'
                : source
                  ? formatTokenQuantity(
                      formatBaseUnitDecimalAmount(availableRaw, source.asset.metadata.decimals)
                    )
                  : '—'}
            </span>
          }
          maxButton={
            <button
              type="button"
              disabled={busy || connecting || !source || !currentBalances || availableRaw === '0'}
              title={!currentBalances ? 'Shield balance unavailable' : 'Use maximum balance'}
              onClick={() => {
                if (!source) return
                keepSelectedSource()
                setAmount(formatBaseUnitDecimalAmount(availableRaw, source.asset.metadata.decimals))
              }}
              className="rounded-md bg-white/10 px-2 py-1 font-medium text-muted disabled:opacity-40"
            >
              Max
            </button>
          }
        />
        <div className="order-2 space-y-2">
          <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <SendFieldLabel>Send to</SendFieldLabel>
            <button
              type="button"
              disabled={busy || destinations.length === 0}
              onClick={() => {
                keepSelectedSource()
                setPicker('network')
              }}
              className="wallet-interactive inline-flex min-w-0 items-center gap-1.5 hover:text-primary disabled:opacity-50"
              aria-label={`Destination network, ${destinationNetwork?.displayName ?? 'select network'}`}
            >
              {destinationNetwork && (
                <ChainIcon
                  chain={withdrawChainIconAlias(destinationNetwork)}
                  width={16}
                  height={16}
                  className="shrink-0 rounded-[4px]"
                />
              )}
              <span className="truncate">
                {destinationNetwork?.displayName ?? 'Select network'}
              </span>
              <Icon icon="lucide:chevron-down" width={13} height={13} className="shrink-0" />
            </button>
          </div>
          <div>
            <SendRecipientInputCard
              id="shield-send-recipient"
              label="Recipient address"
              value={recipient}
              onChange={value => {
                keepSelectedSource()
                setRecipient(value)
              }}
              placeholder="Enter address"
              variant="filled"
              hideLabel
              disabled={busy || !destination}
              onSelectRecipient={
                busy || !destination
                  ? undefined
                  : () => {
                      keepSelectedSource()
                      setPicker('recipient')
                    }
              }
            />
          </div>
        </div>
        {source && destinations.length === 0 && (
          <p role="alert" className="order-5 text-xs text-warning">
            No supported network for this token
          </p>
        )}
        <div className="order-4">
          <SendRouteInfoCard
            provider={
              <span className="inline-flex items-center gap-2">
                <img src={nearLogo} alt="" className="size-5 rounded" />
                Confidential
              </span>
            }
            fee={
              preview?.sourceNetworkFee
                ? `${formatBaseUnitDecimalAmount(preview.sourceNetworkFee.raw, preview.sourceNetworkFee.decimals)} ${formatSymbol(preview.sourceNetworkFee.symbol)}`
                : '—'
            }
            time={
              preview?.timeEstimateSeconds === undefined
                ? '—'
                : formatShieldQuoteTime(preview.timeEstimateSeconds)
            }
            extra={
              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                <span className="text-muted">Slippage</span>
                <button
                  type="button"
                  aria-label={`Set slippage, currently ${slippage}%`}
                  disabled={busy}
                  onClick={() => setPicker('slippage')}
                  className="wallet-interactive inline-flex items-center gap-1 text-foreground hover:text-primary disabled:opacity-45"
                >
                  {slippage}% <Icon icon="lucide:chevron-down" width={14} height={14} />
                </button>
              </div>
            }
          />
        </div>
        {previewError && (
          <div
            role="alert"
            className="order-5 flex items-center justify-between gap-2 text-xs text-warning"
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
        {amountState?.error && (
          <p role="alert" className="order-5 text-xs text-warning">
            {amountState.error}
          </p>
        )}
        {recipient && !recipientValid && (
          <p role="alert" className="order-5 text-xs text-warning">
            Enter a valid EVM address
          </p>
        )}
        {(error || balanceError) && (
          <p role="alert" className="order-5 text-xs text-warning">
            {error ?? balanceError}
          </p>
        )}
        {!currentBalances && canManageNear && connecting && (
          <p role="status" className="order-5 text-center text-sm text-muted">
            Loading Shield balances…
          </p>
        )}
        {!currentBalances && canManageNear && !connecting && balanceError && (
          <Button
            variant="outline"
            size="wallet"
            onClick={() => void refreshBalances()}
            className="order-5 w-full"
          >
            Retry
          </Button>
        )}
      </div>
      <div className="page-footer">
        <Button
          size="wallet"
          className="w-full"
          isLoading={busy}
          disabled={
            !canManageNear ||
            !currentBalances ||
            !source ||
            !destination ||
            !amountState?.amountRaw ||
            !recipientValid ||
            !preview ||
            previewLoading
          }
          onClick={() => void prepare()}
        >
          Continue
        </Button>
      </div>
      <Dialog open={active && picker !== null} onOpenChange={open => !open && setPicker(null)}>
        <DialogContent
          position="bottom"
          className="max-h-[80vh] min-h-0 overflow-y-auto bg-wallet-surface p-4 pb-6"
        >
          <DialogTitle>
            {picker === 'source'
              ? 'Select Token'
              : picker === 'network'
                ? 'Network'
                : picker === 'slippage'
                  ? 'Slippage'
                  : 'Recipient'}
          </DialogTitle>
          <DialogDescription className="sr-only">Set Send {picker}</DialogDescription>
          {picker === 'source' && sources.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              {currentBalances
                ? 'No Shield tokens available'
                : connecting
                  ? 'Loading balances…'
                  : 'Balance unavailable'}
            </p>
          )}
          {picker === 'slippage' ? (
            <SlippageSettingContent
              key={slippage}
              currentSlippage={slippage}
              onSave={value => {
                setSlippage(value)
                setPicker(null)
              }}
            />
          ) : picker === 'recipient' && destination ? (
            <RecipientSelector
              chainId={destination.chain.chain.id}
              includeCurrentAccount
              onSelect={address => {
                setRecipient(address)
                setPicker(null)
              }}
            />
          ) : picker === 'network' ? (
            [...new Map(destinations.map(item => [item.chain.chain.id, item])).values()].map(
              item => (
                <button
                  key={item.chain.chain.id}
                  type="button"
                  aria-pressed={selectedDestinationNetworkId === item.chain.chain.id}
                  onClick={() => {
                    const next = selectShieldWithdrawDestinationForNetwork(
                      destinations,
                      source,
                      item.chain.chain.id
                    )
                    if (next) {
                      if (selectedDestinationNetworkId !== item.chain.chain.id) setRecipient('')
                      setDestinationNetworkId(item.chain.chain.id)
                    }
                    setPicker(null)
                  }}
                  className={`wallet-interactive flex w-full items-center gap-3 rounded-md px-2 py-3 text-left text-sm hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${selectedDestinationNetworkId === item.chain.chain.id ? 'bg-wallet-selected' : ''}`}
                >
                  <ChainIcon
                    chain={withdrawChainIconAlias(item.chain.chain)}
                    width={28}
                    height={28}
                    className="shrink-0 rounded-md"
                  />
                  <span className="min-w-0 flex-1 truncate">{item.chain.chain.displayName}</span>
                  {selectedDestinationNetworkId === item.chain.chain.id && (
                    <Icon icon="lucide:check" width={17} height={17} className="text-primary" />
                  )}
                </button>
              )
            )
          ) : picker === 'source' ? (
            <ShieldSourceTokenPickerRows
              items={sourcePickerItems}
              balancesHidden={balancesHidden}
              selectedAssetId={source?.asset.asset.id}
              onSelect={assetId => {
                if (assetId === source?.asset.asset.id) {
                  setPicker(null)
                  return
                }
                setSourceId(assetId)
                setDestinationNetworkId(null)
                setRecipient('')
                setAmount('')
                setPicker(null)
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
