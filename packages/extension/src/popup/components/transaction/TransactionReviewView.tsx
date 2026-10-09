import type { ReactNode } from 'react'

import { Button } from '@/popup/components/ui/button'
import { TokenIcon } from '@/popup/components/tokens/TokenIcon'
import Big from '@/lib/big'
import { formatNumber } from '@/lib/format'

export interface TransactionReviewAsset {
  readonly assetId?: string
  readonly symbol: string
  readonly icon?: string
  readonly blockchain?: string
  readonly nativeChain?: string
}

export interface TransactionReviewRow {
  readonly label: string
  readonly content: ReactNode
}

interface TransactionReviewViewProps {
  readonly title: string
  readonly titleId?: string
  readonly showTitle?: boolean
  readonly asset: TransactionReviewAsset
  readonly amount: string
  readonly exactAmount?: boolean
  readonly network: string
  readonly rows: readonly TransactionReviewRow[]
  readonly notice?: ReactNode
  readonly error?: ReactNode
  readonly confirmLabel: string
  readonly confirming?: boolean
  readonly confirmDisabled?: boolean
  readonly cancelDisabled?: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function TransactionReviewView({
  title,
  titleId,
  showTitle = true,
  asset,
  amount,
  exactAmount = false,
  network,
  rows,
  notice,
  error,
  confirmLabel,
  confirming = false,
  confirmDisabled = false,
  cancelDisabled = false,
  onCancel,
  onConfirm
}: TransactionReviewViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-5">
        {showTitle && (
          <h2 id={titleId} className="text-center text-base font-semibold">
            {title}
          </h2>
        )}

        <div className="flex flex-col items-center pb-4 pt-4">
          <TokenIcon
            assetId={asset.assetId}
            symbol={asset.symbol}
            icon={asset.icon}
            blockchain={asset.blockchain}
            nativeChain={asset.nativeChain}
            size="xl"
          />
          <p className="mt-3 flex max-w-full min-w-0 flex-wrap items-baseline justify-center gap-x-1 text-center text-xl font-bold leading-tight">
            <span className="min-w-0 break-all">
              {exactAmount
                ? amount
                : formatNumber(amount, { rm: Big.roundDown, useUnit: true, useSubscript: true })}
            </span>
            <span className="shrink-0">{asset.symbol}</span>
          </p>
          <p className="mt-1 text-xs text-muted">{network}</p>
        </div>

        {notice}

        <div className="rounded-xl border border-border/60 bg-card/60 px-4">
          {rows.map((row, index) => (
            <div
              key={`${row.label}-${index}`}
              className="flex min-w-0 items-start justify-between gap-4 py-2.5"
            >
              <span className="shrink-0 text-xs text-muted">{row.label}</span>
              <div className="min-w-0 text-right text-xs font-medium">{row.content}</div>
            </div>
          ))}
        </div>

        {error}
      </div>

      <div className="flex gap-3 p-5 pt-3">
        <Button
          variant="outline"
          className="h-[45px] flex-1"
          disabled={cancelDisabled || confirming}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          className="h-[45px] flex-1"
          disabled={confirmDisabled}
          isLoading={confirming}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}
