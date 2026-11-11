import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import type { PortfolioAssetView, PortfolioChainView, PortfolioReadModel } from '@/core/portfolio'
import { formatSortAddress, getAccountDisplayName } from '@/lib/format'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { InlineError } from '@/popup/components/common/InlineError'
import { formatSendFiatValue } from '@/popup/components/transaction/send-input-model'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { Button } from '@/popup/components/ui/button'
import { Switch } from '@/popup/components/ui/switch'
import nearLogo from '@/images/figma-near-confidential.svg'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/popup/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/popup/components/ui/dropdown-menu'
import {
  EvmWalletClientError,
  evmWalletClient,
  type EvmTransferReview,
  type EvmTransferSubmission
} from '@/popup/services/evm-wallet-client'
import {
  formatBaseUnitAmount,
  formatBaseUnitDecimalAmount,
  formatTokenQuantity,
  parseDisplayUnitAmount
} from '@/lib/number-format'
import { formatPortfolioNetworkName } from '@/popup/components/portfolio/portfolio-format'
import { openHardwareEvmSignTab } from '@/lib/hardware-tab'
import { openModal } from '@/popup/provider/ModalManager'
import { useNavigate } from '@/popup/provider/Router'
import { RecipientSelector } from '@/popup/components/transaction/RecipientSelector'
import { NetworkFeeTierPicker } from '@/popup/components/transaction/NetworkFeeTierPicker'
import {
  SendAmountInputCard,
  SendSourceSection,
  SendAssetHeader,
  SendRecipientAddress,
  SendRecipientInputCard
} from '@/popup/components/transaction/SendInputCards'
import { DEFAULT_NETWORK_FEE_TIER } from '@/core/transactions/domain'
import {
  areEvmFeeSelectionsEqual,
  formatEvmWeiAsGwei,
  type EvmFeeSelection
} from '@/infrastructure/chains/evm'
import { useTransferFeePreview } from '@/popup/hooks/useTransferFeePreview'
import { useEvmConfirmationEstimate } from '@/popup/hooks/useEvmConfirmationEstimate'
import { useTransferMaximum } from '@/popup/hooks/useTransferMaximum'
import {
  createNativeTransferSource,
  estimateNativeTransferMaximum,
  estimateConfidentialTransferMaximum,
  fallbackTransferMaximum,
  isTransferAmountSpendable
} from '@/popup/services/transfer-maximum'
import {
  getEvmTransferBalanceError,
  getEvmSendPrepareError,
  getEvmTokenFeeBalanceError,
  buildPrivateEvmTransferPath,
  buildPublicPrivateEvmSendPath,
  resolveEvmNativeMaximumAmount,
  type EvmSendSourceMode
} from './evm-send-validation'
import { resolvePortfolioTransferAvailability } from '@/popup/services/transfer-availability'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { ExecutionAccountBadge } from '@/popup/components/account/ExecutionAccountSelector'
import { TransactionReviewView } from '@/popup/components/transaction/TransactionReviewView'
import {
  recordSendApprovalFailure,
  recordSendResult,
  recordSendSubmission
} from '@/popup/services/send-transaction-analytics'
import { useEvmSendSupport } from '@/popup/hooks/useEvmSendSupport'
import { getPrivateTransferChainIds } from '@/popup/services/private-balance-transfer'
import {
  isCurrentAccountPrivateEvmAddress,
  resolveEvmAddressRole
} from '@/core/accounts/evm-address-role'
import {
  createEvmSendIntentKey,
  getEvmSendRecipientError,
  getEvmSendPrivacyWarning,
  resolveEvmSendAvailableRaw,
  resolveEvmSendRoute
} from '@/popup/services/evm-send-routing'
import { useWalletStore } from '@/store/wallet-store'
import { useSettingsStore } from '@/store/settings-store'
import { useSwapPreferences } from '@/store/swap-store'
import { getChainEndpointRuntimeKey } from '@/core/chains/chain-endpoint-settings'
import { LatestAttempt } from '@/lib/async-utils'
import { getRheaSwapErrorMessage, rheaSwapClient } from '@/popup/services/rhea-swap-client'
import { resolveEffectiveActiveAccountIdentity } from '@/popup/lib/effective-active-account'
import { accountNetworksClient } from '@/popup/services/account-networks-client'
import { receiveTargetsClient } from '@/popup/services/receive-targets-client'
import { getEnabledSwapChains } from '@/popup/services/swap-catalog-loading'
import { getRheaSwapQuoteDeadline, isRheaSwapQuoteFresh } from '@/popup/services/swap-page-model'
import {
  buildPublicPrivateSendPreviewRequest,
  createPublicPrivateSendPreviewKey,
  getPublicPrivateSendRouteCost,
  resolvePublicPrivateSendQuotePair
} from '@/popup/services/public-private-send-preview'
import type { RheaSwapQuoteView } from '@/core/services/rhea-swap'

export interface EvmSendAsset {
  readonly asset: PortfolioAssetView
  readonly chain: PortfolioChainView
}

interface PreparedReview {
  readonly intentKey: string
  readonly sourceMode: EvmSendSourceMode
  readonly sourceAddress: string
  readonly privacyWarning: string | null
  readonly amount: string
  readonly amountRaw: string
  readonly recipient: string
  readonly feeSelection: EvmFeeSelection
  readonly value: EvmTransferReview
}

interface PrivateSendPreview {
  readonly key: string
  readonly quote: RheaSwapQuoteView
  readonly routeCost: string | null
  readonly estimatedReceive: string
}

