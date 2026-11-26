import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { AssetMarketHistoryPoint, AssetMarketHistoryRange } from '@/core/prices'
import { formatTimestamp } from '@/lib/format'
import { formatTokenPrice } from '@/lib/number-format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/popup/components/ui/skeleton'
import { InlineError } from '@/popup/components/common/InlineError'
import { useTranslation } from '@/popup/i18n'
import { portfolioMessages } from '@/popup/i18n/portfolio-messages'
import {
  buildMarketPriceChartModel,
  MARKET_PRICE_CHART_HEIGHT,
  MARKET_PRICE_CHART_PLOT_TOP,
  MARKET_PRICE_CHART_WIDTH,
  normalizeMarketPriceTimestamp
} from '@/popup/services/market-price-chart-model'

const RANGE_LABELS = {
  '1d': 'range1d',
  '1w': 'range1w',
  '1m': 'range1m',
  '3m': 'range3m',
  '1y': 'range1y',
  all: 'rangeAll'
} as const satisfies Readonly<Record<AssetMarketHistoryRange, keyof typeof portfolioMessages>>

// Ranges that span less than a few days show the time of day in the hover label.
const INTRADAY_RANGES: ReadonlySet<AssetMarketHistoryRange> = new Set(['1d', '1w'])

interface MarketPriceChartProps {
  readonly points: readonly AssetMarketHistoryPoint[] | null
  readonly range: AssetMarketHistoryRange
  readonly loading: boolean
  readonly priceLoading: boolean
  readonly priceLabel: string | null
  readonly changeLabel: string | null
  readonly changeDirection: 'positive' | 'negative' | 'neutral'
  readonly priceAsOf?: number
  readonly showRanges?: boolean
  readonly availableRanges: readonly AssetMarketHistoryRange[]
  readonly onRangeChange: (range: AssetMarketHistoryRange) => void
  readonly error?: string | null
  readonly onRetry?: () => void
}

