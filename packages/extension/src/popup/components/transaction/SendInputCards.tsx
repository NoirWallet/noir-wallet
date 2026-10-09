import { Icon } from '@iconify/react'
import type { ReactNode } from 'react'
import { safeBig } from '@/lib/big'
import Big from '@/lib/big'
import { formatNumber, formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TokenIcon } from '../tokens/TokenIcon'
import { Input } from '../ui/input'

function fiatValue(amount: string, priceUsd: string | number | null | undefined): string | null {
  const normalizedAmount = amount.replace(/,/g, '') || '0'
  const normalizedPrice = String(priceUsd ?? '')
  const decimalPattern = /^(?:\d+(?:\.\d*)?|\.\d+)$/
  if (
    !decimalPattern.test(normalizedAmount) ||
    !decimalPattern.test(normalizedPrice) ||
    safeBig(normalizedPrice).lte(0)
  ) {
    return null
  }
  return formatPrice(safeBig(normalizedAmount).times(normalizedPrice).toFixed(), {
    showSign: true
  })
}

export function SendRecipientInputCard({
  id,
  value,
  onChange,
  placeholder,
  autoFocus = false,
  onSelectRecipient
}: {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly autoFocus?: boolean
  readonly onSelectRecipient?: () => void
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block px-1 text-xs font-medium text-foreground/80">
        Send to
      </label>
      <Input
        id={id}
        aria-label="Send To"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        className="h-14 rounded-2xl border-white/35 bg-transparent px-4 pr-16 font-mono text-sm shadow-none focus-visible:border-white/60 focus-visible:ring-0"
        endContent={
          onSelectRecipient ? (
            <button
              type="button"
              aria-label="Select Recipient"
              title="Select Recipient"
              onClick={onSelectRecipient}
              className="flex size-10 items-center justify-center rounded-xl bg-white/10 text-foreground transition-colors hover:bg-white/15"
            >
              <Icon icon="lucide:book-user" width={22} height={22} />
            </button>
          ) : undefined
        }
        classNames={{ endContent: 'right-3' }}
      />
    </div>
  )
}

export function SendAmountInputCard({
  ariaLabel,
  value,
  onChange,
  available,
  pending,
  symbol,
  priceUsd,
  onMax,
  maxDisabled = false,
  maxLoading = false,
  maxSelected = false,
  invalid = false,
  title,
  testId,
  headerAction,
  footerAction
}: {
  readonly ariaLabel: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly available: string
  readonly pending?: string
  readonly symbol: string
  readonly priceUsd?: string | number | null
  readonly onMax?: () => void
  readonly maxDisabled?: boolean
  readonly maxLoading?: boolean
  readonly maxSelected?: boolean
  readonly invalid?: boolean
  readonly title?: string
  readonly testId?: string
  readonly headerAction?: ReactNode
  readonly footerAction?: ReactNode
}) {
  const amountFiat = fiatValue(value, priceUsd)
  const availableFiat = fiatValue(available, priceUsd)
  const hasPending = pending != null && safeBig(pending).gt(0)

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-7 items-center justify-between gap-3 px-1">
        <span className="text-xs font-medium text-foreground/80">Amount</span>
        {headerAction}
      </div>
      <div
        data-testid={testId ?? 'send-amount-card'}
        title={title}
        className={cn(
          'rounded-2xl border px-4 py-3 transition-colors focus-within:border-white/60',
          invalid ? 'border-warning' : 'border-white/35'
        )}
      >
        <div className="flex min-h-8 items-center justify-between gap-3">
          <input
            aria-label={ariaLabel}
            inputMode="decimal"
            value={value}
            onChange={event => onChange(event.target.value)}
            placeholder="0"
            className="min-w-0 flex-1 bg-transparent font-mono text-2xl text-foreground outline-none placeholder:text-muted/45"
          />
          {onMax && (
            <button
              type="button"
              aria-label="Max"
              aria-pressed={maxSelected}
              onClick={onMax}
              disabled={maxDisabled || maxLoading}
              className={cn(
                'flex h-8 min-w-12 items-center justify-center rounded-full bg-white/12 px-3 text-sm text-foreground transition-colors hover:bg-white/18 disabled:pointer-events-none disabled:opacity-40',
                maxSelected && 'bg-primary/15 text-primary'
              )}
            >
              {maxLoading ? (
                <Icon icon="lucide:loader-circle" width={15} height={15} className="animate-spin" />
              ) : (
                'Max'
              )}
            </button>
          )}
        </div>
        <div className="mt-2.5 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-end gap-3 text-xs leading-4">
          <span className="flex min-w-0 items-center gap-2 text-muted">
            <span className="shrink-0">{amountFiat ? `~${amountFiat}` : '-'}</span>
            {footerAction}
          </span>
          <span className="min-w-0 text-right">
            <span className="block truncate text-muted">
              Available <strong className="font-semibold text-foreground">{available}</strong>{' '}
              {symbol}
              {availableFiat ? ` (${availableFiat})` : ''}
            </span>
            {hasPending && (
              <span className="mt-0.5 block truncate text-[11px] text-warning/80">
                {formatNumber(pending!, { rm: Big.roundDown })} {symbol} pending
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

export function SendAssetHeader({ symbol, networkName }: { symbol: string; networkName: string }) {
  return (
    <div
      data-testid="send-asset-header"
      className="flex flex-col items-center pb-0.5 pt-0.5 text-center"
    >
      <TokenIcon symbol={symbol} size={48} />
      <p className="mt-2 text-base font-semibold leading-5">{symbol}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted">{networkName}</p>
    </div>
  )
}

export function SendNetworkFeeCard({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-testid="send-network-fee"
      className="flex min-h-12 items-center justify-between gap-4 rounded-xl bg-card/45 px-4 py-3"
    >
      <span className="shrink-0 text-xs text-muted">Network fee</span>
      <div className="flex min-w-0 items-center gap-1.5 text-right text-xs font-medium">
        {children}
      </div>
    </div>
  )
}
