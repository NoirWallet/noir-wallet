import { ZEC_ZCASH_ASSET } from '@/config/intents'
import { Switch } from '../../components/ui/switch'
import {
  buildPublicPrivateEvmSendPath,
  parsePublicPrivateEvmSendDraft,
  isPublicPrivateSendRecipient
} from './evm-send-validation'
import { rheaSwapClient, getRheaSwapErrorMessage } from '@/popup/services/rhea-swap-client'
import { isRheaSwapQuoteFresh, getRheaSwapQuoteDeadline } from '@/popup/services/swap-page-model'
import type { RheaSwapQuoteView } from '@/core/services/rhea-swap'
import {
  buildZcashPublicPrivateSendPreviewRequest,
  getPublicPrivateSendRouteCost
} from '@/popup/services/public-private-send-preview'
import { isZcashHardwareKeySource } from '@/core/wallet/hardware-wallet-data'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { ShieldFundsBanner } from '../../components/transaction/ShieldFundsBanner'
import { openModal } from '../../provider/ModalManager'
import { RecipientSelector } from '../../components/transaction/RecipientSelector'
import { InlineError } from '@/popup/components/common/InlineError'
import {
  SendAmountInputCard,
  SendAmountRow,
  SendAssetHeader,
  SendFieldLabel,
  SendRouteInfoCard,
  SendRecipientAddress,
  SendRecipientInputCard
} from '../../components/transaction/SendInputCards'
import { openHardwareSignAndWait, openHardwareSignTab } from '@/lib/hardware-tab'
import { isSidePanelSurface } from '@/lib/extension-display-mode'
import { toast } from '@/store/toast-store'
import { classifyError } from '@/lib/errors'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent, type TrackOptions } from '@/lib/analytics'

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { useTransactionResultStore } from '@/store/transaction-result-store'
import { useLocation, useNavigate } from '../../provider/Router'
import { formatSortAddress, getAccountDisplayName } from '@/lib/format'
import {
  formatFiatAmount,
  formatBaseUnitDecimalAmount,
  formatTokenQuantity
} from '@/lib/number-format'
import { cn } from '@/lib/utils'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { TransactionReviewView } from '@/popup/components/transaction/TransactionReviewView'
import { BalanceDomainTabs } from '@/popup/components/account/BalanceDomainTabs'
import { TokenIcon } from '../../components/tokens/TokenIcon'
import { ChainIcon } from '../../components/common/ChainIcon'
import nearLogo from '@/images/figma-near-confidential.svg'
import zcashShieldLogo from '@/images/figma-zcash-shield.svg'
import { useTransaction } from '../../hooks/useTransaction'
import { useShieldFunds } from '../../hooks/useShieldFunds'
import { useFeeEstimate } from '../../hooks/useFeeEstimate'
import { useMaxTransferEstimate } from '../../hooks/useMaxTransferEstimate'
import { FeeTierPicker } from '../../components/transaction/FeeTierPicker'
import { useSettingsStore } from '@/store/settings-store'
import { marginalFeeForTier, staticFeeFallbackZats } from '@/core/zcash/fee-policy'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import { resolveZcashFundingAvailability } from '@/popup/services/transfer-availability'
import {
  getFundingBalance,
  getFundingAmountError,
  getFundingAmountErrorCopy
} from '@/core/wallet/funding-balance'
import {
  getFundingSourceOptions,
  getFundingSourceUnavailableReason
} from '@/core/wallet/funding-source'
import type { FundingSource } from '@/types'
import { safeBig } from '@/lib/big'

import { ZEC_DECIMALS } from '@/config/wallet'
import { useZnsResolve } from '../../hooks/useZnsResolve'
import {
  isTransparentZcashAddress,
  sanitizeMemoForRecipient,
  supportsZcashMemo
} from '@/lib/zcash-memo'
import {
  getShieldableTransparentBalance,
  hasEnoughTransparentBalanceToShield,
  MIN_SHIELDING_BALANCE_MESSAGE
} from '@/core/zcash/shielding'
import {
  assertActiveAccountScope,
  getActiveAccountScopeKey
} from '@/popup/lib/active-account-scope'
import { getZcashChainId } from '@/core/chains/registry'
import { resolveZcashSelfMove } from '@/popup/services/zcash-self-move'
import {
  estimateConfidentialSendTime,
  estimateZcashSendTime
} from '@/popup/services/send-time-estimate'
import {
  getZcashTransparentToShieldMoveAmountError,
  isZcashSendRecipientReady,
  resolveZcashSendRecipientInput,
  shouldRetainZcashSendRecipient
} from './zcash-send-validation'

