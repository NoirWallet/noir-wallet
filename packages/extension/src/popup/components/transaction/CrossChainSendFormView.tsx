import { useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import type { RheaSwapToken } from '@/core/services/rhea-swap'
import { formatChainName, formatSymbol } from '@/lib/format'
import { formatFiatAmount, formatTokenQuantity } from '@/lib/number-format'
import { ChainSelector, type ChainSelectorOption } from '@/popup/components/common/ChainSelector'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { InlineError } from '@/popup/components/common/InlineError'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import { Button } from '@/popup/components/ui/button'
import {
  SendAmountInputCard,
  SendFieldLabel,
  SendRecipientInputCard,
  SendRouteInfoCard,
  SendSourceSection
} from './SendInputCards'

interface CrossChainSendFormViewProps {
  readonly tokenIn: RheaSwapToken | null
  readonly tokenOut: RheaSwapToken | null
  readonly destinationOptions: readonly ChainSelectorOption[]
  readonly onSelectDestination: (chainId: string) => void
  readonly amount: string
  readonly estimatedOut: string
  readonly fromFiat: string
  readonly recipient: string
  readonly spendableBalance: string
  readonly sourceBadge?: string
  readonly sourceAccountAction?: ReactNode
  readonly isQuoting: boolean
  readonly quoteError?: string | null
  readonly recipientError?: string | null
  readonly catalogError: boolean
  readonly sourceAssetsLoading: boolean
  readonly destinationAssetsLoading: boolean
  readonly hasInsufficientFunds: boolean
  readonly insufficientMessage?: string
  readonly maxLoading: boolean
  readonly maxDisabled: boolean
  readonly maxDisabledReason?: string
  readonly canGetQuote: boolean
  readonly actionLoading: boolean
  readonly providerName?: string
  readonly slippage: number
  readonly onAmountChange: (value: string) => void
  readonly onMaxClick?: () => void
  readonly onRecipientChange: (value: string) => void
  readonly onSelectRecipient?: () => void
  readonly onRetryCatalog: () => void
  readonly onRetryQuote?: () => void
  readonly onOpenSlippage: () => void
  readonly onReview: () => void
}

export function CrossChainSendFormView({
  tokenIn,
  tokenOut,
  destinationOptions,
  onSelectDestination,
  amount,
  estimatedOut,
  fromFiat,
  recipient,
  spendableBalance,
  sourceBadge,
  sourceAccountAction,
  isQuoting,
  quoteError,
  recipientError,
  catalogError,
  sourceAssetsLoading,
  destinationAssetsLoading,
  hasInsufficientFunds,
  insufficientMessage,
  maxLoading,
  maxDisabled,
  maxDisabledReason,
  canGetQuote,
  actionLoading,
  providerName,
  slippage,
  onAmountChange,
  onMaxClick,
  onRecipientChange,
  onSelectRecipient,
  onRetryCatalog,
  onRetryQuote,
  onOpenSlippage,
  onReview
}: CrossChainSendFormViewProps) {
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false)
  const sourceSymbol = formatSymbol(tokenIn?.symbol) || 'Token'
  const destinationName = tokenOut ? formatChainName(tokenOut.blockchain) : 'Select network'

  return (
    <>
      <div className="page-content min-h-0 space-y-4 !px-4 pt-4">
        <SendSourceSection
          domain={sourceBadge === 'Private' ? 'private' : 'public'}
          availableDomains={[sourceBadge === 'Private' ? 'private' : 'public']}
          onDomainChange={() => {}}
          sourceAction={sourceAccountAction}
          recipient={
            <div className="order-2">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <SendFieldLabel>Send to</SendFieldLabel>
                <button
                  type="button"
                  onClick={() => setNetworkPickerOpen(true)}
                  disabled={destinationAssetsLoading && destinationOptions.length === 0}
                  aria-label={`Select destination network, ${destinationName}`}
                  className="inline-flex min-w-0 items-center gap-1.5 text-xs hover:text-primary disabled:opacity-50"
                >
                  {tokenOut && (
                    <ChainIcon
                      chain={tokenOut.blockchain}
                      width={16}
                      height={16}
                      showTooltip={false}
                    />
                  )}
                  <span className="max-w-32 truncate">{destinationName}</span>
                  <Icon icon="lucide:chevron-down" width={13} height={13} />
                </button>
              </div>
              <SendRecipientInputCard
                id="cross-chain-send-recipient"
                value={recipient}
                onChange={onRecipientChange}
                placeholder="Enter address"
                hideLabel
                variant="filled"
                invalid={Boolean(recipientError)}
                onSelectRecipient={onSelectRecipient}
              />
              {recipientError && <InlineError message={recipientError} className="mt-2" />}
            </div>
          }
          amountInput={
            <SendAmountInputCard
              ariaLabel={`${sourceSymbol} amount`}
              value={amount}
              onChange={onAmountChange}
              available={spendableBalance}
              symbol={sourceSymbol}
              inline
              disabled={sourceAssetsLoading}
            />
          }
          assetSelector={
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <TokenIcon token={tokenIn ?? undefined} size={24} showChainBadge={false} />
              <span className="min-w-0 text-left">
                <span className="block truncate">{sourceSymbol}</span>
                {tokenIn && (
                  <span className="block truncate text-[10px] text-muted">
                    {formatChainName(tokenIn.blockchain)}
                  </span>
                )}
              </span>
            </span>
          }
          balance={formatTokenQuantity(spendableBalance)}
          maxButton={
            <button
              type="button"
              onClick={onMaxClick}
              disabled={!onMaxClick || maxLoading || maxDisabled}
              title={maxDisabled ? maxDisabledReason : 'Max'}
              aria-label="Max"
              className="shrink-0 font-medium text-foreground disabled:opacity-40"
            >
              {maxLoading ? (
                <Icon icon="lucide:loader-circle" className="size-3 animate-spin" />
              ) : (
                'Max'
              )}
            </button>
          }
        />
        {fromFiat && (
          <p className="text-xs text-muted">{formatFiatAmount(fromFiat, { showSign: true })}</p>
        )}
        {hasInsufficientFunds && (
          <InlineError message={insufficientMessage ?? 'Insufficient balance'} />
        )}

        {tokenOut && estimatedOut && (
          <SendRouteInfoCard
            provider={providerName}
            extra={
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="text-muted">Estimated receive</span>
                <span
                  className="min-w-0 truncate text-right"
                  title={`${estimatedOut} ${sourceSymbol}`}
                >
                  {formatTokenQuantity(estimatedOut)} {sourceSymbol}
                </span>
              </div>
            }
          />
        )}
        <button
          type="button"
          onClick={onOpenSlippage}
          className="flex w-full items-center justify-end gap-1 text-xs text-muted hover:text-foreground"
          aria-label={`Set slippage, currently ${slippage}%`}
        >
          Slippage {slippage}% <Icon icon="lucide:chevron-down" width={12} />
        </button>
        {catalogError && <InlineError message="Unable to load assets" onRetry={onRetryCatalog} />}
        {quoteError && (
          <InlineError message={quoteError} onRetry={onRetryQuote} retrying={isQuoting} />
        )}
      </div>
      <div className="page-footer">
        <Button
          onClick={onReview}
          disabled={!canGetQuote || hasInsufficientFunds || actionLoading}
          isLoading={isQuoting || actionLoading}
          className="h-[45px] w-full text-base font-semibold text-black"
        >
          Review Send
        </Button>
      </div>
      <ChainSelector
        open={networkPickerOpen}
        onOpenChange={setNetworkPickerOpen}
        options={destinationOptions}
        selectedId={tokenOut?.rheaChainId ?? null}
        onSelect={onSelectDestination}
      />
    </>
  )
}
