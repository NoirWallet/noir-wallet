import type { PortfolioChainView } from '@/core/portfolio'
import Big from '@/lib/big'
import { formatTokenQuantity } from '@/lib/number-format'

const RAW_AMOUNT_PATTERN = /^(0|[1-9][0-9]*)$/
const DISPLAY_AMOUNT_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]*)?$/

function groupWholeUnits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Portfolio and Activity share the summary quantity profile. */
export function formatDisplayAmount(value: Big): string {
  if (value.lt(0)) throw new Error('Invalid display amount')
  return formatTokenQuantity(value.toFixed())
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

/** Activity uses the same quantity profile as holdings. */
export function formatActivityTokenAmount(rawAmount: string, decimals: number): string {
  return formatDisplayTokenAmount(rawAmount, decimals)
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
