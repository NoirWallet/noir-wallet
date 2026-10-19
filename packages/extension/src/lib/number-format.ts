import Big from './big'

export type NumericValue = string | number | null | undefined

export interface FormattedReviewAmount {
  readonly display: string
  readonly exact: string | null
  readonly full: string
  readonly isRounded: boolean
}

const UNKNOWN = '—'
const GROUPED_DECIMAL = /^[+-]?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function parseNumericValue(value: NumericValue): Big | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value)
  if (text.length > 1_024) return null
  const normalized = GROUPED_DECIMAL.test(text) ? text.replace(/,/g, '') : text
  if (!DECIMAL.test(normalized)) return null
  try {
    const parsed = new Big(normalized)
    // Bound expansion of untrusted scientific notation before calling toFixed.
    return Math.abs(parsed.e) <= 1_024 ? parsed : null
  } catch {
    return null
  }
}

function groupDecimal(value: string): string {
  const [whole, fraction] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${grouped}.${fraction}` : grouped
}

function minimumAt(decimals: number): string {
  return decimals === 0 ? '1' : `0.${'0'.repeat(decimals - 1)}1`
}

function belowMinimum(value: Big, decimals: number, prefix = ''): string {
  return `${value.lt(0) ? '-' : ''}<${prefix}${minimumAt(decimals)}`
}

function significantFractionDigits(value: Big, maximum: number): number {
  return Math.min(maximum, Math.max(0, 3 - value.abs().e))
}

/** Shared decimal rendering for explicit precision, without a Number conversion. */
export function formatDecimalAmount(
  value: NumericValue,
  options: {
    maximumFractionDigits: number
    roundingMode?: Big.RoundingMode
    displayMinimum?: boolean
    fallback?: string
  }
): string {
  const parsed = parseNumericValue(value)
  if (!parsed) return options.fallback ?? UNKNOWN
  if (parsed.eq(0)) return '0'
  const decimals = options.maximumFractionDigits
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) return UNKNOWN
  if (options.displayMinimum !== false && parsed.abs().lt(minimumAt(decimals))) {
    return belowMinimum(parsed, decimals)
  }
  return groupDecimal(parsed.round(decimals, options.roundingMode ?? Big.roundDown).toFixed())
}

/** List balances and activity quantities never round above the held magnitude. */
export function formatTokenQuantity(value: NumericValue): string {
  const parsed = parseNumericValue(value)
  if (!parsed) return UNKNOWN
  const magnitude = parsed.abs()
  const decimals = magnitude.gte(1_000)
    ? 2
    : magnitude.gte(1)
      ? 4
      : significantFractionDigits(parsed, 8)
  return formatDecimalAmount(value, { maximumFractionDigits: decimals })
}

/** A shortened review is always paired with the exact, copyable decimal value. */
export function formatReviewAmount(value: NumericValue): FormattedReviewAmount {
  const parsed = parseNumericValue(value)
  if (!parsed) return { display: UNKNOWN, exact: null, full: UNKNOWN, isRounded: false }
  const exact = parsed.toFixed()
  const full = groupDecimal(exact)
  const rounded = parsed.round(8, Big.roundDown)
  const isRounded = !parsed.eq(rounded)
  const display = isRounded
    ? parsed.abs().lt('0.00000001')
      ? belowMinimum(parsed, 8)
      : `${groupDecimal(rounded.toFixed())}…`
    : full
  return { display, exact, full, isRounded }
}

/** Fees keep four significant digits, retain every integer, and round up. */
export function formatFeeAmount(value: NumericValue): string {
  const parsed = parseNumericValue(value)
  if (!parsed) return UNKNOWN
  return formatDecimalAmount(value, {
    maximumFractionDigits: significantFractionDigits(parsed, 12),
    roundingMode: Big.roundUp
  })
}

/** Fiat valuations use cents; token unit prices have their own formatter. */
export function formatFiatAmount(value: NumericValue, options?: { showSign?: boolean }): string {
  const parsed = parseNumericValue(value)
  if (!parsed) return UNKNOWN
  const prefix = options?.showSign ? '$' : ''
  if (!parsed.eq(0) && parsed.abs().lt('0.01')) return belowMinimum(parsed, 2, prefix)
  const sign = parsed.lt(0) ? '-' : ''
  return `${sign}${prefix}${groupDecimal(parsed.abs().toFixed(2, Big.roundHalfUp))}`
}

/** Only unit prices compact runs of fractional zeroes into a subscript count. */
export function formatTokenPrice(value: NumericValue, options?: { showSign?: boolean }): string {
  const parsed = parseNumericValue(value)
  if (!parsed) return UNKNOWN
  if (parsed.eq(0) || parsed.abs().gte(1)) return formatFiatAmount(value, options)
  const rounded = parsed.abs().prec(4, Big.roundHalfUp).toFixed()
  const fraction = rounded.split('.')[1] ?? ''
  const leadingZeros = fraction.match(/^0*/)?.[0].length ?? 0
  const subscript = '₀₁₂₃₄₅₆₇₈₉'
  const display =
    fraction.length > 8 && leadingZeros > 3
      ? `0.0${String(leadingZeros).replace(/\d/g, digit => subscript[Number(digit)])}${fraction.slice(leadingZeros)}`
      : rounded
  return `${parsed.lt(0) ? '-' : ''}${options?.showSign ? '$' : ''}${display}`
}

export function formatPercentage(
  value: NumericValue,
  options?: {
    maxDigits?: number
    showPlus?: boolean
    decimals?: number
    rm?: Big.RoundingMode
    displayMinimum?: boolean
  }
): string {
  const parsed = parseNumericValue(value)
  if (!parsed) return UNKNOWN
  const scaled = parsed.times(new Big(10).pow(options?.decimals ?? 0))
  const formatted = formatDecimalAmount(scaled.toFixed(), {
    maximumFractionDigits: options?.maxDigits ?? 2,
    roundingMode: options?.rm ?? Big.roundHalfUp,
    displayMinimum: options?.displayMinimum
  })
  return `${options?.showPlus && scaled.gt(0) ? '+' : ''}${formatted}%`
}
