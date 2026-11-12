import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { fetchSwapTokens, getCachedTokens, type SwapToken } from '@/core/services/intents-api'
import type { ConfidentialFundingReview } from '@/core/services/confidential-funding'
import {
  formatBaseUnitAmount,
  formatBaseUnitDecimalAmount,
  formatTokenQuantity
} from '@/lib/number-format'
import { formatSortAddress, formatSymbol } from '@/lib/format'
import { useWalletStore } from '@/store/wallet-store'
import { useSettingsStore } from '@/store/settings-store'
import { useSwapPreferences } from '@/store/swap-store'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { useHomePortfolio } from '@/popup/hooks/useHomePortfolio'
import { useConfidentialFundingPreview } from '@/popup/hooks/useConfidentialFundingPreview'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { getPrivateTransferChainIds } from '@/popup/services/private-balance-transfer'
import { getEvmNetworkConfigs } from '@/config/networks'
import { useNavigate } from '@/popup/provider/Router'
import { SwapAssetCard } from '@/popup/components/swap/SwapInputView'
import { getSwapAmountValues } from '@/popup/components/swap/swap-estimate'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import {
  TransactionReviewExchangeSummary,
  TransactionReviewView
} from '@/popup/components/transaction/TransactionReviewView'
import { openConfidentialActivity } from '@/popup/components/transaction/ConfidentialActivitySheet'
import { Button } from '@/popup/components/ui/button'
import { Input } from '@/popup/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/popup/components/ui/dialog'
import {
  CONFIDENTIAL_PREVIEW_CONNECTION_ERROR,
  confidentialFundingClient,
  type ConfidentialBalance,
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
  type ShieldFundingAsset
} from '@/popup/services/shield-transfer'
import {
  buildShieldSwapRequest,
  formatShieldSwapPreviewRate,
  matchesShieldSwapReview,
  shieldSwapFormAmountError,
  shieldSwapFormBalance
} from '@/popup/services/shield-swap-form'

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
  readonly onStateChange: (state: { readonly reviewing: boolean; readonly busy: boolean }) => void
}

export function ShieldSwapPage(props: ShieldSwapPageProps) {
  const walletId = useWalletStore(state => state.currentWalletId)
  const accountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)
  return <ShieldSwapForm key={`${network}:${walletId}:${accountId}`} {...props} />
}

