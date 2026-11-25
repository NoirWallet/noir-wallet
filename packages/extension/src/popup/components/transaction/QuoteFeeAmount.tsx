import { estimateBpsFeeAmount, formatPercentage } from '@/lib/number-format'
import { AmountDisplay } from '../common/AmountDisplay'

interface QuoteFeeAmountProps {
  readonly sourceAmountRaw: string
  readonly decimals: number
  readonly symbol: string
  readonly bps?: number
  readonly total?: string | null
}

export function QuoteFeeAmount({
  sourceAmountRaw,
  decimals,
  symbol,
  bps,
  total
}: QuoteFeeAmountProps) {
  const rate = bps !== undefined && bps > 0 ? bps : null
  const estimate = rate === null ? null : estimateBpsFeeAmount(sourceAmountRaw, decimals, rate)
  const amountAndRate =
    rate !== null && estimate !== null ? (
      <>
        <AmountDisplay value={estimate} symbol={symbol} profile="fee" prefix="≈ " />{' '}
        <span className="whitespace-nowrap">
          ({formatPercentage(rate, { decimals: -2, maxDigits: 2 })})
        </span>
      </>
    ) : null

  if (total == null) return amountAndRate ?? '—'
  return (
    <>
      <AmountDisplay value={total} symbol={symbol} profile="fee" />
      {amountAndRate && <span className="block text-muted">Incl. {amountAndRate}</span>}
    </>
  )
}
