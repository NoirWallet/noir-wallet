import type { PortfolioChainView } from '@/core/portfolio'
import Big from '@/lib/big'
import { formatNumberWithSubscript } from '@/lib/format'

const RAW_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)$/
const DISPLAY_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*)?$/

// Fixed significant fraction digits kept for sub-1 balances (added on top of the
// leading zeros), so 0.00586768… renders as 0.005868 instead of overflowing.
const DISPLAY_SIGNIFICANT_FRACTION_DIGITS = 4

function groupWholeUnits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function trimTrailingZeros(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
}

/**
 * Compact, width-bounded rendering of an already-decimal balance for display
 * surfaces (portfolio rows, asset detail). Transaction/review screens keep full
 * precision via {@link formatBaseUnitAmount}; this one adapts the shown fraction
 * to the magnitude so a value never overflows the row:
 * - ≥ 1,000,000 collapses to compact `M`/`B`
 * - ≥ 1,000 shows 2 fraction digits, ≥ 1 shows 4
 * - < 1 shows the leading zeros plus 4 significant digits, compacting four or
 *   more leading zeros into a subscript count
 * Rounding is exact (Big), never float, so large 18-decimal balances stay precise.
 */
export function formatDisplayAmount(value: Big): string {
  if (value.lt(0)) throw new Error('Invalid display amount')
  if (value.eq(0)) return '0'

  if (value.gte(1_000_000_000)) {
    return `${trimTrailingZeros(value.div(1_000_000_000).round(2, Big.roundHalfUp).toFixed(2))}B`
  }
  if (value.gte(1_000_000)) {
    return `${trimTrailingZeros(value.div(1_000_000).round(2, Big.roundHalfUp).toFixed(2))}M`
  }

  let maximumFractionDigits: number
  if (value.gte(1_000)) {
    maximumFractionDigits = 2
  } else if (value.gte(1)) {
    maximumFractionDigits = 4
  } else {
    const fraction = value.toFixed().split('.')[1] ?? ''
    const leadingZeros = fraction.match(/^0*/)?.[0].length ?? 0
    if (leadingZeros > 3) return formatNumberWithSubscript(value.toFixed())
    maximumFractionDigits = leadingZeros + DISPLAY_SIGNIFICANT_FRACTION_DIGITS
  }

  const fixed = value.round(maximumFractionDigits, Big.roundHalfUp).toFixed(maximumFractionDigits)
  const [whole, fraction = ''] = fixed.split('.')
  const trimmedFraction = fraction.replace(/0+$/, '')
  const grouped = groupWholeUnits(whole)
  return trimmedFraction ? `${grouped}.${trimmedFraction}` : grouped
}

/** Base-unit convenience wrapper around {@link formatDisplayAmount}. */
export function formatDisplayTokenAmount(rawAmount: string, decimals: number): string {
  if (
    !RAW_AMOUNT_PATTERN.test(rawAmount) ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new Error('Invalid base-unit amount')
  }
  return formatDisplayAmount(new Big(rawAmount).div(new Big(10).pow(decimals)))
}

/** Keeps compact portfolio formatting while avoiding subscript notation in transaction history. */
export function formatActivityTokenAmount(rawAmount: string, decimals: number): string {
  const compact = formatDisplayTokenAmount(rawAmount, decimals)
  if (!/[₀-₉]/u.test(compact)) return compact

  const value = new Big(rawAmount).div(new Big(10).pow(decimals))
  const exact = value.toFixed()
  if (exact.length <= 10) return exact

  const [coefficient, exponent] = value.toExponential(3).split('e')
  return `${trimTrailingZeros(coefficient)}e${exponent}`
}

export function formatNetworkDisplayName(displayName: string, networkName: string): string {
  const normalizedNetwork = networkName.toLowerCase()
  const displayWords = displayName.toLowerCase().split(/[\s_-]+/)
  const networkWords = normalizedNetwork.split(/[\s_-]+/)
  if (networkWords.includes('mainnet')) {
    return displayName.replace(/\s+mainnet$/i, '').trim()
  }
  if (
    networkWords.some(word =>
      ['testnet', 'testnet3', 'devnet', 'sepolia', 'amoy', 'fuji'].includes(word)
    ) &&
    networkWords.some(word => displayWords.includes(word.replace(/\d+$/, '')))
  ) {
    return displayName
  }
  if (displayWords.includes(normalizedNetwork)) return displayName
  return `${displayName} · ${networkName.charAt(0).toUpperCase()}${networkName.slice(1)}`
}

export function formatPortfolioNetworkName(chain: PortfolioChainView): string {
  return formatNetworkDisplayName(chain.chain.displayName, chain.chain.network.name)
}

export function formatBaseUnitAmount(
  rawAmount: string,
  decimals: number,
  maximumFractionDigits?: number
): string {
  if (
    !RAW_AMOUNT_PATTERN.test(rawAmount) ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    (maximumFractionDigits !== undefined &&
      (!Number.isSafeInteger(maximumFractionDigits) || maximumFractionDigits < 1))
  ) {
    throw new Error('Invalid base-unit amount')
  }

  if (decimals === 0) {
    return groupWholeUnits(rawAmount)
  }

  const padded = rawAmount.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')

  if (fraction.length === 0) {
    return groupWholeUnits(whole)
  }

  if (maximumFractionDigits === undefined || fraction.length <= maximumFractionDigits) {
    return `${groupWholeUnits(whole)}.${fraction}`
  }

  const visibleFraction = fraction.slice(0, maximumFractionDigits)
  if (whole === '0' && /^0+$/.test(visibleFraction)) {
    return `< 0.${'0'.repeat(maximumFractionDigits - 1)}1`
  }

  return `${groupWholeUnits(whole)}.${visibleFraction}…`
}

/** Returns an ungrouped, unabridged decimal string suitable for arithmetic. */
export function formatBaseUnitDecimalAmount(rawAmount: string, decimals: number): string {
  if (
    !RAW_AMOUNT_PATTERN.test(rawAmount) ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new Error('Invalid base-unit amount')
  }

  return new Big(rawAmount).div(new Big(10).pow(decimals)).toFixed()
}

export function parseDisplayUnitAmount(value: string, decimals: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    !DISPLAY_AMOUNT_PATTERN.test(value) ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new Error('Invalid display-unit amount')
  }

  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals) {
    throw new Error('Display-unit amount exceeds asset precision')
  }
  const normalized = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  if (!RAW_AMOUNT_PATTERN.test(normalized)) {
    throw new Error('Invalid display-unit amount')
  }
  return normalized
}
