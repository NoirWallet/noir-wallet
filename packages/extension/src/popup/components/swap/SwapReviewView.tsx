import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import type { SwapToken } from '@/core/services/intents-api'
import {
  formatAmount,
  formatChainName,
  formatNumber,
  formatPrice,
  formatSortAddress,
  formatSymbol
} from '@/lib/format'
import type { FeeTier } from '@/config/fee'
import type { NetworkFeeTier } from '@/core/transactions/domain'
import { FeeTierPicker } from '../transaction/FeeTierPicker'
import { NetworkFeeTierPicker } from '../transaction/NetworkFeeTierPicker'

import { TokenIcon } from '../tokens/TokenIcon'
import Big from '@/lib/big'
import { ChainIcon } from '../common/ChainIcon'

interface SwapReviewViewProps {
  tokenIn: SwapToken
  tokenOut: SwapToken
  amountIn: string
  amountOut: string
  fromFiat: string
  toFiat: string
  slippage: number
  onConfirm: () => void
  minAmountOut: string
  priceImpact: number
  arrivalEstimate?: string
  isLoading?: boolean
  /** Selected fee tier (read-only display on review). */
  feeTier?: FeeTier
  onFeeTierChange?: (tier: FeeTier) => void
  feeByTier?: Record<FeeTier, number | null>
  feeLoading?: boolean
  /** Estimated fee for the selected tier in ZEC; '—' shown while pending. */
  selectedFeeZec?: string
  sourceNetworkFee?: { readonly amount: string; readonly symbol: string } | null
  sourceFeeTier?: NetworkFeeTier
  sourceFeeFamily?: 'evm' | 'bitcoin'
  onSourceFeeTierChange?: (tier: NetworkFeeTier) => void | Promise<void>
  sourceTransferDetails?: {
    readonly network: string
    readonly chainIcon: string
    readonly sender: string
    readonly depositAddress: string | null
  } | null
  destinationDetails?: { readonly network: string; readonly recipient: string }
  approvalDetails?: {
    readonly spender: string
    readonly amount: string
    readonly symbol: string
  }
  hasSigningReview?: boolean
  signingActionLabel?: string
  confirmLabel?: string
  /** Selected amount exceeds spendable balance once the fee delta is applied. */
  insufficient?: boolean
}