export function EvmSendForm({
  walletMode,
  onSelectAsset,
  onSelectShield,
  destinationNetworks,
  onSelectDestinationNetwork,
  selection,
  portfolio,
  priceUsd,
  sourceMode,
  onFundPrivate,
  initialRecipient,
  initialDraft,
  onSubmitted
}: {
  walletMode: 'public' | 'private'
  onSelectAsset: () => void
  onSelectShield: (recipient: string) => void
  destinationNetworks: readonly {
    assetId: string
    chainId: string
    name: string
    icon: string
  }[]
  onSelectDestinationNetwork: (
    destinationAssetId: string,
    draft: Readonly<{ recipient: string; amount: string }>
  ) => void
  selection: EvmSendAsset
  portfolio: PortfolioReadModel
  priceUsd: string | null
  sourceMode: EvmSendSourceMode
  onFundPrivate?: () => void
  initialRecipient?: string
  initialDraft?: Readonly<{
    recipient: string
    amount: string
    maximum: boolean
    sendPrivately: true
  }>
  onSubmitted: (submission: EvmTransferSubmission) => void
}) {
  const [amount, setAmount] = useState('')
  const [privateSendScope, setPrivateSendScope] = useState<string | null>(null)
  const [recipient, setRecipient] = useState(initialRecipient ?? '')
  const [selectedRecipient, setSelectedRecipient] = useState<{
    address: string
    name: string
  } | null>(null)
  const [feeSelection, setFeeSelection] = useState<EvmFeeSelection>({
    kind: 'tier',
    tier: DEFAULT_NETWORK_FEE_TIER
  })
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [maxSelected, setMaxSelected] = useState(false)
  const [approving, setApproving] = useState(false)
  const [updatingFee, setUpdatingFee] = useState(false)
  const [review, setReview] = useState<PreparedReview | null>(null)
  const [privatePreview, setPrivatePreview] = useState<PrivateSendPreview | null>(null)
  const [privatePreviewLoading, setPrivatePreviewLoading] = useState(false)
  const [privatePreviewError, setPrivatePreviewError] = useState<string | null>(null)
  const [privatePreviewRetry, setPrivatePreviewRetry] = useState(0)
  const pendingReview = useRef<EvmTransferReview | null>(null)
  const reviewAttempt = useRef(new LatestAttempt())
  const { navigate } = useNavigate()
  const asset = selection.asset
  const chain = selection.chain
  const { activeAccount: catalogAccount, catalog } = useActiveAccountNetworks()
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const accountDisplayNames = useWalletStore(state => state.accountDisplayNames)
  const networkMode = useWalletStore(state => state.currentNetwork)
  const slippage = useSwapPreferences(state => state.slippage)
  const endpoints = useSettingsStore(state =>
    getChainEndpointRuntimeKey(state.chainEndpointSettings)
  )
  const effectiveAccount = resolveEffectiveActiveAccountIdentity({
    currentWalletId,
    currentAccountId,
    nativeAccount: catalogAccount
  })
  const walletId = effectiveAccount?.walletId ?? null
  const accountId = effectiveAccount?.accountId ?? null
  const activeAccount =
    catalogAccount?.walletId === walletId && catalogAccount.accountId === accountId
      ? catalogAccount
      : null
  const shieldSourceAvailable =
    getPrivateTransferChainIds(activeAccount, networkMode === 'mainnet').length > 0
  const accountDisplayName =
    activeAccount && walletId && accountId
      ? getAccountDisplayName(
          walletId,
          accountId,
          activeAccount.accountDisplayName,
          accountDisplayNames
        )
      : 'Account'
  const accountNetwork = activeAccount?.networks.find(
    network => network.chain.id === chain.chain.id
  )
  const mainSourceAddress = accountNetwork?.addresses.find(
    address => address.preferredForReceive
  )?.value
  const privateSourceAddress = accountNetwork?.privateExecutionAddress
  const bundledAsset = asset.source !== 'user-added'
  const availableRaw = resolveEvmSendAvailableRaw(asset.balance, sourceMode)
  const evmNative = portfolio.assets.find(
    candidate =>
      candidate.asset.chainId === asset.asset.chainId && candidate.asset.kind === 'native'
  )
  const nativeSymbol = evmNative?.metadata.symbol ?? 'Native asset'
  const nativeDecimals = evmNative?.metadata.decimals ?? 18
  const nativeAvailableRaw = resolveEvmSendAvailableRaw(evmNative?.balance, sourceMode)
  const tokenFeeBalanceError = getEvmTokenFeeBalanceError(
    asset.asset.kind,
    nativeAvailableRaw,
    nativeSymbol
  )
  const sourceAddress = sourceMode === 'private' ? privateSourceAddress : mainSourceAddress
  const accountContextKey = JSON.stringify([
    walletId,
    accountId,
    networkMode,
    endpoints,
    chain.chain.id,
    sourceMode,
    sourceAddress
  ])
  const support = useEvmSendSupport(chain.chain, asset.asset, accountContextKey)
  const privacyScope = `${accountContextKey}:${asset.asset.id}`
  const sendPrivately = sourceMode === 'main' && privateSendScope === privacyScope
  const route = resolveEvmSendRoute(sourceMode, support.support, sendPrivately)
  const recipientRole = resolveEvmAddressRole(
    recipient,
    chain.chain.id,
    activeAccount ? catalog?.accounts : []
  )
  const canMoveRecipient =
    Boolean(onFundPrivate) &&
    isCurrentAccountPrivateEvmAddress(recipient, chain.chain.id, activeAccount)
  const recipientName =
    selectedRecipient?.address === recipient ? selectedRecipient.name : undefined
  const restoredDraft = useRef<string | null>(null)
  useEffect(() => {
    if (!initialDraft || sourceMode !== 'main') return
    const key = JSON.stringify([privacyScope, initialDraft])
    if (restoredDraft.current === key) return
    restoredDraft.current = key
    setAmount(initialDraft.amount)
    setRecipient(initialDraft.recipient)
    setSelectedRecipient(null)
    setMaxSelected(initialDraft.maximum)
    setPrivateSendScope(privacyScope)
  }, [initialDraft, privacyScope, sourceMode])

  useEffect(() => {
    if (initialRecipient && /^0x[0-9a-fA-F]{40}$/.test(initialRecipient)) {
      setRecipient(initialRecipient)
      setSelectedRecipient(null)
    }
  }, [asset.asset.id, initialRecipient])

  useEffect(
    () => () => {
      reviewAttempt.current.invalidate()
      currentIntent.current = null
      const pending = pendingReview.current
      if (pending) void evmWalletClient.rejectTransfer(pending.graph.root.id).catch(() => {})
    },
    []
  )

  const amountRaw = useMemo(() => {
    try {
      return parseDisplayUnitAmount(amount, asset.metadata.decimals)
    } catch {
      return null
    }
  }, [amount, asset.metadata.decimals])
  const recipientPolicyError = getEvmSendRecipientError(
    sourceMode,
    recipientRole,
    sendPrivately,
    canMoveRecipient
  )
  const validRecipient =
    /^0x[0-9a-fA-F]{40}$/.test(recipient) && !/^0x0{40}$/i.test(recipient) && !recipientPolicyError
  const reviewContext = {
    contextKey: accountContextKey,
    assetId: asset.asset.id,
    assetReference: asset.asset.reference,
    decimals: asset.metadata.decimals,
    route,
    recipientRole
  }
  const intentKey = createEvmSendIntentKey({ ...reviewContext, recipient, amountRaw })
  const currentIntent = useRef<string | null>(intentKey)
  currentIntent.current = intentKey
  const handleMoveRecipient = async (targetAddress = recipient) => {
    if (
      !onFundPrivate ||
      !isCurrentAccountPrivateEvmAddress(targetAddress, chain.chain.id, activeAccount) ||
      currentIntent.current !== intentKey
    )
      return
    try {
      const latestCatalog = await accountNetworksClient.getCatalog()
      if (!latestCatalog) throw new Error('Account directory unavailable')
      const current = useWalletStore.getState()
      const latestIdentity = resolveEffectiveActiveAccountIdentity({
        currentWalletId: current.currentWalletId,
        currentAccountId: current.currentAccountId,
        nativeAccount: latestCatalog.accounts.find(account => account.active) ?? null
      })
      const latestAccount = latestCatalog.accounts.find(
        account =>
          account.walletId === latestIdentity?.walletId &&
          account.accountId === latestIdentity.accountId
      )
      if (
        currentIntent.current !== intentKey ||
        current.currentNetwork !== networkMode ||
        latestIdentity?.walletId !== walletId ||
        latestIdentity.accountId !== accountId ||
        !latestAccount?.active ||
        !isCurrentAccountPrivateEvmAddress(targetAddress, chain.chain.id, latestAccount)
      ) {
        return
      }
      onFundPrivate?.()
    } catch {
      if (currentIntent.current === intentKey) setError('Unable to verify the current account.')
    }
  }
  useEffect(() => {
    reviewAttempt.current.invalidate()
    setPreparing(false)
    setUpdatingFee(false)
    setError(null)
  }, [accountContextKey, asset.asset.id, route])
  useEffect(() => {
    if (review && review.intentKey !== intentKey) {
      reviewAttempt.current.invalidate()
      const pending = pendingReview.current
      pendingReview.current = null
      setReview(null)
      if (pending) void evmWalletClient.rejectTransfer(pending.graph.root.id).catch(() => {})
    }
  }, [intentKey, review])
  const maximumRequestKey = `${accountContextKey}:${asset.asset.id}:${recipient}:${availableRaw}:${JSON.stringify(feeSelection)}:${route}`
  const maximum = useTransferMaximum({
    prefetch: true,
    enabled:
      route !== 'pending' &&
      asset.asset.kind === 'native' &&
      validRecipient &&
      Boolean(sourceAddress) &&
      BigInt(availableRaw) > 0n,
    requestKey: maximumRequestKey,
    fallback:
      route === 'confidential'
        ? undefined
        : () =>
            fallbackTransferMaximum(
              createNativeTransferSource({
                asset,
                chain,
                availableRaw,
                sender: sourceAddress ?? ''
              })
            ),
    estimate: () =>
      route === 'confidential'
        ? estimateConfidentialTransferMaximum({
            asset,
            chain,
            availableRaw,
            sender: sourceAddress ?? '',
            recipient,
            executionMode: sourceMode,
            purpose: 'public-private-send'
          })
        : estimateNativeTransferMaximum({
            source: createNativeTransferSource({
              asset,
              chain,
              availableRaw,
              sender: sourceAddress ?? ''
            }),
            recipient,
            feeSelection,
            executionMode: sourceMode
          })
  })
  const lastMaximumRequestKey = useRef<string | null>(null)
  const requestMaximum = () => {
    lastMaximumRequestKey.current = maximumRequestKey
    void maximum.request()
  }
  const transferAvailability = resolvePortfolioTransferAvailability({
    balanceRaw: availableRaw,
    decimals: asset.metadata.decimals,
    isNative: asset.asset.kind === 'native',
    maximumRaw: maximum.value?.amountRaw ?? null
  })
  const spendableRaw = transferAvailability.amountRaw
  const validAmount = isTransferAmountSpendable(amountRaw, spendableRaw)
  const privatePreviewInputs = {
    network: networkMode,
    walletId: walletId ?? '',
    accountId: accountId ?? '',
    endpointKey: endpoints,
    portfolioWalletId: portfolio.scope.keyDomainId,
    portfolioAccountId: portfolio.scope.accountId,
    assetId: asset.asset.id,
    assetReference: asset.asset.reference,
    assetDecimals: asset.metadata.decimals,
    chainId: chain.chain.id,
    sender: sourceAddress ?? '',
    recipient,
    amountRaw: amountRaw ?? '',
    amount,
    slippage,
    feeSelectionKey: JSON.stringify(feeSelection),
    portfolio,
    chain,
    asset
  } as const
  const privatePreviewKey =
    sendPrivately &&
    route === 'confidential' &&
    networkMode === 'mainnet' &&
    validAmount &&
    validRecipient &&
    sourceAddress &&
    walletId &&
    accountId &&
    amountRaw
      ? createPublicPrivateSendPreviewKey(privatePreviewInputs)
      : null
  const latestPrivatePreviewInputs = useRef(privatePreviewInputs)
  latestPrivatePreviewInputs.current = privatePreviewInputs
  const currentPrivatePreviewKey = useRef(privatePreviewKey)
  currentPrivatePreviewKey.current = privatePreviewKey
  const privatePreviewReady = Boolean(
    privatePreviewKey &&
    privatePreview?.key === privatePreviewKey &&
    isRheaSwapQuoteFresh(privatePreview.quote)
  )
  useEffect(() => {
    if (!privatePreviewKey) {
      setPrivatePreview(null)
      setPrivatePreviewLoading(false)
      setPrivatePreviewError(null)
      return
    }
    let cancelled = false
    let heldQuoteHandle: string | null = null
    let expiryTimer: number | undefined
    setPrivatePreview(null)
    setPrivatePreviewLoading(true)
    setPrivatePreviewError(null)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const {
            walletId,
            accountId,
            sender,
            portfolio,
            chain,
            asset,
            network,
            endpointKey,
            recipient,
            amount,
            amountRaw,
            slippage,
            feeSelectionKey
          } = latestPrivatePreviewInputs.current
          const descriptor = getEnabledSwapChains([chain.chain])[0]
          if (!descriptor) throw new Error('Confidential route unavailable')
          const [catalog, targets] = await Promise.all([
            rheaSwapClient.listTokens({
              direction: 'from',
              tokenListChainIds: [descriptor.tokenListChainId]
            }),
            receiveTargetsClient.getAdditionalTargets({ keyDomainId: walletId, accountId })
          ])
          if (cancelled || currentPrivatePreviewKey.current !== privatePreviewKey) return
          if (!targets) throw new Error('Confidential route unavailable')
          const pair = resolvePublicPrivateSendQuotePair({
            assetId: asset.asset.id,
            chainId: chain.chain.id,
            sender,
            portfolio,
            receiveTargets: targets,
            sourceTokens: catalog.tokens,
            destinationTokens: catalog.tokens
          })
          const request = pair
            ? buildPublicPrivateSendPreviewRequest({
                network,
                walletId,
                accountId,
                endpointKey,
                portfolioWalletId: portfolio.scope.keyDomainId,
                portfolioAccountId: portfolio.scope.accountId,
                assetId: asset.asset.id,
                assetReference: asset.asset.reference,
                assetDecimals: asset.metadata.decimals,
                chainId: chain.chain.id,
                sender,
                recipient,
                amount,
                amountRaw,
                slippage,
                feeSelectionKey,
                sourceToken: pair.sourceToken,
                destinationToken: pair.destinationToken
              })
            : null
          if (!request || request.key !== privatePreviewKey) {
            throw new Error('Confidential route unavailable')
          }
          const quote = await rheaSwapClient.quote(request.request, 'public-private-send')
          if (cancelled || currentPrivatePreviewKey.current !== privatePreviewKey) {
            void rheaSwapClient.discard(quote.quoteHandle).catch(() => {})
            return
          }
          if (
            !isRheaSwapQuoteFresh(quote) ||
            quote.recipient.toLowerCase() !== recipient.toLowerCase()
          ) {
            void rheaSwapClient.discard(quote.quoteHandle).catch(() => {})
            throw new Error('Quote expired. Try again.')
          }
          heldQuoteHandle = quote.quoteHandle
          setPrivatePreview({
            key: request.key,
            quote,
            routeCost: getPublicPrivateSendRouteCost({
              amountInRaw: request.amountRaw,
              estimatedOutRaw: quote.estimatedOut,
              decimals: asset.metadata.decimals
            }),
            estimatedReceive: formatBaseUnitDecimalAmount(
              quote.estimatedOut,
              asset.metadata.decimals
            )
          })
          setPrivatePreviewLoading(false)
          expiryTimer = window.setTimeout(
            () => {
              if (cancelled || currentPrivatePreviewKey.current !== privatePreviewKey) return
              setPrivatePreview(null)
              setPrivatePreviewRetry(value => value + 1)
              if (heldQuoteHandle) void rheaSwapClient.discard(heldQuoteHandle).catch(() => {})
              heldQuoteHandle = null
            },
            Math.max(0, getRheaSwapQuoteDeadline(quote) - Date.now())
          )
        } catch (cause) {
          if (cancelled || currentPrivatePreviewKey.current !== privatePreviewKey) return
          setPrivatePreview(null)
          setPrivatePreviewLoading(false)
          setPrivatePreviewError(getRheaSwapErrorMessage(cause))
        }
      })()
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
      if (heldQuoteHandle) void rheaSwapClient.discard(heldQuoteHandle).catch(() => {})
    }
  }, [privatePreviewKey, privatePreviewRetry])
  const maximumPending =
    maxSelected && asset.asset.kind === 'native' && (maximum.loading || !maximum.value)
  useEffect(() => {
    if (
      maxSelected &&
      !review &&
      asset.asset.kind === 'native' &&
      route !== 'pending' &&
      validRecipient &&
      sourceAddress &&
      lastMaximumRequestKey.current !== maximumRequestKey
    )
      requestMaximum()
  }, [
    maxSelected,
    review,
    asset.asset.kind,
    maximumRequestKey,
    route,
    validRecipient,
    sourceAddress
  ])
  useEffect(() => {
    if (maxSelected && !review && maximum.value)
      setAmount(formatBaseUnitDecimalAmount(maximum.value.amountRaw, asset.metadata.decimals))
  }, [maxSelected, review, maximum.value, asset.metadata.decimals])

  const rejectPrepared = async (value: EvmTransferReview) => {
    if (pendingReview.current?.graph.root.id === value.graph.root.id) pendingReview.current = null
    await evmWalletClient.rejectTransfer(value.graph.root.id).catch(() => {})
  }

  const invalidateMaximum = () => {
    setMaxSelected(false)
  }

  const handleSelectRecipient = async () => {
    await openModal<string | undefined>({
      title: 'Send to',
      showCloseButton: true,
      className: 'max-h-[calc(100dvh-16px)] grid-rows-[auto_minmax(0,1fr)] bg-popover px-4',
      body: (resolve, close) => (
        <RecipientSelector
          chainId={chain.chain.id}
          sendingAddress={sourceAddress}
          disablePrivateExecutionAddresses
          onShieldedMove={
            sourceMode === 'main' && onFundPrivate
              ? () => {
                  close()
                  onFundPrivate()
                }
              : undefined
          }
          onSelect={(address, name) => {
            invalidateMaximum()
            if (maxSelected) setAmount('')
            setRecipient(address)
            setSelectedRecipient(name ? { address, name } : null)
            resolve(address)
          }}
        />
      )
    })
  }

  const handleMaximum = () => {
    if (!validRecipient || route === 'pending' || !sourceAddress) return
    setError(null)
    setAmount('')
    setMaxSelected(true)
    requestMaximum()
  }

  const estimateFee = useCallback(async () => {
    if (route !== 'onchain' || !amountRaw || !validAmount || !validRecipient) {
      throw new Error('Incomplete EVM transfer')
    }
    const estimate = await evmWalletClient.estimateTransferFee(
      { assetId: asset.asset.id, recipient, amountRaw },
      { feeSelection, executionMode: sourceMode }
    )
    return { amountRaw: estimate.maximumFeeWei, details: estimate }
  }, [
    amountRaw,
    asset.asset.id,
    feeSelection,
    recipient,
    sourceMode,
    route,
    validAmount,
    validRecipient
  ])
  const maximumFeeEstimate =
    route === 'onchain' &&
    maxSelected &&
    !maximum.fallbackUsed &&
    maximum.value?.evmFeeEstimate?.amountIndependent === true &&
    maximum.value?.amountRaw === amountRaw
      ? maximum.value.evmFeeEstimate
      : undefined
  const calculatedFeePreview = useTransferFeePreview({
    enabled:
      !maximumFeeEstimate &&
      route === 'onchain' &&
      Boolean(sourceAddress) &&
      validAmount &&
      validRecipient &&
      tokenFeeBalanceError === null &&
      !preparing &&
      !maximum.loading &&
      review === null,
    requestKey: `${intentKey}:${JSON.stringify(feeSelection)}`,
    estimate: estimateFee
  })
  const feePreview = maximumFeeEstimate
    ? {
        amountRaw: maximumFeeEstimate.maximumFeeWei,
        details: maximumFeeEstimate,
        loading: false
      }
    : calculatedFeePreview
  const previewFee = feePreview.amountRaw
    ? formatBaseUnitAmount(feePreview.amountRaw, nativeDecimals)
    : '—'
  const reviewedSummary = review?.value.review.summary
  const reviewedFeeEstimate =
    reviewedSummary?.schema === 'evm.transaction.v1'
      ? {
          chainId: reviewedSummary.chainId,
          maxFeePerGasWei: reviewedSummary.fields.maxFeePerGasWei,
          maxPriorityFeePerGasWei: reviewedSummary.fields.maxPriorityFeePerGasWei
        }
      : null
  const confirmationTime = useEvmConfirmationEstimate({
    enabled:
      route === 'onchain' &&
      (review !== null
        ? review.intentKey === intentKey && !updatingFee
        : !feePreview.loading && feePreview.details !== null),
    requestKey: `${accountContextKey}:${intentKey}:${JSON.stringify(feeSelection)}:${review?.value.graph.root.id ?? 'preview'}`,
    feeEstimate: review ? reviewedFeeEstimate : feePreview.details
  })
  const maximumError =
    route === 'confidential' && maximum.error ? getRheaSwapErrorMessage(maximum.error) : null
  const displayedError = error ?? tokenFeeBalanceError ?? maximumError

  const handleFormFeeSelectionChange = async (nextFeeSelection: EvmFeeSelection) => {
    if (areEvmFeeSelectionsEqual(nextFeeSelection, feeSelection)) return
    setFeeSelection(nextFeeSelection)
    if (asset.asset.kind === 'native' && maxSelected) {
      setAmount('')
      setMaxSelected(false)
    }
  }

  const handleContinue = async () => {
    if (
      route === 'pending' ||
      !sourceAddress ||
      !amountRaw ||
      !validAmount ||
      !validRecipient ||
      maximumPending ||
      preparing
    )
      return
    if (tokenFeeBalanceError) {
      setError(tokenFeeBalanceError)
      return
    }
    if (route === 'confidential') {
      if (sendPrivately) {
        if (
          !privatePreview ||
          privatePreview.key !== privatePreviewKey ||
          !isRheaSwapQuoteFresh(privatePreview.quote)
        ) {
          setPrivatePreviewError('Quote unavailable. Try again.')
          return
        }
        if (!walletId || !accountId) return
        navigate(
          buildPublicPrivateEvmSendPath({
            assetId: asset.asset.id,
            recipient,
            amount,
            maximum: maxSelected,
            walletId,
            accountId,
            network: networkMode
          })
        )
        return
      }
      navigate(
        buildPrivateEvmTransferPath({
          assetId: asset.asset.id,
          recipient,
          amount,
          maximum: maxSelected
        })
      )
      return
    }
    setPreparing(true)
    setError(null)
    const attempt = reviewAttempt.current.begin()
    try {
      const value = await evmWalletClient.prepareTransfer(
        {
          assetId: asset.asset.id,
          recipient,
          amountRaw
        },
        { feeSelection, executionMode: sourceMode }
      )
      if (!reviewAttempt.current.isCurrent(attempt) || currentIntent.current !== intentKey) {
        await rejectPrepared(value)
        return
      }
      const summary = value.review.summary
      if (
        summary.schema !== 'evm.transaction.v1' ||
        summary.fields.from.toLowerCase() !== sourceAddress.toLowerCase()
      ) {
        await rejectPrepared(value)
        setError('The wallet returned an invalid EVM review.')
        return
      }
      const feeRaw = summary.fields.maximumFeeWei
      const balanceError = getEvmTransferBalanceError({
        assetKind: asset.asset.kind,
        transferAmountRaw: amountRaw,
        maximumFeeRaw: feeRaw,
        assetAvailableRaw: availableRaw,
        nativeAvailableRaw,
        nativeSymbol
      })
      if (balanceError) {
        await rejectPrepared(value)
        setError(balanceError)
        return
      }
      pendingReview.current = value
      setReview({
        intentKey,
        sourceMode,
        sourceAddress,
        privacyWarning: getEvmSendPrivacyWarning(sourceMode, recipientRole),
        amount,
        amountRaw,
        recipient,
        feeSelection,
        value
      })
    } catch (prepareError) {
      if (reviewAttempt.current.isCurrent(attempt) && currentIntent.current === intentKey)
        setError(getEvmSendPrepareError(prepareError, sourceMode))
    } finally {
      if (reviewAttempt.current.isCurrent(attempt)) setPreparing(false)
    }
  }

  const handleCloseReview = async () => {
    reviewAttempt.current.invalidate()
    setUpdatingFee(false)
    const current = review
    setReview(null)
    if (current) await rejectPrepared(current.value)
  }

  const handleReviewFeeSelectionChange = async (nextFeeSelection: EvmFeeSelection) => {
    const current = review
    if (
      !current ||
      current.intentKey !== currentIntent.current ||
      areEvmFeeSelectionsEqual(nextFeeSelection, current.feeSelection)
    )
      return

    setUpdatingFee(true)
    setError(null)
    const attempt = reviewAttempt.current.begin()
    let probe: EvmTransferReview | null = null
    let replacement: EvmTransferReview | null = null
    try {
      let nextAmountRaw = current.amountRaw
      if (asset.asset.kind === 'native' && maxSelected) {
        const availableAmountRaw = BigInt(availableRaw)
        const probeAmountRaw =
          availableAmountRaw / 2n > 0n ? availableAmountRaw / 2n : availableAmountRaw
        probe = await evmWalletClient.prepareTransfer(
          {
            assetId: asset.asset.id,
            recipient: current.recipient,
            amountRaw: probeAmountRaw.toString()
          },
          { feeSelection: nextFeeSelection, executionMode: current.sourceMode }
        )
        if (probe.review.summary.schema !== 'evm.transaction.v1') {
          throw new Error('The wallet returned an invalid EVM review.')
        }
        nextAmountRaw = resolveEvmNativeMaximumAmount(
          availableRaw,
          probe.review.summary.fields.maximumFeeWei
        )
      }

      replacement = await evmWalletClient.prepareTransfer(
        { assetId: asset.asset.id, recipient: current.recipient, amountRaw: nextAmountRaw },
        { feeSelection: nextFeeSelection, executionMode: current.sourceMode }
      )
      const nextSummary = replacement.review.summary
      if (
        nextSummary.schema !== 'evm.transaction.v1' ||
        nextSummary.fields.from.toLowerCase() !== current.sourceAddress.toLowerCase()
      ) {
        throw new Error('The wallet returned an invalid EVM review.')
      }
      const balanceError = getEvmTransferBalanceError({
        assetKind: asset.asset.kind,
        transferAmountRaw: nextAmountRaw,
        maximumFeeRaw: nextSummary.fields.maximumFeeWei,
        assetAvailableRaw: availableRaw,
        nativeAvailableRaw,
        nativeSymbol
      })
      if (balanceError) throw new Error(balanceError)

      if (probe) {
        await evmWalletClient.rejectTransfer(probe.graph.root.id).catch(() => {})
        probe = null
      }
      await rejectPrepared(current.value)
      if (
        !reviewAttempt.current.isCurrent(attempt) ||
        currentIntent.current !== current.intentKey
      ) {
        await rejectPrepared(replacement)
        replacement = null
        return
      }
      pendingReview.current = replacement
      const nextAmount = formatBaseUnitDecimalAmount(nextAmountRaw, asset.metadata.decimals)
      setAmount(nextAmount)
      setFeeSelection(nextFeeSelection)
      setReview({
        ...current,
        intentKey: createEvmSendIntentKey({
          ...reviewContext,
          recipient: current.recipient,
          amountRaw: nextAmountRaw
        }),
        amount: nextAmount,
        amountRaw: nextAmountRaw,
        recipient: current.recipient,
        feeSelection: nextFeeSelection,
        value: replacement
      })
      replacement = null
    } catch (cause) {
      if (probe) await evmWalletClient.rejectTransfer(probe.graph.root.id).catch(() => {})
      if (replacement) {
        await evmWalletClient.rejectTransfer(replacement.graph.root.id).catch(() => {})
      }
      const message =
        cause instanceof Error ? cause.message : getEvmSendPrepareError(cause, sourceMode)
      if (reviewAttempt.current.isCurrent(attempt) && currentIntent.current === current.intentKey) {
        setError(message)
        throw new Error(message)
      }
    } finally {
      if (reviewAttempt.current.isCurrent(attempt)) setUpdatingFee(false)
    }
  }

  const handleApprove = async () => {
    if (!review || review.intentKey !== currentIntent.current || updatingFee || approving) return
    if (Date.now() >= review.value.review.expiresAt) {
      pendingReview.current = null
      setReview(null)
      setError('The review expired. Prepare the transfer again.')
      return
    }
    setApproving(true)
    setError(null)
    recordSendSubmission(review.value.graph, selection.asset.metadata.symbol, review.sourceMode)
    try {
      const submission = await evmWalletClient.approveTransfer(
        review.value.graph.root.id,
        review.value.review.payloadFingerprint.digestHex
      )
      pendingReview.current = null
      setReview(null)
      if (submission.status === 'external-signature-required') {
        try {
          await openHardwareEvmSignTab(submission.transactionId)
        } catch (handoffError) {
          await evmWalletClient.rejectTransfer(submission.transactionId).catch(() => {})
          throw handoffError
        }
        window.close()
        return
      }
      recordSendResult(submission.graph, selection.asset.metadata.symbol, review.sourceMode)
      onSubmitted(submission)
    } catch (approveError) {
      recordSendApprovalFailure(
        review.value.graph,
        selection.asset.metadata.symbol,
        review.sourceMode
      )
      if (
        approveError instanceof EvmWalletClientError &&
        (approveError.code === 'expired' || approveError.code === 'review-unavailable')
      ) {
        pendingReview.current = null
        setReview(null)
      }
      setError(getEvmSendPrepareError(approveError, review.sourceMode))
    } finally {
      setApproving(false)
    }
  }

  const summary = review?.value.review.summary
  const feeRaw = summary?.schema === 'evm.transaction.v1' ? summary.fields.maximumFeeWei : '0'
  const fee = formatBaseUnitAmount(feeRaw, nativeDecimals)
  const maximumTotal =
    review && asset.asset.kind === 'native'
      ? formatBaseUnitAmount((BigInt(review.amountRaw) + BigInt(feeRaw)).toString(), nativeDecimals)
      : null
  const reviewFiat = review ? formatSendFiatValue(review.amount, priceUsd) : null
  const privateRouteCostFiat =
    privatePreviewReady && privatePreview && privatePreview.routeCost !== null
      ? formatSendFiatValue(privatePreview.routeCost, priceUsd)
      : null

  const changePrivacyRoute = (scope: string | null) => {
    if (maxSelected && asset.asset.kind === 'native') setAmount('')
    setPrivateSendScope(scope)
    setError(null)
  }

  return (
    <>
      <div className="page-content min-h-0 space-y-4 !px-4 pt-4">
        <SendSourceSection
          domain="public"
          availableDomains={shieldSourceAvailable ? ['public', 'shield'] : ['public']}
          onDomainChange={domain => {
            if (domain === 'shield') onSelectShield(validRecipient ? recipient : '')
          }}
          amountInput={
            <SendAmountInputCard
              ariaLabel={`${asset.metadata.symbol} amount`}
              value={amount}
              onChange={value => {
                if (/^\d*\.?\d*$/.test(value)) {
                  invalidateMaximum()
                  setAmount(value)
                }
              }}
              available={transferAvailability.display}
              symbol={asset.metadata.symbol}
              priceUsd={priceUsd}
              hero
            />
          }
          assetSelector={
            <SendAssetHeader
              assetId={asset.asset.id}
              symbol={asset.metadata.symbol}
              icon={asset.metadata.iconUrl}
              networkName={chain.chain.displayName}
              blockchain={resolveChainIconAlias(
                chain.chain.family,
                chain.chain.displayName,
                chain.chain.id
              )}
              onSelectAsset={onSelectAsset}
              variant="pill"
            />
          }
          balance={
            <span
              data-testid="send-available-balance"
              className="min-w-0 truncate"
              title={transferAvailability.display}
            >
              {formatTokenQuantity(transferAvailability.display)}
            </span>
          }
          maxButton={
            <button
              type="button"
              aria-label="Max"
              aria-pressed={maxSelected}
              disabled={
                route === 'pending' ||
                !sourceAddress ||
                BigInt(availableRaw) <= 0n ||
                (asset.asset.kind === 'native' && !validRecipient) ||
                maximum.loading
              }
              onClick={
                asset.asset.kind === 'token'
                  ? () => {
                      setError(null)
                      setMaxSelected(true)
                      setAmount(transferAvailability.display)
                    }
                  : handleMaximum
              }
              className="rounded-md bg-primary/15 px-2 py-1 font-medium text-primary disabled:opacity-40"
            >
              Max
            </button>
          }
        />

        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted">Send to</span>
            {!sendPrivately && destinationNetworks.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-foreground hover:text-primary"
                    aria-label={`Select destination network, ${chain.chain.displayName}`}
                  >
                    <ChainIcon
                      chain={resolveChainIconAlias(
                        chain.chain.family,
                        chain.chain.displayName,
                        chain.chain.id
                      )}
                      width={16}
                      height={16}
                      className="rounded-[4px]"
                      showTooltip={false}
                    />
                    {chain.chain.displayName}
                    <Icon icon="lucide:chevron-down" width={13} height={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[150px]">
                  <DropdownMenuRadioGroup
                    value={asset.asset.id}
                    onValueChange={destinationAssetId =>
                      onSelectDestinationNetwork(destinationAssetId, {
                        recipient,
                        amount: maxSelected ? '' : amount
                      })
                    }
                  >
                    {destinationNetworks.map(option => (
                      <DropdownMenuRadioItem key={option.assetId} value={option.assetId}>
                        <ChainIcon
                          chain={option.icon}
                          width={16}
                          height={16}
                          className="rounded-[4px]"
                          showTooltip={false}
                        />
                        {option.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <ChainIcon
                  chain={resolveChainIconAlias(
                    chain.chain.family,
                    chain.chain.displayName,
                    chain.chain.id
                  )}
                  width={16}
                  height={16}
                  className="rounded-[4px]"
                  showTooltip={false}
                />
                {chain.chain.displayName}
              </span>
            )}
          </div>
          <SendRecipientInputCard
            id="evm-send-recipient"
            value={recipient}
            selectedName={recipientName}
            onChange={value => {
              invalidateMaximum()
              if (maxSelected) setAmount('')
              setRecipient(value.trim())
              setSelectedRecipient(null)
            }}
            placeholder="Enter address"
            variant="filled"
            hideLabel
            onSelectRecipient={() => void handleSelectRecipient()}
          />
          {recipient && !validRecipient && (
            <div className="mt-2 flex items-start justify-between gap-3 px-1 text-xs text-danger">
              <p className="min-w-0 flex-1">
                {recipientPolicyError ?? 'Enter a valid non-zero EVM address.'}
              </p>
              {canMoveRecipient && recipientPolicyError && (
                <button
                  type="button"
                  onClick={() => void handleMoveRecipient()}
                  className="inline-flex shrink-0 items-center gap-1 font-medium text-primary"
                >
                  <Icon icon="lucide:arrow-right-left" width={13} height={13} aria-hidden="true" />
                  Move
                </button>
              )}
            </div>
          )}
        </div>

        {sendPrivately && (
          <div className="space-y-3 text-sm">
            <div className="flex min-h-6 items-center gap-2">
              <Icon
                icon="lucide:shield-check"
                width={17}
                height={17}
                className="shrink-0 text-primary"
              />
              <span className="min-w-0 leading-5">Your transaction will go through Shield</span>
              {sendPrivately && privatePreviewLoading && (
                <Icon
                  icon="lucide:loader-circle"
                  width={14}
                  height={14}
                  className="ml-auto animate-spin text-muted"
                />
              )}
            </div>
            <div className="text-xs">
              <span className="text-muted">Provider</span>
              <div className="mt-2 rounded-lg border border-white/10 bg-wallet-surface px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <img src={nearLogo} alt="" className="size-5 shrink-0 rounded" />
                  <span className="min-w-0 flex-1 truncate">NEAR Confidential Intents</span>
                  <span className="min-w-0 max-w-[40%] text-right">
                    {privatePreviewReady && privatePreview ? (
                      <AmountDisplay
                        value={privatePreview.estimatedReceive}
                        symbol={asset.metadata.symbol}
                      />
                    ) : (
                      '—'
                    )}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 text-muted">
                  <div>
                    Est. time <span className="text-foreground">—</span>
                  </div>
                  <div className="text-right">
                    Network fee <span className="text-foreground">—</span>
                  </div>
                </div>
                {privatePreviewReady && privatePreview && (
                  <div className="mt-2 flex justify-between gap-3 border-t border-white/10 pt-2">
                    <span className="text-muted">Route cost</span>
                    <span className="min-w-0 max-w-[65%] text-right">
                      {privateRouteCostFiat ? (
                        `~${privateRouteCostFiat}`
                      ) : privatePreview.routeCost === null ? (
                        '—'
                      ) : (
                        <AmountDisplay
                          value={privatePreview.routeCost}
                          symbol={asset.metadata.symbol}
                          profile="fee"
                        />
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {sendPrivately && privatePreviewError && (
          <InlineError
            message={privatePreviewError}
            onRetry={() => setPrivatePreviewRetry(current => current + 1)}
            className="px-1"
          />
        )}

        {route === 'onchain' && (
          <div className="space-y-3 rounded-lg border border-white/15 px-4 py-3">
            <div className="flex min-h-6 items-center justify-between gap-2 text-xs">
              <span className="text-muted">Fee</span>
              <NetworkFeeTierPicker
                chainFamily="evm"
                tier={feeSelection.kind === 'tier' ? feeSelection.tier : 'standard'}
                selection={feeSelection}
                amount={previewFee}
                symbol={nativeSymbol}
                layout="inline"
                onTierChange={tier => handleFormFeeSelectionChange({ kind: 'tier', tier })}
                onSelectionChange={handleFormFeeSelectionChange}
              />
            </div>
            <div className="flex min-h-6 items-center justify-between gap-2 text-xs">
              <span className="text-muted">Est. time</span>
              <span title="Estimated first confirmation based on recent blocks.">
                {confirmationTime}
              </span>
            </div>
          </div>
        )}

        {amountRaw !== null && BigInt(amountRaw) > BigInt(availableRaw) && (
          <p role="alert" className="mt-3 text-xs text-danger">
            Insufficient {asset.metadata.symbol} balance.
          </p>
        )}
        {displayedError && (
          <InlineError
            message={displayedError}
            onRetry={maximumError ? handleMaximum : undefined}
            className="mt-3 px-1"
          />
        )}
        {route === 'pending' &&
          (support.loading ? (
            <p role="status" className="px-1 text-xs text-muted">
              Checking Confidential availability…
            </p>
          ) : (
            <InlineError
              message={
                support.support === 'unsupported'
                  ? 'Confidential transfers are unavailable for this asset.'
                  : 'Unable to check Confidential availability.'
              }
              onRetry={support.retry}
              className="px-1"
            />
          ))}
      </div>

      <div className="page-footer">
        <button
          type="button"
          role="switch"
          aria-label="Send privately"
          aria-checked={sendPrivately}
          disabled={networkMode !== 'mainnet' || support.support === 'unsupported'}
          onClick={() => changePrivacyRoute(sendPrivately ? null : privacyScope)}
          className={`mb-4 flex w-full items-center justify-center gap-1.5 text-sm disabled:opacity-40 ${sendPrivately ? 'text-primary' : 'text-muted'}`}
        >
          <Icon icon="lucide:shield-check" width={15} height={15} className="text-primary" />
          Send privately
          <Switch checked={sendPrivately} size="sm" />
        </button>
        <Button
          size="wallet"
          className="h-[45px] w-full"
          disabled={
            !validAmount ||
            !validRecipient ||
            maximumPending ||
            !sourceAddress ||
            route === 'pending' ||
            (sendPrivately && !privatePreviewReady) ||
            tokenFeeBalanceError !== null ||
            (route === 'onchain' && feePreview.loading)
          }
          isLoading={preparing || (route === 'onchain' && feePreview.loading)}
          onClick={handleContinue}
        >
          Continue
        </Button>
      </div>

      <Dialog
        open={review !== null}
        onOpenChange={open => {
          if (!open && !approving) void handleCloseReview()
        }}
      >
        <DialogContent
          position="bottom"
          data-wallet-mode={walletMode}
          className="flex h-dvh max-h-dvh flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none"
          showCloseButton={false}
          aria-labelledby="evm-send-review-title"
        >
          <DialogTitle className="sr-only" aria-hidden="true">
            Review Send
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review the asset, recipient, and maximum network fee before sending.
          </DialogDescription>

          {review && summary?.schema === 'evm.transaction.v1' && (
            <TransactionReviewView
              title="Sending"
              titleId="evm-send-review-title"
              variant="figma"
              asset={{
                assetId: asset.asset.id,
                symbol: asset.metadata.symbol,
                icon: asset.metadata.iconUrl
              }}
              amount={review.amount}
              fiatValue={reviewFiat}
              network={formatPortfolioNetworkName(chain)}
              notice={
                review.privacyWarning || (summary.review.level === 'caution' && !bundledAsset) ? (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-surface px-3 py-2.5 text-xs leading-5 text-warning">
                    <Icon
                      icon="lucide:triangle-alert"
                      width={15}
                      height={15}
                      className="mt-0.5 shrink-0"
                    />
                    <span>
                      {review.privacyWarning}
                      {summary.review.level === 'caution' && !bundledAsset && (
                        <>
                          {review.privacyWarning ? ' ' : ''}This transfer calls a custom Token
                          contract you added. Verify the network, Token, and recipient.
                        </>
                      )}
                    </span>
                  </div>
                ) : undefined
              }
              rows={[
                {
                  label: 'From',
                  content: (
                    <span className="inline-flex min-w-0 max-w-full items-center justify-end gap-1.5">
                      <span className="min-w-0 text-right">
                        <span className="block truncate">{accountDisplayName}</span>
                        <span
                          className="block truncate font-mono text-xs text-muted"
                          title={summary.fields.from}
                        >
                          {formatSortAddress(summary.fields.from)}
                        </span>
                      </span>
                      <ExecutionAccountBadge mode={review.sourceMode} />
                    </span>
                  )
                },
                {
                  label: 'To',
                  content: <SendRecipientAddress address={review.recipient} name={recipientName} />
                },
                { label: 'Network', content: formatPortfolioNetworkName(chain) },
                {
                  label: 'Network fee',
                  content: (
                    <NetworkFeeTierPicker
                      chainFamily="evm"
                      tier={
                        review.feeSelection.kind === 'tier' ? review.feeSelection.tier : 'standard'
                      }
                      selection={review.feeSelection}
                      amount={fee}
                      symbol={nativeSymbol}
                      onTierChange={tier => handleReviewFeeSelectionChange({ kind: 'tier', tier })}
                      onSelectionChange={handleReviewFeeSelectionChange}
                      disabled={updatingFee || approving}
                      details={
                        <div className="space-y-2 border-t border-border/60 pt-3 text-xs">
                          <div className="flex justify-between gap-3">
                            <span className="text-muted">Max fee per gas</span>
                            <AmountDisplay
                              value={formatEvmWeiAsGwei(summary.fields.maxFeePerGasWei ?? '0')}
                              symbol="GWEI"
                              profile="fee"
                            />
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-muted">Priority fee per gas</span>
                            <AmountDisplay
                              value={formatEvmWeiAsGwei(
                                summary.fields.maxPriorityFeePerGasWei ?? '0'
                              )}
                              symbol="GWEI"
                              profile="fee"
                            />
                          </div>
                        </div>
                      }
                    />
                  )
                },
                {
                  label: 'Est. confirmation',
                  content: (
                    <span title="Estimated first confirmation based on recent blocks.">
                      {confirmationTime}
                    </span>
                  )
                },
                ...(maximumTotal
                  ? [
                      {
                        label: 'Maximum total',
                        content: <AmountDisplay value={maximumTotal} symbol={nativeSymbol} />
                      }
                    ]
                  : [])
              ]}
              confirmLabel={review.privacyWarning ? 'Send anyway' : 'Send'}
              confirming={approving}
              preparing={updatingFee}
              confirmDisabled={review.intentKey !== intentKey}
              error={error ? <InlineError message={error} className="mt-3" /> : undefined}
              cancelDisabled={approving}
              onCancel={() => void handleCloseReview()}
              onConfirm={handleApprove}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