function ShieldSwapForm({ onStateChange }: ShieldSwapPageProps) {
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
  const [balances, setBalances] = useState<readonly ConfidentialBalance[] | null>(null)
  const [balanceScope, setBalanceScope] = useState('')
  const [fromId, setFromId] = useState<string | null>(routeSourceAssetId)
  const [toId, setToId] = useState<string | null>(routeDestinationAssetId)
  const [amount, setAmount] = useState('')
  const slippage = useSwapPreferences(state => state.slippage)
  const slippageBps = Math.round(slippage * 100)
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [search, setSearch] = useState('')
  const [prepared, setPrepared] = useState<Readonly<{
    review: ConfidentialFundingReview
    request: PrepareConfidentialFundingRequest
    from: ShieldFundingAsset
    to: ShieldFundingAsset
    amount: string
  }> | null>(null)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmationAttempt = useRef<string | null>(null)

  useLayoutEffect(() => {
    onStateChange({ reviewing: Boolean(prepared), busy })
  }, [prepared, busy, onStateChange])

  useLayoutEffect(() => () => onStateChange({ reviewing: false, busy: false }), [onStateChange])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!providerIsNear) navigate('/shield-funds', { replace: true })
  }, [providerIsNear, navigate])

  useEffect(() => {
    setFromId(routeSourceAssetId)
    setToId(routeDestinationAssetId)
    setAmount('')
    setPicker(null)
    setSearch('')
    setPrepared(null)
    setBusy(false)
    setConnecting(false)
    setUncertain(false)
    setError(null)
    confirmationAttempt.current = null
  }, [scopeKey, routeSourceAssetId, routeDestinationAssetId])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        if (getCachedTokens().length === 0) {
          const cached = await swapTokenCatalogClient.readCached()
          if (active && cached.length) setTokens(cached)
        }
        const refreshed = await fetchSwapTokens()
        if (active && refreshed.length) {
          setTokens(refreshed)
        }
      } catch {
        /* The cached catalog remains available. */
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [network])

  useEffect(() => {
    let active = true
    setBalances(null)
    setBalanceScope('')
    if (!account || !canManageNear) return
    setConnecting(true)
    void confidentialFundingClient
      .refreshBalances(
        {
          network,
          keyDomainId: account.walletId,
          accountId: account.accountId
        },
        true
      )
      .then(value => {
        if (active) {
          setBalances(value)
          setBalanceScope(scopeKey)
          void refresh()
        }
      })
      .catch(() => {
        if (active) setError('Unable to load Shield balances. Please try again.')
      })
      .finally(() => {
        if (active) setConnecting(false)
      })
    return () => {
      active = false
    }
  }, [scopeKey, canManageNear])

  const options = useMemo(
    () => listShieldFundingAssets(model, managedAssets, tokens, network),
    [model, managedAssets, tokens, network]
  )
  const originIdentifiers = useMemo(
    () =>
      new Map(options.map(asset => [asset.asset.asset.id, shieldOriginIdentifier(asset, options)])),
    [options]
  )
  const currentBalances = balanceScope === scopeKey ? balances : null
  const displayBalances = currentBalances ?? shieldPortfolioBalances(model)
  const sources = shieldFundingSources(options, displayBalances)
  const sourceChoices = sources.length > 0 ? sources : options
  const defaultSource = selectDefaultShieldWithdrawSource(
    options,
    displayBalances,
    model,
    null,
    network
  )
  const from = fromId
    ? (sourceChoices.find(asset => asset.asset.asset.id === fromId) ?? null)
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
  } = useConfidentialFundingPreview(previewRequest, scopeKey)
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
  const previewRate =
    preview && previewOutput && amount && from && to
      ? formatShieldSwapPreviewRate(amount, preview.amountOutRaw, to.asset.metadata.decimals)
      : null
  const pickable = (picker === 'from' ? sourceChoices : options).filter(
    asset =>
      asset.managed.protocolAssetId !==
        (picker === 'from' ? to?.managed.protocolAssetId : from?.managed.protocolAssetId) &&
      `${asset.asset.metadata.symbol} ${asset.asset.metadata.name} ${asset.chain.chain.displayName} ${asset.asset.asset.reference}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  )
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
    setConnecting(true)
    setError(null)
    try {
      const value = await confidentialFundingClient.refreshBalances(
        {
          network,
          keyDomainId: account.walletId,
          accountId: account.accountId
        },
        true
      )
      if (scopeStillCurrent()) {
        setBalances(value)
        setBalanceScope(scopeKey)
        if (previewError === CONFIDENTIAL_PREVIEW_CONNECTION_ERROR) retryPreview()
        void refresh(true)
      }
    } catch (cause) {
      if (scopeStillCurrent())
        setError(cause instanceof Error ? cause.message : 'Shield balance unavailable')
    } finally {
      if (scopeStillCurrent()) setConnecting(false)
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
  const cancelReview = async () => {
    if (!prepared || busy || !scopeStillCurrent()) return
    setBusy(true)
    try {
      if (
        confirmationAttempt.current === prepared.review.planId &&
        (await inspectPlan(prepared.review.planId)) !== 'prepared'
      )
        return
      await confidentialFundingClient.cancel(prepared.review.planId)
      if (!scopeStillCurrent()) return
      setPrepared(null)
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
      if (prepared.review.expiresAt <= Date.now())
        throw new Error('Swap quote expired. Review again.')
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
            />
          }
          rows={[
            {
              label: 'Minimum receive',
              content: (
                <AmountDisplay
                  value={minimum}
                  symbol={formatSymbol(prepared.to.asset.metadata.symbol)}
                />
              )
            },
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
            ...(prepared.review.quoteTimeEstimateSeconds === undefined
              ? []
              : [
                  {
                    label: 'Estimated time',
                    content: formatShieldQuoteTime(prepared.review.quoteTimeEstimateSeconds)
                  }
                ])
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
        <SwapAssetCard
          direction="From"
          token={fromToken}
          amount={amount}
          fiatValue={fromToken?.price ? fromFiat : ''}
          balance={hidden ? '••••' : (balance ?? '—')}
          tokenSelectDisabled={tokens.length === 0}
          onTokenSelect={() => {
            setSearch('')
            setPicker('from')
          }}
          tokenSelectLocked={busy}
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
            amount={previewOutput ?? ''}
            fiatValue={toToken?.price ? toFiat : ''}
            onTokenSelect={() => {
              setSearch('')
              setPicker('to')
            }}
            tokenSelectDisabled={tokens.length === 0}
            tokenSelectLocked={busy}
            isReadOnly
            isAmountLoading={previewLoading}
            isEstimatedAmount={Boolean(previewOutput)}
          />
        </div>
        <div className="mt-2 rounded-lg border border-white/15 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2 py-1">
            <span className="text-muted">Slippage</span>
            <span>{slippage}%</span>
          </div>
          {preview && from && to && (
            <>
              {previewRate && (
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="shrink-0 text-muted">Rate</span>
                  <span className="min-w-0 truncate text-right tabular-nums">
                    1 {formatSymbol(from.asset.metadata.symbol)} = {previewRate}{' '}
                    {formatSymbol(to.asset.metadata.symbol)}
                  </span>
                </div>
              )}
              {preview.appFeeBps !== undefined && (
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-muted">Service fee</span>
                  <span>{preview.appFeeBps / 100}%</span>
                </div>
              )}
              {preview.timeEstimateSeconds !== undefined && (
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-muted">Est. time</span>
                  <span>{formatShieldQuoteTime(preview.timeEstimateSeconds)}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 py-2.5">
                <span className="shrink-0 text-muted">Minimum receive</span>
                <span className="min-w-0 text-right">
                  <AmountDisplay
                    value={formatBaseUnitDecimalAmount(
                      preview.minimumOutputRaw,
                      to.asset.metadata.decimals
                    )}
                    symbol={formatSymbol(to.asset.metadata.symbol)}
                  />
                </span>
              </div>
            </>
          )}
        </div>
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
        {error && (
          <p role="alert" className="mt-3 text-xs text-warning">
            {error}
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
        {!currentBalances && canManageNear && !connecting && error && (
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
          className="w-full"
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
      <Dialog open={picker !== null} onOpenChange={open => !open && setPicker(null)}>
        <DialogContent
          position="bottom"
          className="flex max-h-[85dvh] flex-col gap-3 bg-wallet-surface p-4"
        >
          <DialogTitle>Select token</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a token in NEAR Confidential
          </DialogDescription>
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search tokens"
            aria-label="Search Shield tokens"
          />
          <div className="min-h-0 overflow-y-auto">
            {pickable.map(asset => (
              <button
                type="button"
                key={asset.asset.asset.id}
                title={asset.managed.protocolAssetId}
                onClick={() => {
                  if (picker === 'from') {
                    setFromId(asset.asset.asset.id)
                    setAmount('')
                  } else setToId(asset.asset.asset.id)
                  setPicker(null)
                }}
                className="wallet-interactive flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              >
                <TokenIcon
                  assetId={asset.asset.asset.id}
                  symbol={formatSymbol(asset.asset.metadata.symbol)}
                  icon={asset.asset.metadata.iconUrl}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {formatSymbol(asset.asset.metadata.symbol)}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {asset.chain.chain.displayName}
                    {originIdentifiers.get(asset.asset.asset.id)
                      ? ` · ${originIdentifiers.get(asset.asset.asset.id)}`
                      : ''}
                  </span>
                </span>
                <span
                  className="max-w-[120px] truncate text-sm"
                  title={
                    hidden
                      ? undefined
                      : (shieldSwapFormBalance(asset, displayBalances) ?? undefined)
                  }
                >
                  {hidden
                    ? '••••'
                    : formatTokenQuantity(shieldSwapFormBalance(asset, displayBalances))}
                </span>
              </button>
            ))}
            {!pickable.length && (
              <p className="py-8 text-center text-sm text-muted">
                {status === 'loading' ? 'Loading Shield tokens…' : 'No Shield tokens found'}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