export function MarketPriceChart({
  points,
  range,
  loading,
  priceLoading,
  priceLabel,
  changeLabel,
  changeDirection,
  priceAsOf,
  showRanges = true,
  availableRanges,
  onRangeChange,
  error,
  onRetry
}: MarketPriceChartProps) {
  const { t, locale } = useTranslation(portfolioMessages)
  const gradientId = useId().replace(/:/g, '')
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const chart = useMemo(() => buildMarketPriceChartModel(points), [points])

  const color = chart?.positive ? 'var(--color-success)' : 'var(--color-destructive)'
  // Replay the draw animation whenever the plotted series changes.
  const drawKey = `${range}:${chart?.coordinates.length ?? 0}`

  const active = chart && activeIndex !== null ? (chart.coordinates[activeIndex] ?? null) : null

  const updateActiveFromPointer = useCallback(
    (clientX: number) => {
      const surface = surfaceRef.current
      if (!surface || !chart) return
      const rect = surface.getBoundingClientRect()
      if (rect.width === 0) return
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const index = Math.round(ratio * (chart.coordinates.length - 1))
      setActiveIndex(index)
    },
    [chart]
  )

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
    [locale]
  )
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
    [locale]
  )
  const fullTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
    [locale]
  )
  const formatChartDate = (timestamp: number, intraday: boolean) => {
    if (locale === 'en') {
      return formatTimestamp(timestamp, intraday ? 'MMM D · HH:mm' : 'MMM D, YYYY')
    }
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? '' : (intraday ? timeFormat : dateFormat).format(date)
  }
  const hoverDateLabel = active
    ? formatChartDate(normalizeMarketPriceTimestamp(active.timestamp), INTRADAY_RANGES.has(range))
    : null
  const priceAsOfLabel = priceAsOf ? formatChartDate(priceAsOf, true) : null
  const priceAsOfTitle =
    priceAsOf && priceAsOfLabel
      ? t('priceAsOf', {
          date: locale === 'en' ? formatTimestamp(priceAsOf) : fullTimeFormat.format(priceAsOf)
        })
      : undefined

  return (
    <div>
      <div
        ref={surfaceRef}
        className={cn('relative touch-none overflow-hidden', showRanges ? 'h-[148px]' : 'h-16')}
        aria-live="polite"
        onPointerMove={event => {
          if (chart) updateActiveFromPointer(event.clientX)
        }}
        onPointerDown={event => {
          if (chart) updateActiveFromPointer(event.clientX)
        }}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <div className="absolute inset-x-0 top-0 z-10">
          {priceLoading && !priceLabel ? (
            <>
              <Skeleton className="h-7 w-24" />
              <Skeleton className="mt-1.5 h-3 w-16" />
            </>
          ) : (
            <>
              <p className="text-[26px] font-medium leading-none tracking-tight tabular-nums">
                {active
                  ? formatTokenPrice(active.priceUsd, { showSign: true })
                  : (priceLabel ?? '—')}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                {active ? (
                  <span className="text-muted">{hoverDateLabel}</span>
                ) : (
                  <>
                    {changeLabel && (
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'font-medium',
                            changeDirection === 'positive'
                              ? 'text-success'
                              : changeDirection === 'negative'
                                ? 'text-danger'
                                : 'text-muted'
                          )}
                        >
                          {changeLabel}
                        </span>
                        <span className="text-muted">{t('period24h')}</span>
                      </span>
                    )}
                    {priceAsOfLabel && (
                      <span className="text-muted" title={priceAsOfTitle}>
                        {t('priceAsOf', { date: priceAsOfLabel })}
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
        {loading && !chart ? (
          <Skeleton className="absolute inset-x-0 bottom-0 h-[92px] rounded-xl" />
        ) : chart ? (
          <>
            <svg
              role="img"
              aria-label={t('priceHistory', { range: t(RANGE_LABELS[range]) })}
              viewBox={`0 0 ${MARKET_PRICE_CHART_WIDTH} ${MARKET_PRICE_CHART_HEIGHT}`}
              preserveAspectRatio="none"
              className={cn('h-full w-full transition-opacity', loading && 'opacity-55')}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                key={`area:${drawKey}`}
                d={chart.area}
                fill={`url(#${gradientId})`}
                className="animate-in fade-in duration-700"
              />
              <path
                d={chart.line}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {active && (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 z-10 w-px bg-white/15"
                  style={{
                    left: `${(active.x / MARKET_PRICE_CHART_WIDTH) * 100}%`,
                    top: `${MARKET_PRICE_CHART_PLOT_TOP}px`
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
                  style={{
                    left: `${(active.x / MARKET_PRICE_CHART_WIDTH) * 100}%`,
                    top: `${(active.y / MARKET_PRICE_CHART_HEIGHT) * 100}%`,
                    backgroundColor: color
                  }}
                />
              </>
            )}
          </>
        ) : null}
      </div>

      {error && (
        <InlineError
          message={error}
          tone="muted"
          onRetry={onRetry}
          retryLabel={t('retry')}
          className="mt-2"
        />
      )}
      {showRanges && (availableRanges.length > 0 || loading) && (
        <div className="mt-2 flex h-7 items-center gap-1" aria-label={t('priceHistoryRange')}>
          {availableRanges.length > 0 ? (
            availableRanges.map(item => (
              <button
                key={item}
                type="button"
                aria-pressed={range === item}
                onClick={() => onRangeChange(item)}
                className={cn(
                  'wallet-interactive h-7 flex-1 rounded-md text-[11px] font-medium active:bg-white/10 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                  range === item
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted hover:bg-white/5 hover:text-foreground'
                )}
              >
                {t(RANGE_LABELS[item])}
              </button>
            ))
          ) : loading ? (
            <Skeleton className="h-7 w-full rounded-md" />
          ) : null}
        </div>
      )}
    </div>
  )
}
