import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import type { PortfolioReadModel, PortfolioAssetView } from '@/core/portfolio'
import type { AssetPriceReadModel } from '@/core/prices'
import { Icon } from '@iconify/react'
import nearLogo from '@/images/figma-near-confidential.svg'
import { isAddress } from 'viem'
import { resolveEvmChainIconAlias } from '@/config/icons'
import type { IntentsManagedAsset } from '@/core/services/intents-managed-assets'
import type { SwapToken } from '@/core/services/intents-api'
import type { ConfidentialFundingReview } from '@/core/services/confidential-funding'
import {
  formatBaseUnitAmount,
  formatBaseUnitDecimalAmount,
  formatTokenQuantity
} from '@/lib/number-format'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { useWalletStore } from '@/store/wallet-store'
import { useSettingsStore } from '@/store/settings-store'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { useConfidentialFundingPreview } from '@/popup/hooks/useConfidentialFundingPreview'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { assetPriceClient } from '@/popup/services/asset-price-client'
import { getPrivateTransferChainIds } from '@/popup/services/private-balance-transfer'
import { useNavigate } from '@/popup/provider/Router'
import { PageHeader } from '@/popup/components/common/PageHeader'
import {
  SendSourceSection,
  SendFieldLabel,
  SendAmountInputCard,
  SendRecipientInputCard
} from '@/popup/components/transaction/SendInputCards'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import { RecipientSelector } from '@/popup/components/transaction/RecipientSelector'
import {
  TransactionReviewExchangeSummary,
  TransactionReviewView
} from '@/popup/components/transaction/TransactionReviewView'
import { Button } from '@/popup/components/ui/button'
import { SlippageSettingContent } from '@/popup/components/swap/SlippageSetting'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/popup/components/ui/dialog'
import { openModal } from '@/popup/provider/ModalManager'
import {
  CONFIDENTIAL_PREVIEW_CONNECTION_ERROR,
  confidentialFundingClient,
  type ConfidentialBalance,
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

export function ShieldWithdrawForm({
  model,
  initialAsset,
  refresh,
  onSelectPublic,
  onBack
}: {
  readonly model: PortfolioReadModel | null
  readonly initialAsset: PortfolioAssetView | null
  readonly refresh: (force?: boolean) => Promise<void>
  readonly onSelectPublic: (assetId: string | null, recipient: string) => void
  readonly onBack: () => void
}) {
  const [params] = useSearchParams()
  const { navigate } = useNavigate()
  const providerIsNear =
    params.get('provider') === null || params.get('provider') === 'near-confidential'
  const routeAssetId = params.get('assetId') ?? ''
  const routeNetworkId = params.get('networkId')
  const routeRecipient = params.get('recipient') ?? ''
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
  const mounted = useRef(false)
  const [catalogTokens, setCatalogTokens] = useState<readonly SwapToken[]>([])
  const [managedAssets, setManagedAssets] = useState<readonly IntentsManagedAsset[]>([])
  const [balances, setBalances] = useState<readonly ConfidentialBalance[] | null>(null)
  const [priceSnapshot, setPriceSnapshot] = useState<{
    scopeKey: string
    value: AssetPriceReadModel
  } | null>(null)
  const [balanceScope, setBalanceScope] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [sourceId, setSourceId] = useState(routeAssetId)
  const [destinationId, setDestinationId] = useState('')
  const [destinationNetworkId, setDestinationNetworkId] = useState<string | null>(routeNetworkId)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState(isAddress(routeRecipient) ? routeRecipient : '')
  const [slippageBps, setSlippageBps] = useState(50)
  const [picker, setPicker] = useState<'source' | 'destination' | 'network' | 'recipient' | null>(
    null
  )
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
    setSourceId(routeAssetId)
    setDestinationId('')
    setDestinationNetworkId(routeNetworkId)
    setAmount('')
    setRecipient(isAddress(routeRecipient) ? routeRecipient : '')
    setSlippageBps(50)
    setPicker(null)
    setPrepared(null)
    setBusy(false)
    setConnecting(false)
    setUncertain(false)
    setError(null)
    confirmationAttempt.current = null
  }, [scopeKey, routeAssetId, routeNetworkId, routeRecipient])

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const cached = await swapTokenCatalogClient.readCached()
        if (active && cached.length) {
          setCatalogTokens(cached)
          setManagedAssets(resolveManagedIntentsCatalog(cached))
        }
        const refreshed = await swapTokenCatalogClient.refresh()
        if (active) {
          setCatalogTokens(refreshed)
          setManagedAssets(resolveManagedIntentsCatalog(refreshed))
        }
      } catch {
        // Cached portfolio remains visible while the token catalog is unavailable.
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
          void refresh(true)
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

  useEffect(() => {
    let active = true
    void assetPriceClient
      .getPrices('read')
      .then(value => {
        if (active && value && value.status !== 'error') setPriceSnapshot({ scopeKey, value })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [scopeKey])

  const options = useMemo(
    () => listShieldFundingAssets(model, managedAssets, catalogTokens, network),
    [model, managedAssets, catalogTokens, network]
  )
  const destinations = options.filter(item => item.chain.chain.family === 'evm')
  const currentBalances = balanceScope === scopeKey ? balances : null
  const displayBalances = currentBalances ?? shieldPortfolioBalances(model)
  const fundedSources = shieldFundingSources(options, displayBalances)
  const prices = priceSnapshot?.scopeKey === scopeKey ? priceSnapshot.value : null
  const fundedAssetIds = new Set(fundedSources.map(item => item.asset.asset.id))
  const sources = [
    ...fundedSources,
    ...options.filter(item => !fundedAssetIds.has(item.asset.asset.id))
  ]
  const routedPublicAsset = model?.assets.find(item => item.asset.id === sourceId)
  const routedManaged = routedPublicAsset
    ? resolveShieldManagedAsset(routedPublicAsset, managedAssets, catalogTokens, network)
    : null
  const source = sourceId
    ? (sources.find(item => item.asset.asset.id === sourceId) ??
      sources.find(item => item.managed.protocolAssetId === routedManaged?.protocolAssetId) ??
      null)
    : selectDefaultShieldWithdrawSource(options, displayBalances, model, prices, network)
  const keepSelectedSource = () => {
    if (!sourceId && source) setSourceId(source.asset.asset.id)
  }
  const destinationToken = destinationId
    ? (destinations.find(item => item.asset.asset.id === destinationId) ?? null)
    : (destinations.find(
        item => item.managed.protocolAssetId === source?.managed.protocolAssetId
      ) ?? null)
  const destination =
    destinationToken && destinationNetworkId
      ? selectShieldWithdrawDestinationForNetwork(
          destinations,
          destinationToken,
          destinationNetworkId
        )
      : null
  const destinationNetwork = destinations.find(item => item.chain.chain.id === destinationNetworkId)
    ?.chain.chain
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
      slippageBps
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
    recipient,
    recipientValid,
    slippageBps
  ])
  const {
    preview,
    loading: previewLoading,
    error: previewError,
    retry: retryPreview
  } = useConfidentialFundingPreview(previewRequest, scopeKey)

  const scopeStillCurrent = () => {
    const wallet = useWalletStore.getState()
    return (
      mounted.current &&
      latestScope.current === scopeKey &&
      wallet.currentWalletId === currentWalletId &&
      wallet.currentAccountId === currentAccountId &&
      wallet.currentNetwork === network
    )
  }
  const openActivity = (transactionId: string) => {
    if (scopeStillCurrent())
      navigate(`/?tab=activity&transactionId=${encodeURIComponent(transactionId)}`)
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
      if (scopeStillCurrent()) setBusy(false)
    }
  }

  if (activeAccount && !canManageNear) {
    return (
      <div className="page-container">
        <PageHeader title="Send" showBack />
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
      <div className="page-container">
        <TransactionReviewView
          variant="figma"
          title="Confirm Send"
          asset={{
            assetId: prepared.source.asset.asset.id,
            symbol: prepared.source.asset.metadata.symbol,
            icon: prepared.source.asset.metadata.iconUrl
          }}
          amount={prepared.amount}
          network={prepared.destination.chain.chain.displayName}
          summary={
            <TransactionReviewExchangeSummary
              source={{
                asset: {
                  assetId: prepared.source.asset.asset.id,
                  symbol: prepared.source.asset.metadata.symbol,
                  icon: prepared.source.asset.metadata.iconUrl
                },
                amount: prepared.amount
              }}
              destination={{
                asset: {
                  assetId: prepared.destination.asset.asset.id,
                  symbol: prepared.destination.asset.metadata.symbol,
                  icon: prepared.destination.asset.metadata.iconUrl
                },
                amount: output
              }}
            />
          }
          rows={[
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
            { label: 'Recipient', content: prepared.review.destinationAddress },
            {
              label: 'Minimum receive',
              content: (
                <AmountDisplay
                  value={minimum}
                  symbol={prepared.destination.asset.metadata.symbol}
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
                        symbol={prepared.review.sourceNetworkFee.symbol}
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
          onCancel={() => void cancelReview()}
          onConfirm={() => void confirm()}
        />
      </div>
    )
  }

  return (
    <div className="page-container min-h-0 overflow-hidden">
      <PageHeader title="Send" showBack onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
        <div className="space-y-4 mb-4">
          <SendSourceSection
            domain="shield"
            availableDomains={['public', 'shield']}
            disabled={busy}
            onDomainChange={domain => {
              if (domain === 'public')
                onSelectPublic(
                  destination?.asset.asset.id ?? initialAsset?.asset.id ?? null,
                  isAddress(recipient) ? recipient : ''
                )
            }}
            amountInput={
              <SendAmountInputCard
                ariaLabel="Send amount"
                disabled={busy}
                available={availableRaw}
                symbol={displayedAsset?.metadata.symbol ?? ''}
                hero
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
                onClick={() => setPicker('source')}
                className="wallet-interactive flex h-9 max-w-full items-center gap-2 rounded-full bg-wallet-surface px-2.5 text-sm enabled:hover:bg-wallet-selected enabled:active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50"
              >
                {displayedAsset && (
                  <TokenIcon
                    assetId={displayedAsset.asset.id}
                    symbol={displayedAsset.metadata.symbol}
                    icon={displayedAsset.metadata.iconUrl}
                    size={24}
                  />
                )}
                {displayedAsset?.metadata.symbol ?? 'Token'}
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
                  setAmount(
                    formatBaseUnitDecimalAmount(availableRaw, source.asset.metadata.decimals)
                  )
                }}
                className="rounded-md bg-primary/15 px-2 py-1 font-medium text-primary disabled:opacity-40"
              >
                Max
              </button>
            }
          />
        </div>

        <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-xs">
          <SendFieldLabel>Send to</SendFieldLabel>
          <button
            type="button"
            disabled={busy || !destinationToken}
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
            <span className="truncate">{destinationNetwork?.displayName ?? 'Select network'}</span>
            <Icon icon="lucide:chevron-down" width={13} height={13} className="shrink-0" />
          </button>
        </div>
        <div className="mb-3">
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
        <div className="mb-3 flex min-h-[62px] w-full items-center gap-3 rounded-lg bg-wallet-surface px-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              keepSelectedSource()
              setPicker('destination')
            }}
            className="wallet-interactive flex min-w-0 flex-1 items-center gap-3 text-left enabled:hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50"
            aria-label="Select destination token"
          >
            {destinationToken && (
              <TokenIcon
                assetId={destinationToken.asset.asset.id}
                symbol={destinationToken.asset.metadata.symbol}
                icon={destinationToken.asset.metadata.iconUrl}
                size={32}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-muted">Token</span>
              <span className="block truncate text-sm">
                {destinationToken?.asset.metadata.symbol ?? 'Select token'}
              </span>
            </span>
          </button>
          {preview && destination && (
            <span className="min-w-0 max-w-[42%] text-right text-sm">
              <span className="block text-xs text-muted">Est. receive</span>
              <AmountDisplay
                value={formatBaseUnitDecimalAmount(
                  preview.amountOutRaw,
                  destination.asset.metadata.decimals
                )}
              />
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              keepSelectedSource()
              setPicker('destination')
            }}
            aria-label="Select destination token"
            className="wallet-interactive shrink-0 enabled:hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50"
          >
            <Icon icon="lucide:chevron-down" width={17} height={17} />
          </button>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void openModal({
              title: 'Slippage Tolerance',
              showCloseButton: true,
              body: (_resolve, close) => (
                <SlippageSettingContent
                  currentSlippage={slippageBps / 100}
                  minimumSlippage={0.1}
                  maximumSlippage={1}
                  presets={[0.1, 0.5, 1]}
                  onSave={value => {
                    setSlippageBps(Math.round(value * 100))
                    close()
                  }}
                />
              )
            })
          }
          className="wallet-interactive flex min-h-[47px] w-full items-center justify-between rounded-lg border border-white/15 px-4 text-sm enabled:hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:opacity-50"
        >
          <span className="text-muted">Slippage</span>
          <span className="flex items-center gap-2">
            {slippageBps / 100}%
            <Icon icon="lucide:chevron-right" width={16} height={16} className="text-muted" />
          </span>
        </button>
        <div className="mt-4 space-y-2 text-xs">
          <span className="text-muted">Provider</span>
          <div className="rounded-lg border border-white/10 bg-wallet-surface px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <img src={nearLogo} alt="" className="size-5 shrink-0 rounded" />
              <span className="min-w-0 flex-1 truncate">NEAR Confidential Intents</span>
              {preview && destination && (
                <AmountDisplay
                  value={formatBaseUnitDecimalAmount(
                    preview.amountOutRaw,
                    destination.asset.metadata.decimals
                  )}
                  symbol={destination.asset.metadata.symbol}
                />
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-muted">
              <span>
                Est. time{' '}
                <span className="text-foreground">
                  {preview?.timeEstimateSeconds === undefined
                    ? '—'
                    : formatShieldQuoteTime(preview.timeEstimateSeconds)}
                </span>
              </span>
              <span className="text-right">
                Network fee{' '}
                <span className="text-foreground">
                  {preview?.sourceNetworkFee
                    ? `${formatBaseUnitDecimalAmount(preview.sourceNetworkFee.raw, preview.sourceNetworkFee.decimals)} ${preview.sourceNetworkFee.symbol}`
                    : '—'}
                </span>
              </span>
            </div>
            {preview && destination && (
              <div className="mt-2 flex justify-between gap-3 border-t border-white/10 pt-2">
                <span className="text-muted">Minimum receive</span>
                <AmountDisplay
                  value={formatBaseUnitDecimalAmount(
                    preview.minimumOutputRaw,
                    destination.asset.metadata.decimals
                  )}
                  symbol={destination.asset.metadata.symbol}
                />
              </div>
            )}
          </div>
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
        {amountState?.error && (
          <p role="alert" className="mt-3 text-xs text-warning">
            {amountState.error}
          </p>
        )}
        {currentBalances && source && availableRaw === '0' && (
          <div className="mt-4 flex justify-center gap-4 text-sm">
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/transfer?entry=shield&provider=near-confidential&assetId=${encodeURIComponent(source.asset.asset.id)}`
                )
              }
              className="wallet-interactive rounded-md px-2 py-1 text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
            >
              Move funds
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/shield-deposit?provider=near-confidential&assetId=${encodeURIComponent(source.asset.asset.id)}`
                )
              }
              className="wallet-interactive rounded-md px-2 py-1 text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
            >
              Receive funds
            </button>
          </div>
        )}
        {recipient && !recipientValid && (
          <p role="alert" className="mt-3 text-xs text-warning">
            Enter a valid EVM address
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs text-warning">
            {error}
          </p>
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
            !source ||
            !destination ||
            !amountState?.amountRaw ||
            !recipientValid ||
            !preview ||
            previewLoading
          }
          onClick={() => void prepare()}
        >
          Send
        </Button>
      </div>
      <Dialog open={picker !== null} onOpenChange={open => !open && setPicker(null)}>
        <DialogContent
          position="bottom"
          className="max-h-[80vh] min-h-0 overflow-y-auto bg-wallet-surface p-4 pb-6"
        >
          <DialogTitle>
            {picker === 'source'
              ? 'Source token'
              : picker === 'destination'
                ? 'Receive token'
                : picker === 'network'
                  ? 'Network'
                  : 'Recipient'}
          </DialogTitle>
          <DialogDescription className="sr-only">Choose a withdrawal {picker}</DialogDescription>
          {picker === 'source' && sources.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">
              {currentBalances
                ? 'No Shield tokens available'
                : connecting
                  ? 'Loading balances…'
                  : 'Balance unavailable'}
            </p>
          )}
          {picker === 'recipient' && destination ? (
            <RecipientSelector
              chainId={destination.chain.chain.id}
              includeCurrentAccount
              onSelect={address => {
                setRecipient(address)
                setPicker(null)
              }}
            />
          ) : picker === 'network' ? (
            [
              ...new Map(
                destinations
                  .filter(
                    item =>
                      destinationToken &&
                      item.asset.metadata.symbol === destinationToken.asset.metadata.symbol
                  )
                  .map(item => [item.chain.chain.id, item])
              ).values()
            ].map(item => (
              <button
                key={item.chain.chain.id}
                type="button"
                aria-pressed={destinationNetworkId === item.chain.chain.id}
                onClick={() => {
                  const next = selectShieldWithdrawDestinationForNetwork(
                    destinations,
                    destinationToken,
                    item.chain.chain.id
                  )
                  if (next) {
                    setDestinationId(next.asset.asset.id)
                    if (destinationNetworkId !== item.chain.chain.id) setRecipient('')
                    setDestinationNetworkId(item.chain.chain.id)
                  }
                  setPicker(null)
                }}
                className={`wallet-interactive flex w-full items-center gap-3 rounded-md px-2 py-3 text-left text-sm hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 ${destinationNetworkId === item.chain.chain.id ? 'bg-wallet-selected' : ''}`}
              >
                <ChainIcon
                  chain={withdrawChainIconAlias(item.chain.chain)}
                  width={28}
                  height={28}
                  className="shrink-0 rounded-md"
                />
                <span className="min-w-0 flex-1 truncate">{item.chain.chain.displayName}</span>
                {destinationNetworkId === item.chain.chain.id && (
                  <Icon icon="lucide:check" width={17} height={17} className="text-primary" />
                )}
              </button>
            ))
          ) : (
            (picker === 'source'
              ? sources
              : [...new Map(destinations.map(item => [item.asset.metadata.symbol, item])).values()]
            ).map(item => (
              <button
                key={item.asset.asset.id}
                type="button"
                onClick={() => {
                  if (picker === 'source') {
                    setSourceId(item.asset.asset.id)
                    setDestinationId('')
                    setDestinationNetworkId(null)
                    setRecipient('')
                    setAmount('')
                  } else {
                    setDestinationId(item.asset.asset.id)
                    if (
                      destinationNetworkId &&
                      !selectShieldWithdrawDestinationForNetwork(
                        destinations,
                        item,
                        destinationNetworkId
                      )
                    ) {
                      setDestinationNetworkId(null)
                      setRecipient('')
                    }
                  }
                  setPicker(null)
                }}
                className="wallet-interactive flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
              >
                <TokenIcon
                  assetId={item.asset.asset.id}
                  symbol={item.asset.metadata.symbol}
                  icon={item.asset.metadata.iconUrl}
                  size={30}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.asset.metadata.symbol}</span>
                  {picker === 'source' && (
                    <span className="block truncate text-xs text-muted">
                      {item.chain.chain.displayName}
                    </span>
                  )}
                </span>
                {picker === 'source' && (
                  <span
                    className="max-w-[42%] min-w-0 shrink-0 text-right"
                    title={
                      balancesHidden
                        ? undefined
                        : formatBaseUnitDecimalAmount(
                            shieldFundingAvailableRaw(item, displayBalances),
                            item.asset.metadata.decimals
                          )
                    }
                  >
                    <span className="block truncate text-sm tabular-nums">
                      {balancesHidden
                        ? '••••'
                        : formatTokenQuantity(
                            formatBaseUnitDecimalAmount(
                              shieldFundingAvailableRaw(item, displayBalances),
                              item.asset.metadata.decimals
                            )
                          )}
                    </span>
                    <span className="block text-xs text-muted">Available</span>
                  </span>
                )}
              </button>
            ))
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