function MoveLayout({
  amount,
  balance,
  max,
  accountName,
  fromAddress,
  toAddress,
  from,
  onReverse
}: {
  amount: ReactNode
  balance: string
  max: ReactNode
  accountName: string
  fromAddress: string
  toAddress: string
  from: FundingSource
  onReverse: () => void
}) {
  const accountCard = (label: 'From' | 'To', source: FundingSource, address: string) => (
    <div className="min-w-0 rounded-xl border border-white/5 bg-wallet-surface px-4 py-4">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-3 flex min-w-0 items-center gap-3">
        {source === 'shielded' ? (
          <img src={zcashShieldLogo} alt="" className="size-8 shrink-0 rounded" />
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-muted">
            <Icon icon="lucide:wallet" width={19} height={19} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <span className="truncate" title={source === 'shielded' ? 'Shield' : accountName}>
              {source === 'shielded' ? 'Shield' : accountName}
            </span>
            {source === 'transparent' && (
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-muted">
                Transparent
              </span>
            )}
          </div>
          <span className="mt-1 block truncate text-base font-medium" title={address}>
            {source === 'shielded'
              ? 'Zcash Shield'
              : address
                ? formatSortAddress(address)
                : 'Address unavailable'}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="flex min-w-0 flex-col items-center pb-6 pt-5 text-center">
        {amount}
        <span className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-wallet-surface px-2.5 text-base font-medium">
          <TokenIcon symbol="ZEC" nativeChain="zcash" blockchain="zec" size={26} />
          ZEC
        </span>
        <div className="mt-4 flex min-w-0 items-center justify-center gap-3 text-xs text-muted">
          <span className="min-w-0 truncate" title={balance}>
            {formatTokenQuantity(balance)}
          </span>
          {max}
        </div>
      </div>
      <div>
        {accountCard('From', from, fromAddress)}
        <div className="relative h-2.5">
          <button
            type="button"
            aria-label="Switch move direction"
            title="Switch move direction"
            onClick={onReverse}
            className="absolute left-1/2 top-1/2 z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border border-white/10 bg-card text-foreground transition-colors hover:bg-wallet-selected"
          >
            <Icon icon="lucide:arrow-down-up" width={18} height={18} />
          </button>
        </div>
        {accountCard('To', from === 'transparent' ? 'shielded' : 'transparent', toAddress)}
      </div>
    </>
  )
}

export function Send({
  active = true,
  embedded = false,
  initialFundingSource = 'transparent',
  fundingSourceSelection,
  onSelectAsset
}: {
  readonly active?: boolean
  readonly embedded?: boolean
  readonly initialFundingSource?: FundingSource
  readonly fundingSourceSelection?: Readonly<{ source: FundingSource; revision: number }> | null
  readonly onSelectAsset?: (fundingSource: FundingSource) => void
} = {}) {
  const { goBack, navigate } = useNavigate()
  const location = useLocation()
  const routeParams = new URLSearchParams(location.search)
  const isSelfMove = routeParams.get('move') === '1'
  const moveSource =
    routeParams.get('from') === 'transparent' || routeParams.get('from') === 'shielded'
      ? (routeParams.get('from') as FundingSource)
      : null
  const walletMode = 'public' as const
  const routeIdentity = JSON.stringify([isSelfMove, routeParams.get('from'), walletMode])
  const previousRouteIdentity = useRef(routeIdentity)
  const [selectedFundingSource, setFundingSource] = useState<FundingSource>(() => {
    const source = routeParams.get('from')
    return source === 'shielded' || source === 'transparent' ? source : initialFundingSource
  })
  const [privateSendScope, setPrivateSendScope] = useState<string | null>(null)
  const [privatePreview, setPrivatePreview] = useState<{
    key: string
    quote: RheaSwapQuoteView
    amountRaw: string
  } | null>(null)
  const [privatePreviewError, setPrivatePreviewError] = useState<string | null>(null)
  const [privatePreviewRetry, setPrivatePreviewRetry] = useState(0)
  const [toAddress, setToAddress] = useState('')
  const [selectedRecipient, setSelectedRecipient] = useState<{
    address: string
    name: string
  } | null>(null)
  const [amount, setAmount] = useState('')
  const [maxSelected, setMaxSelected] = useState(false)
  const [memo, setMemo] = useState('')
  const [showReview, setShowReview] = useState(false)
  const [isHardwareSigning, setIsHardwareSigning] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const confirmationInFlight = useRef(false)
  const activeRef = useRef(active)
  activeRef.current = active
  const appliedFundingSourceRevision = useRef<number | null>(null)
  const {
    isShielding: isMigrating,
    handleShieldFunds: handleMigrateNow,
    shieldSheet: migrateSheet
  } = useShieldFunds(PAGE_IDS.SEND)

  const currentAccount = useWalletStore(state => state.getCurrentAccount())
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const accountDisplayNames = useWalletStore(state => state.accountDisplayNames)
  const activeScopeRef = useRef<string | null | undefined>(undefined)
  const balance = useAccountDataStore(state => state.getCurrentBalance())
  const syncState = useAccountDataStore(state =>
    currentWalletId
      ? state.getWalletSyncState(currentNetwork, currentWalletId)
      : { isSyncing: false, currentHeight: 0, latestHeight: 0 }
  )
  const zecPrice = useWalletStore(state => state.zecPrice)
  const { setResult, updateStep } = useTransactionResultStore()

  const currentWallet = useWalletStore(state => state.getCurrentWallet())
  const accountDisplayName = getAccountDisplayName(
    currentWalletId ?? currentWallet?.id ?? '',
    currentAccountId ?? currentAccount?.id ?? '',
    currentAccount?.name ?? 'Account',
    accountDisplayNames
  )
  const isHardwareWallet = isZcashHardwareKeySource(currentWallet?.keySource)
  const fundingSource = isSelfMove
    ? (moveSource ?? 'transparent')
    : getFundingSourceUnavailableReason(currentWallet?.keySource, selectedFundingSource)
      ? 'shielded'
      : selectedFundingSource
  const isTransparentToShieldMove = isSelfMove && fundingSource === 'transparent'
  const resultReturnPath = `${embedded ? '/send/zcash' : location.pathname}?${new URLSearchParams({
    ...(isSelfMove ? { move: '1' } : {}),
    from: fundingSource,
    mode: walletMode
  })}`
  const selfMove = isSelfMove
    ? resolveZcashSelfMove(currentAccount?.addresses, fundingSource, currentNetwork)
    : null
  const moveUnavailable =
    isSelfMove &&
    (!selfMove ||
      Boolean(getFundingSourceUnavailableReason(currentWallet?.keySource, fundingSource)))

  const { sendTransaction } = useTransaction()

  const recipientInput = resolveZcashSendRecipientInput(toAddress, currentNetwork)
  const zns = useZnsResolve(active && !isSelfMove ? recipientInput.znsInput : '')
  const effectiveToAddress = isSelfMove
    ? (selfMove?.toAddress ?? '')
    : recipientInput.formatError
      ? ''
      : zns.address || recipientInput.resolvedAddress
  const recipientFormatError = isSelfMove ? null : recipientInput.formatError

  const feeTier = useSettingsStore(state => state.feeTier)
  const setFeeTier = useSettingsStore(state => state.setFeeTier)

  const fromAddress = currentAccount?.addresses[fundingSource] || ''
  const sourceBalance = getFundingBalance(balance, fundingSource)
  const fundingOptions = getFundingSourceOptions(
    balance,
    currentAccount?.addresses ?? {},
    currentWallet?.keySource
  )
  const transparentBalance = safeBig(getShieldableTransparentBalance(balance)).toNumber()
  const shieldableBalance = getShieldableTransparentBalance(balance)

  const reverseMove = () => {
    if (!isSelfMove) return
    setShowReview(false)
    setToAddress('')
    setSelectedRecipient(null)
    setAmount('')
    setMaxSelected(false)
    setMemo('')
    const params = new URLSearchParams({
      move: '1',
      from: fundingSource === 'transparent' ? 'shielded' : 'transparent',
      mode: walletMode
    })
    navigate(`/send/zcash?${params.toString()}`, { replace: true })
  }

  const recipientSupportsMemo = supportsZcashMemo(effectiveToAddress)
  const effectiveMemo = isSelfMove ? '' : sanitizeMemoForRecipient(effectiveToAddress, memo)
  const privacyScope = JSON.stringify([currentNetwork, currentWalletId, currentAccountId])
  const privateSendAvailable =
    !isSelfMove &&
    currentNetwork === 'mainnet' &&
    fundingSource === 'transparent' &&
    (!effectiveToAddress || isTransparentZcashAddress(effectiveToAddress)) &&
    !getFundingSourceUnavailableReason(currentWallet?.keySource, 'transparent')
  const sendPrivately = privateSendAvailable && privateSendScope === privacyScope
  const previewKey =
    active &&
    sendPrivately &&
    currentWalletId &&
    currentAccountId &&
    fromAddress &&
    isPublicPrivateSendRecipient(ZEC_ZCASH_ASSET, effectiveToAddress) &&
    safeBig(amount || '0').gt(0) &&
    safeBig(amount || '0').lte(sourceBalance.available)
      ? JSON.stringify([privacyScope, fromAddress, effectiveToAddress, amount, feeTier])
      : null
  const currentPreviewKey = useRef(previewKey)
  currentPreviewKey.current = previewKey
  const privatePreviewReady = Boolean(
    previewKey && privatePreview?.key === previewKey && isRheaSwapQuoteFresh(privatePreview.quote)
  )
  useEffect(() => {
    if (isSelfMove || !currentWalletId || !currentAccountId) return
    const draft = parsePublicPrivateEvmSendDraft(new URLSearchParams(location.search), {
      walletId: currentWalletId,
      accountId: currentAccountId,
      network: currentNetwork,
      assetId: ZEC_ZCASH_ASSET
    })
    if (!draft) return
    setFundingSource('transparent')
    setToAddress(draft.recipient)
    setAmount(draft.amount)
    setMaxSelected(draft.maximum)
    setPrivateSendScope(privacyScope)
  }, [location.search, currentWalletId, currentAccountId, currentNetwork, isSelfMove, privacyScope])
  useEffect(() => {
    setPrivatePreview(null)
    setPrivatePreviewError(null)
    if (!previewKey) return
    let cancelled = false
    let quoteHandle: string | null = null
    let expiryTimer: number | undefined
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const [source, destination] = await Promise.all([
            rheaSwapClient.listTokens({ direction: 'from', tokenListChainIds: [900010] }),
            rheaSwapClient.listTokens({ direction: 'cross-chain-to', tokenListChainIds: [900010] })
          ])
          if (cancelled) return
          const request = buildZcashPublicPrivateSendPreviewRequest({
            sourceTokens: source.tokens,
            destinationTokens: destination.tokens,
            amount,
            slippage: 1,
            sender: fromAddress,
            recipient: effectiveToAddress
          })
          if (!request) throw new Error('Confidential route unavailable')
          const quote = await rheaSwapClient.quote(request.request, 'public-private-send')
          if (cancelled || currentPreviewKey.current !== previewKey) {
            void rheaSwapClient.discard(quote.quoteHandle).catch(() => {})
            return
          }
          quoteHandle = quote.quoteHandle
          if (!isRheaSwapQuoteFresh(quote) || quote.recipient !== effectiveToAddress)
            throw new Error('Quote expired. Try again.')
          setPrivatePreview({ key: previewKey, quote, amountRaw: request.amount })
          expiryTimer = window.setTimeout(
            () => {
              if (cancelled || currentPreviewKey.current !== previewKey) return
              setPrivatePreview(null)
              setPrivatePreviewError('Quote expired. Try again.')
              if (quoteHandle) void rheaSwapClient.discard(quoteHandle).catch(() => {})
              quoteHandle = null
            },
            Math.max(0, getRheaSwapQuoteDeadline(quote) - Date.now())
          )
        } catch (error) {
          if (quoteHandle) {
            void rheaSwapClient.discard(quoteHandle).catch(() => {})
            quoteHandle = null
          }
          if (!cancelled && currentPreviewKey.current === previewKey)
            setPrivatePreviewError(getRheaSwapErrorMessage(error))
        }
      })()
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer)
      if (quoteHandle) void rheaSwapClient.discard(quoteHandle).catch(() => {})
    }
  }, [previewKey, privatePreviewRetry])

  const maxTransfer = useMaxTransferEstimate({
    to: effectiveToAddress,
    memo: effectiveMemo,
    feeTier,
    fundingSource,
    enabled:
      active && !sendPrivately && !!effectiveToAddress && !!fromAddress && !recipientFormatError
  })
  const isMaxTransferAmount =
    !!maxTransfer.maxAmount && safeBig(amount || '0').eq(maxTransfer.maxAmount)
  const staleSelectedMax = maxSelected && !!maxTransfer.maxAmount && !isMaxTransferAmount
  const feeEstimate = useFeeEstimate({
    type: 'send',
    to: effectiveToAddress,
    amount,
    memo: effectiveMemo,
    fundingSource,
    feeTier,
    scopeKey: JSON.stringify([
      currentNetwork,
      currentWalletId,
      currentAccountId,
      sourceBalance.available,
      sourceBalance.pending
    ]),
    enabled:
      active &&
      !sendPrivately &&
      safeBig(amount || '0').gt(0) &&
      !!effectiveToAddress &&
      !recipientFormatError &&
      !maxSelected &&
      !isMaxTransferAmount
  })

  const isMaxFeeMode = maxSelected || isMaxTransferAmount
  const displayedFeeByTier = isMaxFeeMode ? maxTransfer.feeByTier : feeEstimate.feeByTier
  const displayedFeeLoadingByTier = isMaxFeeMode
    ? maxTransfer.loadingByTier
    : feeEstimate.loadingByTier
  const feeRequired =
    !!effectiveToAddress && safeBig(amount || '0').gt(0) && recipientFormatError === null
  const feeError = feeRequired && (isMaxFeeMode ? maxTransfer.error : feeEstimate.error)
  const feeReady =
    feeRequired &&
    !feeError &&
    !staleSelectedMax &&
    !!(isMaxFeeMode ? maxTransfer.feeQuote : feeEstimate.feeQuote) &&
    (isMaxFeeMode ? maxTransfer.feeQuote!.expiresAt : feeEstimate.feeQuote!.expiresAt) >
      Date.now() &&
    (isMaxFeeMode
      ? !maxTransfer.loading &&
        !!maxTransfer.feeQuote &&
        !!maxTransfer.fee &&
        safeBig(maxTransfer.fee).gt(0)
      : !feeEstimate.loading && !!feeEstimate.feeQuote && feeEstimate.feeZats !== null)
  const displayedFeeLoading = feeRequired && !feeReady && !feeError
  const retryFeeEstimate = () => {
    if (isMaxFeeMode) void maxTransfer.request()
    else feeEstimate.retry()
  }

  const selectedFeeZats = feeEstimate.feeByTier[feeTier] ?? staticFeeFallbackZats(feeTier)
  const standardFeeZats = feeEstimate.feeByTier.standard ?? staticFeeFallbackZats('standard')
  const estimatedFeeZec = formatBaseUnitDecimalAmount(String(selectedFeeZats), ZEC_DECIMALS)
  const { amount: effectiveMaxStr } = resolveZcashFundingAvailability({
    balance,
    fundingSource,
    selectedFeeZats,
    standardFeeZats,
    maximumAmount: maxTransfer.maxAmount,
    capTransparentToShieldable: isTransparentToShieldMove
  })
  const amountError = isTransparentToShieldMove
    ? null
    : getFundingAmountError(amount, sourceBalance, effectiveMaxStr)
  const amountErrorCopy = isTransparentToShieldMove
    ? getZcashTransparentToShieldMoveAmountError(amount, balance, effectiveMaxStr)
    : getFundingAmountErrorCopy(amountError)
  const reviewInsufficient =
    amountError !== null || (isTransparentToShieldMove && amountErrorCopy !== undefined)
  const isValidAmount = !!fromAddress && safeBig(amount || '0').gt(0) && !reviewInsufficient
  const selectedFeeZec = isMaxFeeMode ? (maxTransfer.fee ?? estimatedFeeZec) : estimatedFeeZec
  const selectedFeeQuote = isMaxFeeMode ? maxTransfer.feeQuote : feeEstimate.feeQuote
  const latestFee = useRef({
    selectedFeeQuote,
    selectedFeeZec,
    amount,
    effectiveToAddress,
    feeTier,
    fundingSource,
    effectiveMemo,
    maxSelected,
    isSelfMove
  })
  latestFee.current = {
    selectedFeeQuote,
    selectedFeeZec,
    amount,
    effectiveToAddress,
    feeTier,
    fundingSource,
    effectiveMemo,
    maxSelected,
    isSelfMove
  }

  useEffect(() => {
    if (showReview && staleSelectedMax && !isConfirming) setShowReview(false)
  }, [showReview, staleSelectedMax, isConfirming])

  useEffect(() => {
    if (active && maxSelected && effectiveMaxStr) {
      setAmount(effectiveMaxStr)
    }
  }, [active, maxSelected, effectiveMaxStr])

  useEffect(() => {
    if (!active) setShowReview(false)
  }, [active])

  useEffect(() => {
    if (previousRouteIdentity.current === routeIdentity) return
    previousRouteIdentity.current = routeIdentity
    setShowReview(false)
    setFundingSource(moveSource ?? 'transparent')
    setToAddress('')
    setSelectedRecipient(null)
    setAmount('')
    setMaxSelected(false)
    setMemo('')
  }, [moveSource, routeIdentity, walletMode])

  useEffect(() => {
    const activeScope = getActiveAccountScopeKey()
    const previousScope = activeScopeRef.current
    activeScopeRef.current = activeScope
    if (previousScope === undefined || previousScope === activeScope) return

    setShowReview(false)
    setToAddress('')
    setSelectedRecipient(null)
    setAmount('')
    setMaxSelected(false)
    setMemo('')
    setFundingSource('shielded')
  }, [currentWalletId, currentAccountId])

  const handleSelectFundingSource = (source: FundingSource) => {
    if (fundingOptions.find(option => option.type === source)?.disabledReason) return
    setPrivateSendScope(null)
    if (!shouldRetainZcashSendRecipient(toAddress, currentAccount?.addresses)) {
      setToAddress('')
      setSelectedRecipient(null)
    }
    setFundingSource(source)
    setAmount('')
    setMaxSelected(false)
    setShowReview(false)
  }

  useLayoutEffect(() => {
    if (
      !fundingSourceSelection ||
      appliedFundingSourceRevision.current === fundingSourceSelection.revision
    )
      return
    appliedFundingSourceRevision.current = fundingSourceSelection.revision
    if (fundingSource !== fundingSourceSelection.source)
      handleSelectFundingSource(fundingSourceSelection.source)
  }, [fundingSourceSelection, fundingSource])

  const handleSelectMyAddress = async () => {
    await openModal<string>({
      title: 'Select Recipient',
      showCloseButton: true,
      body: (resolve: (value: any) => void, close: () => void) => (
        <RecipientSelector
          chainId={getZcashChainId(currentNetwork)}
          excludeAddresses={fromAddress ? [fromAddress] : []}
          onSelect={(address, name) => {
            setToAddress(address)
            setSelectedRecipient(name ? { address, name } : null)
            close()
            resolve(address)
          }}
        />
      )
    })
  }

  const handleContinue = () => {
    if (!active) return
    if (sendPrivately) {
      if (!privatePreviewReady || !currentWalletId || !currentAccountId || !isValidAmount) return
      navigate(
        buildPublicPrivateEvmSendPath({
          assetId: ZEC_ZCASH_ASSET,
          recipient: effectiveToAddress,
          amount,
          maximum: maxSelected,
          walletId: currentWalletId,
          accountId: currentAccountId,
          network: currentNetwork
        }),
        { replace: true }
      )
      return
    }
    if (
      effectiveToAddress &&
      !moveUnavailable &&
      isValidAmount &&
      !reviewInsufficient &&
      feeReady &&
      !recipientFormatError &&
      (isSelfMove ||
        isZcashSendRecipientReady(effectiveToAddress, recipientFormatError, zns.loading))
    ) {
      setShowReview(true)
    }
  }

  const sendEventBase: TrackOptions = {
    pageId: PAGE_IDS.SEND,
    hasTransaction: 1,
    inputSymbol: 'ZEC'
  }

  const handleConfirm = async () => {
    if (!active || isHardwareSigning || confirmationInFlight.current) return
    if (
      !isValidAmount ||
      reviewInsufficient ||
      !feeReady ||
      !selectedFeeQuote ||
      !fromAddress ||
      !currentAccount ||
      (isSelfMove && syncState.isSyncing) ||
      moveUnavailable
    )
      return
    const activeScope = getActiveAccountScopeKey()
    if (!activeScope) return
    confirmationInFlight.current = true
    setIsConfirming(true)
    try {
      try {
        const currentQuote = await zcashWalletRuntimeClient.getFeeQuote()
        const latest = latestFee.current
        if (
          !activeRef.current ||
          getActiveAccountScopeKey() !== activeScope ||
          latest.selectedFeeQuote?.id !== selectedFeeQuote.id ||
          latest.selectedFeeZec !== selectedFeeZec ||
          latest.amount !== amount ||
          latest.effectiveToAddress !== effectiveToAddress ||
          latest.feeTier !== feeTier ||
          latest.fundingSource !== fundingSource ||
          latest.effectiveMemo !== effectiveMemo ||
          latest.maxSelected !== maxSelected ||
          latest.isSelfMove !== isSelfMove
        )
          return
        if (currentQuote.id !== selectedFeeQuote.id || selectedFeeQuote.expiresAt <= Date.now()) {
          if (isMaxFeeMode) void maxTransfer.request(true)
          else feeEstimate.retry()
          return
        }
      } catch {
        if (isMaxFeeMode) void maxTransfer.request(true)
        else feeEstimate.retry()
        return
      }
      assertActiveAccountScope(activeScope)
      if (isSelfMove) {
        const wallet = useWalletStore.getState()
        const currentMove = resolveZcashSelfMove(
          wallet.getCurrentAccount()?.addresses,
          fundingSource,
          wallet.currentNetwork
        )
        if (
          wallet.currentNetwork !== currentNetwork ||
          !currentMove ||
          currentMove.fromAddress !== fromAddress ||
          currentMove.toAddress !== effectiveToAddress
        ) {
          throw new Error('Active account changed. Review this action again.')
        }
      }
      const marginalFeeZats = marginalFeeForTier(feeTier, selectedFeeQuote.standardMarginalFeeZats)

      sendAnalyticsEvent(ANALYTICS_EVENTS.SEND_SUBMITTED, {
        ...sendEventBase,
        extra: { fee_tier: feeTier, hardware: isHardwareWallet, funding_source: fundingSource }
      })

      // Hardware wallets sign via QR codes in a dedicated tab (camera access
      // and the multi-step flow don't survive in a popup)
      if (isHardwareWallet) {
        assertActiveAccountScope(activeScope)
        if (!currentWallet || !currentAccount) return
        setShowReview(false)
        const request = {
          kind: 'send' as const,
          walletId: currentWallet.id,
          accountId: currentAccount.id,
          to: effectiveToAddress,
          amount,
          fundingSource,
          maxTransfer: maxSelected,
          memo: effectiveMemo,
          marginalFeeZats,
          feeQuoteId: selectedFeeQuote.id,
          feeTier
        }
        if (!isSidePanelSurface(window.location.search)) {
          await openHardwareSignTab(request)
          window.close()
          return
        }

        setIsHardwareSigning(true)
        try {
          const result = await openHardwareSignAndWait(request, { presentation: 'window' })
          if (result.status === 'success') {
            setResult(
              {
                type: 'zcash',
                operation: isSelfMove ? 'move' : 'send',
                step: 'submitted',
                amount: result.amount,
                fromAddress,
                toAddress: effectiveToAddress,
                txHash: result.txHash,
                accountKey: result.accountKey,
                transactionId: result.transactionId,
                showFrom: true,
                showTo: true
              },
              resultReturnPath
            )
            navigate('/transaction-result')
          } else if (result.status === 'timeout') {
            toast.error('Hardware signing timed out', 'The transaction form has been restored.')
          } else {
            toast.info('Hardware signing cancelled')
          }
        } catch (cause) {
          toast.error('Could not open hardware signing', classifyError(cause).userMessage)
        } finally {
          setIsHardwareSigning(false)
        }
        return
      }

      setShowReview(false)

      assertActiveAccountScope(activeScope)

      const pendingResult = {
        type: 'zcash',
        operation: isSelfMove ? 'move' : 'send',
        step: 'pending',
        amount,
        fromAddress,
        toAddress: effectiveToAddress,
        showFrom: true,
        showTo: true,
        saveRecipient: {
          chainId: getZcashChainId(currentNetwork),
          chainFamily: 'zcash',
          network: currentNetwork,
          networkName: currentNetwork === 'testnet' ? 'Zcash Testnet' : 'Zcash',
          address: effectiveToAddress,
          name: zns.name ?? 'Recipient',
          znsName: zns.name || undefined,
          selfTransfer: Object.values(currentAccount.addresses).includes(effectiveToAddress)
        }
      } as const
      setResult(pendingResult, resultReturnPath)
      navigate('/transaction-result')

      const result = await sendTransaction({
        to: effectiveToAddress,
        amount,
        from: fromAddress,
        fromType: fundingSource,
        memo: effectiveMemo,
        fee: selectedFeeZec,
        marginalFeeZats,
        feeQuoteId: selectedFeeQuote.id,
        feeTier,
        onCreated: (transaction, accountKey) => {
          if (useTransactionResultStore.getState().data !== pendingResult) return
          updateStep('pending', {
            accountKey,
            transactionId: transaction.id,
            timestamp: transaction.timestamp
          })
        },
        analytics: {
          pageId: PAGE_IDS.SEND,
          fundingSource
        }
      })

      if (result.step === 'success') {
        updateStep(
          'submitted',
          { txHash: result.txHash, timestamp: result.timestamp },
          result.accountKey,
          result.transactionId
        )
      } else if (result.step === 'pending') {
        updateStep('pending', { error: result.error }, result.accountKey, result.transactionId)
      } else {
        if (result.transactionId) {
          updateStep('failed', { error: result.error }, result.accountKey, result.transactionId)
        } else if (useTransactionResultStore.getState().data === pendingResult) {
          updateStep('failed', { error: result.error })
        }
      }
    } finally {
      confirmationInFlight.current = false
      setIsConfirming(false)
    }
  }

  if (!currentAccount) {
    return (
      <div className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'page-container'}>
        {!embedded && <PageHeader title={isSelfMove ? 'Move' : 'Send'} showBack />}
        <div className="flex-1 flex items-center justify-center px-5">
          <p className="text-muted text-center">No account available</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={embedded ? 'flex min-h-0 flex-1 flex-col bg-background' : 'page-container'}
      data-wallet-mode={isSelfMove ? 'public' : walletMode}
    >
      {!embedded && <PageHeader title={isSelfMove ? 'Move' : 'Send'} showBack onBack={goBack} />}
      <div className="page-content min-h-0 !px-4 pt-4">
        <div className={cn('space-y-2', !isSelfMove && 'flex flex-col gap-4 space-y-0')}>
          {isSelfMove ? (
            <>
              <MoveLayout
                amount={
                  <input
                    aria-label="ZEC amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={event => {
                      if (!/^\d*\.?\d*$/.test(event.target.value)) return
                      setMaxSelected(false)
                      setAmount(event.target.value)
                    }}
                    placeholder="0"
                    aria-invalid={reviewInsufficient || undefined}
                    className="h-12 w-full max-w-[280px] bg-transparent px-2 text-center text-[40px] font-semibold leading-tight tabular-nums outline-none placeholder:text-muted/45"
                    style={{
                      fontSize: `${Math.max(18, Math.min(40, Math.floor(440 / Math.max(1, amount.length))))}px`
                    }}
                  />
                }
                balance={isTransparentToShieldMove ? shieldableBalance : sourceBalance.available}
                max={
                  <button
                    type="button"
                    aria-label="Max"
                    aria-pressed={maxSelected}
                    aria-busy={maxTransfer.loading || undefined}
                    disabled={
                      !fromAddress ||
                      !effectiveToAddress ||
                      safeBig(effectiveMaxStr).lte(0) ||
                      maxTransfer.loading ||
                      (isTransparentToShieldMove &&
                        !hasEnoughTransparentBalanceToShield(shieldableBalance))
                    }
                    onClick={() => {
                      setMaxSelected(true)
                      setAmount(effectiveMaxStr)
                      void maxTransfer.request()
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 font-medium text-primary disabled:opacity-40"
                  >
                    {maxTransfer.loading && (
                      <Icon
                        icon="lucide:loader-2"
                        width={12}
                        height={12}
                        className="animate-spin"
                      />
                    )}
                    Max
                  </button>
                }
                accountName={accountDisplayName}
                fromAddress={fromAddress}
                toAddress={effectiveToAddress}
                from={fundingSource}
                onReverse={reverseMove}
              />
              {moveUnavailable && (
                <InlineError message="This account cannot move ZEC between Transparent and Shield." />
              )}
              {isTransparentToShieldMove &&
                !moveUnavailable &&
                !hasEnoughTransparentBalanceToShield(shieldableBalance) && (
                  <InlineError message={MIN_SHIELDING_BALANCE_MESSAGE} />
                )}
              {amountErrorCopy && <InlineError message={amountErrorCopy} />}
            </>
          ) : (
            <>
              <div className="order-3">
                <SendAmountRow
                  amountInput={
                    <SendAmountInputCard
                      testId="zcash-amount-card"
                      ariaLabel="ZEC amount"
                      value={amount}
                      onChange={nextAmount => {
                        if (!/^\d*\.?\d*$/.test(nextAmount)) return
                        setMaxSelected(false)
                        setAmount(nextAmount)
                      }}
                      available={sourceBalance.available}
                      symbol="ZEC"
                      priceUsd={zecPrice}
                      invalid={reviewInsufficient}
                      error={amountErrorCopy}
                      inline
                    />
                  }
                  assetSelector={
                    <SendAssetHeader
                      symbol="ZEC"
                      networkName={currentNetwork === 'testnet' ? 'Zcash Testnet' : 'Zcash'}
                      nativeChain="zcash"
                      blockchain="zec"
                      variant="pill"
                      onSelectAsset={onSelectAsset ? () => onSelectAsset(fundingSource) : undefined}
                    />
                  }
                  balance={
                    <span title={sourceBalance.available}>
                      {formatTokenQuantity(sourceBalance.available)}
                    </span>
                  }
                  maxButton={
                    <button
                      type="button"
                      aria-label="Max"
                      aria-pressed={maxSelected}
                      aria-busy={maxTransfer.loading || undefined}
                      disabled={
                        !fromAddress ||
                        safeBig(effectiveMaxStr).lte(0) ||
                        !effectiveToAddress ||
                        zns.loading ||
                        maxTransfer.loading
                      }
                      onClick={() => {
                        setMaxSelected(true)
                        setAmount(effectiveMaxStr)
                        void maxTransfer.request()
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1 font-medium text-primary disabled:opacity-40"
                    >
                      {maxTransfer.loading && (
                        <Icon
                          icon="lucide:loader-2"
                          width={12}
                          height={12}
                          className="animate-spin"
                        />
                      )}
                      Max
                    </button>
                  }
                />
              </div>
              <div className="order-1 flex min-w-0 items-center justify-between gap-3">
                <SendFieldLabel>Send from</SendFieldLabel>
                <BalanceDomainTabs
                  value={fundingSource === 'shielded' ? 'shield' : 'public'}
                  labels={{ public: 'Transparent' }}
                  available={(['public', 'shield'] as const).filter(domain =>
                    fundingOptions.some(
                      option =>
                        !option.disabledReason &&
                        option.type === (domain === 'public' ? 'transparent' : 'shielded')
                    )
                  )}
                  onChange={domain =>
                    handleSelectFundingSource(domain === 'shield' ? 'shielded' : 'transparent')
                  }
                />
              </div>
            </>
          )}

          {!isSelfMove && !sendPrivately && recipientSupportsMemo && (
            <div className="order-4">
              <label htmlFor="zcash-send-memo" className="mb-1.5 block px-1 text-xs text-muted">
                Memo (optional)
              </label>
              <textarea
                id="zcash-send-memo"
                value={memo}
                onChange={event => {
                  const encoded = new TextEncoder().encode(event.target.value)
                  if (encoded.length <= 512) setMemo(event.target.value)
                }}
                placeholder="Add a private memo"
                rows={2}
                className="w-full resize-none rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-sm placeholder:text-muted/50 focus:border-primary/50 focus:outline-none disabled:opacity-40"
              />
              {memo && (
                <p className="mt-1 px-1 text-right text-xs text-muted">
                  {new TextEncoder().encode(memo).length}/512 bytes
                </p>
              )}
            </div>
          )}

          {!isSelfMove &&
            fundingSource === 'shielded' &&
            Boolean(amount) &&
            safeBig(amount).gt(sourceBalance.available) &&
            currentWallet?.keySource !== 'keystone' && (
              <div className="order-4">
                <ShieldFundsBanner
                  transparentBalance={transparentBalance}
                  action="send"
                  isShielding={isMigrating}
                  onShield={handleMigrateNow}
                />
              </div>
            )}

          {!isSelfMove && (
            <div className="order-2">
              <div className="mb-2 flex items-center justify-between text-xs">
                <SendFieldLabel>Send to</SendFieldLabel>
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <ChainIcon chain="zcash" width={16} height={16} showTooltip={false} />
                  {currentNetwork === 'testnet' ? 'Zcash Testnet' : 'Zcash'}
                </span>
              </div>
              <SendRecipientInputCard
                id="zcash-send-recipient"
                value={toAddress}
                onChange={value => {
                  setToAddress(value)
                  setSelectedRecipient(null)
                }}
                placeholder="Recipient address"
                variant="filled"
                hideLabel
                invalid={Boolean(recipientFormatError)}
                onSelectRecipient={handleSelectMyAddress}
              />
              {recipientFormatError && (
                <p role="alert" className="mt-1.5 px-1 text-xs text-danger">
                  {recipientFormatError}
                </p>
              )}
              {zns.loading && (
                <p className="text-muted text-xs mt-1.5 px-1 flex items-center gap-1.5">
                  <Icon icon="lucide:loader-2" width={12} height={12} className="animate-spin" />
                  Resolving name...
                </p>
              )}
              {zns.address && (
                <p className="text-primary text-xs mt-1.5 px-1 flex items-center gap-1.5">
                  <Icon icon="lucide:check-circle" width={12} height={12} />
                  {formatSortAddress(zns.address)}
                </p>
              )}
              {recipientInput.znsInput && zns.error && (
                <InlineError
                  className="mt-1.5 px-1"
                  message={zns.error}
                  onRetry={zns.retryable ? zns.retry : undefined}
                  retrying={zns.loading}
                />
              )}
            </div>
          )}

          {!sendPrivately && (
            <div className="order-5">
              <SendRouteInfoCard
                provider={
                  <span className="inline-flex items-center gap-1.5">
                    <img src={zcashShieldLogo} alt="" className="size-5 rounded" />
                    Zcash
                  </span>
                }
                fee={
                  <FeeTierPicker
                    tier={feeTier}
                    onTierChange={setFeeTier}
                    feeByTier={displayedFeeByTier}
                    loadingByTier={displayedFeeLoadingByTier}
                    loading={displayedFeeLoading}
                    allowFallback={!feeRequired}
                    hideLabel
                  />
                }
                time={estimateZcashSendTime()}
              />
            </div>
          )}
          {!sendPrivately && maxTransfer.error && !isMaxFeeMode && (
            <InlineError
              className="order-3 px-1"
              message="Could not calculate maximum amount"
              onRetry={() => void maxTransfer.request()}
            />
          )}
          {!sendPrivately && feeError && (
            <InlineError
              className="order-6 px-1"
              message={
                (!isMaxFeeMode && feeEstimate.errorMessage) || 'Could not estimate network fee'
              }
              onRetry={retryFeeEstimate}
            />
          )}

          {sendPrivately && (
            <div className="order-5">
              <SendRouteInfoCard
                provider={
                  <span className="inline-flex items-center gap-1.5">
                    <img src={nearLogo} alt="" className="size-5 rounded" />
                    NEAR Confidential Intents
                  </span>
                }
                fee={
                  privatePreviewReady && privatePreview ? (
                    <AmountDisplay
                      value={
                        getPublicPrivateSendRouteCost({
                          amountInRaw: privatePreview.amountRaw,
                          estimatedOutRaw: privatePreview.quote.estimatedOut,
                          decimals: ZEC_DECIMALS
                        }) ?? '—'
                      }
                      symbol="ZEC"
                    />
                  ) : (
                    '—'
                  )
                }
                time={
                  privatePreviewReady ? (
                    <span title="Zcash confirmation only; confidential routing adds time.">
                      {estimateConfidentialSendTime(undefined, estimateZcashSendTime())}
                    </span>
                  ) : (
                    '—'
                  )
                }
                extra={
                  privatePreviewReady && privatePreview ? (
                    <div className="flex justify-between gap-3 border-t border-white/10 pt-3">
                      <span className="text-muted">Est. receive</span>
                      <AmountDisplay
                        value={formatBaseUnitDecimalAmount(
                          privatePreview.quote.estimatedOut,
                          ZEC_DECIMALS
                        )}
                        symbol="ZEC"
                      />
                    </div>
                  ) : undefined
                }
              />
            </div>
          )}
          {sendPrivately && privatePreviewError && (
            <InlineError
              className="order-6"
              message={privatePreviewError}
              onRetry={() => setPrivatePreviewRetry(value => value + 1)}
            />
          )}

          {syncState.isSyncing && (
            <p role="status" className="order-8 text-muted text-xs px-1">
              {isSelfMove
                ? 'Syncing wallet'
                : 'Syncing wallet. Send will start after the current batch.'}
            </p>
          )}
        </div>
      </div>

      <div className="page-footer">
        {privateSendAvailable && (
          <button
            type="button"
            role="switch"
            aria-label="Send privately"
            aria-checked={sendPrivately}
            onClick={() => {
              setPrivateSendScope(sendPrivately ? null : privacyScope)
              setMaxSelected(false)
            }}
            className={`mb-4 flex w-full items-center justify-center gap-1.5 text-sm ${sendPrivately ? 'text-primary' : 'text-muted'}`}
          >
            <Icon icon="lucide:shield-check" width={15} height={15} className="text-primary" />
            Send privately
            <Switch checked={sendPrivately} size="sm" />
          </button>
        )}
        <Button
          size="wallet"
          disabled={
            !active ||
            !effectiveToAddress ||
            moveUnavailable ||
            !amount ||
            !isValidAmount ||
            reviewInsufficient ||
            Boolean(recipientFormatError) ||
            (sendPrivately ? !privatePreviewReady : !feeReady) ||
            (isSelfMove && syncState.isSyncing) ||
            (isTransparentToShieldMove &&
              !hasEnoughTransparentBalanceToShield(shieldableBalance)) ||
            (!isSelfMove &&
              !isZcashSendRecipientReady(effectiveToAddress, recipientFormatError, zns.loading))
          }
          onClick={handleContinue}
          className="w-full h-[45px]"
        >
          {isSelfMove ? 'Move' : 'Continue'}
        </Button>
      </div>

      <Dialog
        open={showReview}
        onOpenChange={open => {
          if (!open && (confirmationInFlight.current || isHardwareSigning)) return
          setShowReview(open)
        }}
      >
        <DialogContent
          position="bottom"
          showCloseButton={false}
          aria-label={isSelfMove ? 'Confirm Move' : 'Confirm Send'}
          data-wallet-mode={isSelfMove ? 'public' : walletMode}
          className="flex h-dvh max-h-dvh flex-col gap-0 rounded-none border-0 bg-background p-0 shadow-none"
        >
          <DialogTitle className="sr-only">
            {isSelfMove ? 'Confirm Move' : 'Confirm Send'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Review the amount, destination, and fee before {isSelfMove ? 'moving' : 'sending'}.
          </DialogDescription>
          <TransactionReviewView
            title={isSelfMove ? 'Confirm Move' : 'Confirm Send'}
            showTitle
            variant="figma"
            asset={{ symbol: 'ZEC', nativeChain: 'zcash' }}
            amount={amount}
            amountPrefix={isConfirming && !isHardwareWallet ? '' : isSelfMove ? '' : '-'}
            fiatValue={formatFiatAmount(
              safeBig(amount || '0')
                .times(zecPrice || 0)
                .times(isSelfMove ? 1 : -1)
                .toFixed(),
              { showSign: true }
            )}
            network={currentNetwork === 'testnet' ? 'Zcash Testnet' : 'Zcash'}
            rows={[
              {
                label: isSelfMove ? 'From' : 'Send from',
                content: (
                  <span className="min-w-0 text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      {accountDisplayName}
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs',
                          fundingSource === 'shielded'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-white/10 text-muted'
                        )}
                      >
                        {fundingSource === 'shielded' ? 'Shield' : 'Transparent'}
                      </span>
                    </span>
                    <span
                      className="block truncate text-xs font-normal leading-4 text-muted"
                      title={fromAddress}
                    >
                      {formatSortAddress(fromAddress)}
                    </span>
                  </span>
                )
              },
              {
                label: isSelfMove ? 'To' : 'Recipient',
                content: (
                  <SendRecipientAddress
                    address={effectiveToAddress}
                    name={
                      zns.name ||
                      (selectedRecipient?.address === toAddress
                        ? selectedRecipient.name
                        : undefined)
                    }
                  />
                )
              },
              {
                label: 'Network',
                content: currentNetwork === 'testnet' ? 'Zcash Testnet' : 'Zcash'
              },
              ...(effectiveMemo ? [{ label: 'Memo', content: effectiveMemo }] : []),
              {
                label: 'Network fee',
                content: (
                  <FeeTierPicker
                    tier={feeTier}
                    onTierChange={setFeeTier}
                    feeByTier={displayedFeeByTier}
                    loading={displayedFeeLoading}
                    loadingByTier={displayedFeeLoadingByTier}
                    allowFallback={false}
                    hideLabel
                  />
                )
              }
            ]}
            error={
              feeError ? (
                <InlineError
                  className="mt-3"
                  message={
                    (!isMaxFeeMode && feeEstimate.errorMessage) || 'Could not estimate network fee'
                  }
                  onRetry={retryFeeEstimate}
                />
              ) : undefined
            }
            confirmLabel={isHardwareSigning ? 'Waiting for hardware wallet...' : 'Confirm'}
            confirming={isConfirming}
            submitting={isConfirming && !isHardwareWallet}
            confirmDisabled={
              !active ||
              moveUnavailable ||
              reviewInsufficient ||
              !feeReady ||
              (isSelfMove && syncState.isSyncing) ||
              isHardwareSigning
            }
            cancelDisabled={isConfirming || isHardwareSigning}
            onCancel={() => {
              if (!confirmationInFlight.current && !isHardwareSigning) setShowReview(false)
            }}
            onConfirm={() => void handleConfirm()}
          />
        </DialogContent>
      </Dialog>

      {migrateSheet}
    </div>
  )
}