export function SwapReviewView({
  tokenIn,
  tokenOut,
  amountIn,
  amountOut,
  minAmountOut,
  priceImpact,
  arrivalEstimate,
  fromFiat,
  toFiat,
  slippage,
  onConfirm,
  isLoading,
  feeTier,
  onFeeTierChange,
  feeByTier,
  feeLoading,
  selectedFeeZec,
  sourceNetworkFee,
  sourceFeeTier,
  sourceFeeFamily,
  onSourceFeeTierChange,
  sourceTransferDetails,
  destinationDetails,
  approvalDetails,
  hasSigningReview,
  signingActionLabel = 'Sign Swap Order',
  confirmLabel = 'Confirm Swap',
  insufficient
}: SwapReviewViewProps) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-4">
        <div className="relative">
          <QuoteAssetRow
            label="You pay"
            token={tokenIn}
            amount={amountIn}
            fiatValue={fromFiat}
            networkLabel={destinationDetails ? formatChainName(tokenIn.blockchain) : undefined}
          />
          <div className="absolute left-1/2 top-[72px] z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-background bg-card">
            <Icon icon="lucide:arrow-down" width={15} height={15} />
          </div>
          <div className="mt-2">
            <QuoteAssetRow
              label="You receive"
              token={tokenOut}
              amount={amountOut}
              fiatValue={toFiat}
              networkLabel={destinationDetails?.network}
              emphasized
            />
          </div>
        </div>

        <div className="mt-4 space-y-3 rounded-xl bg-card/60 p-4">
          {destinationDetails && (
            <DetailItem label="Recipient">
              <span
                className="block break-all font-mono text-[11px]"
                title={destinationDetails.recipient}
              >
                {destinationDetails.recipient}
              </span>
            </DetailItem>
          )}
          <DetailItem label="Price Impact">
            <span className={priceImpact > 5 ? 'text-red-500' : 'text-foreground'}>
              {priceImpact < 0.01 ? '< 0.01' : priceImpact.toFixed(2)}%
            </span>
          </DetailItem>

          <DetailItem label="Minimum Received">
            <span>
              {formatNumber(formatAmount(minAmountOut, tokenOut.decimals), {
                rm: Big.roundDown,
                useUnit: true,
                useSubscript: true
              })}{' '}
              {formatSymbol(tokenOut.symbol)}
            </span>
          </DetailItem>

          <DetailItem label="Slippage Tolerance">
            <span>{slippage}%</span>
          </DetailItem>

          {arrivalEstimate && (
            <DetailItem label="Estimated time">
              <span>{arrivalEstimate}</span>
            </DetailItem>
          )}

          {selectedFeeZec && feeTier && onFeeTierChange && feeByTier && (
            <FeeTierPicker
              tier={feeTier}
              onTierChange={onFeeTierChange}
              feeByTier={feeByTier}
              loading={feeLoading}
            />
          )}

          {sourceNetworkFee && sourceFeeTier && sourceFeeFamily && onSourceFeeTierChange ? (
            <DetailItem label="Network Fee">
              <NetworkFeeTierPicker
                chainFamily={sourceFeeFamily}
                tier={sourceFeeTier}
                amount={sourceNetworkFee.amount}
                symbol={sourceNetworkFee.symbol}
                onTierChange={onSourceFeeTierChange}
                disabled={isLoading}
              />
            </DetailItem>
          ) : sourceNetworkFee ? (
            <DetailItem label="Network Fee">
              <span className="whitespace-nowrap font-mono">
                {formatNumber(sourceNetworkFee.amount, {
                  rm: Big.roundDown,
                  useUnit: true,
                  useSubscript: true
                })}{' '}
                {sourceNetworkFee.symbol}
              </span>
            </DetailItem>
          ) : null}

          {sourceTransferDetails && (
            <>
              <DetailItem label="Source Wallet">
                <span className="inline-flex min-w-0 items-center justify-end gap-2">
                  <ChainIcon
                    chain={sourceTransferDetails.chainIcon}
                    alt={sourceTransferDetails.network}
                    title={sourceTransferDetails.network}
                    className="size-4 shrink-0 rounded-full"
                  />
                  <span title={sourceTransferDetails.sender} className="font-mono text-xs">
                    {formatSortAddress(sourceTransferDetails.sender)}
                  </span>
                </span>
              </DetailItem>
              {sourceTransferDetails.depositAddress && (
                <DetailItem label="Deposit Address">
                  <span title={sourceTransferDetails.depositAddress} className="font-mono text-xs">
                    {formatSortAddress(sourceTransferDetails.depositAddress)}
                  </span>
                </DetailItem>
              )}
            </>
          )}

          {approvalDetails && (
            <>
              <DetailItem label="Execution Step">
                <span>Approve {formatSymbol(approvalDetails.symbol)}</span>
              </DetailItem>
              <DetailItem label="Approval Amount">
                <span>
                  {formatNumber(approvalDetails.amount, {
                    rm: Big.roundDown,
                    useUnit: true,
                    useSubscript: true
                  })}{' '}
                  {formatSymbol(approvalDetails.symbol)}
                </span>
              </DetailItem>
              <DetailItem label="Approval Spender">
                <span title={approvalDetails.spender} className="font-mono text-xs">
                  {formatSortAddress(approvalDetails.spender)}
                </span>
              </DetailItem>
            </>
          )}
        </div>

        {insufficient && (
          <p className="text-warning text-xs mt-3 px-1">
            Amount exceeds balance at this fee. Go back to lower the amount or switch fee tier.
          </p>
        )}
      </div>

      <div className="page-footer">
        <Button
          onClick={onConfirm}
          disabled={isLoading || insufficient}
          isLoading={isLoading}
          className="h-[45px] w-full"
        >
          {approvalDetails
            ? `Approve ${formatSymbol(approvalDetails.symbol)}`
            : hasSigningReview
              ? signingActionLabel
              : confirmLabel}
        </Button>
      </div>
    </>
  )
}

function QuoteAssetRow({
  label,
  token,
  amount,
  fiatValue,
  networkLabel,
  emphasized = false
}: {
  label: string
  token: SwapToken
  amount: string
  fiatValue: string
  networkLabel?: string
  emphasized?: boolean
}) {
  return (
    <section className="flex h-20 items-center gap-3 rounded-xl bg-card/60 px-4">
      <TokenIcon token={token} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-0.5 font-medium">{formatSymbol(token.symbol)}</p>
        {networkLabel && <p className="text-[11px] text-muted">{networkLabel}</p>}
      </div>
      <div className="min-w-0 max-w-[52%] text-right">
        <p className={`truncate font-mono text-lg ${emphasized ? 'text-primary' : ''}`}>
          {formatNumber(amount, { rm: Big.roundDown, useUnit: true, useSubscript: true })}
        </p>
        <p className="truncate text-xs text-muted">{formatPrice(fiatValue, { showSign: true })}</p>
      </div>
    </section>
  )
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <div className="min-w-0 text-right font-medium">{children}</div>
    </div>
  )
}
