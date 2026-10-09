import Big from 'big.js'
import { formatNumber, formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'
import { calculateTokenFiatValue, parseTokenBalanceDecimal } from './token-balance-format'

export function TokenBalanceDisplay({
  amount,
  symbol,
  priceUsd,
  approximateFiat = false,
  unavailablePriceLabel = '—',
  className
}: {
  amount: string
  symbol: string
  priceUsd?: number | string | null
  approximateFiat?: boolean
  unavailablePriceLabel?: string
  className?: string
}) {
  const parsedAmount = parseTokenBalanceDecimal(amount)
  const fiatValue = calculateTokenFiatValue(amount, priceUsd)

  return (
    <div className={cn('min-w-0 text-right', className)}>
      <p className="truncate font-mono text-sm">
        {parsedAmount === null
          ? unavailablePriceLabel
          : formatNumber(parsedAmount.toFixed(), { maxDigits: 6, rm: Big.roundDown })}{' '}
        {symbol}
      </p>
      <p className="truncate text-xs text-muted">
        {fiatValue === null
          ? unavailablePriceLabel
          : `${approximateFiat ? '≈' : ''}${formatPrice(fiatValue, {
              showSign: true,
              maxDigits: 2
            })}`}
      </p>
    </div>
  )
}
