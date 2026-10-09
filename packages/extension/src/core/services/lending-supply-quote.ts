import { parseQuoteSuccessResponse } from './intents-api'

export interface SupplyQuoteResult {
  depositAddress: string
  expectedReceived: string
  minAmountOut: string
  amountInRaw: string
  amountOutRaw: string
  minAmountOutRaw: string
  deadline: string
}

function formatRawAmount(rawAmount: string, decimals: number): string {
  const padded = rawAmount.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  return fraction.length === 0 ? whole : `${whole}.${fraction}`
}

export function parseSupplyQuoteResult(value: unknown, destinationDecimals = 8): SupplyQuoteResult {
  if (
    !Number.isSafeInteger(destinationDecimals) ||
    destinationDecimals < 0 ||
    destinationDecimals > 30
  ) {
    throw new Error('Invalid lending supply destination decimals')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid lending supply quote')
  }
  const record = value as Record<string, unknown>
  if (typeof record.depositAddress !== 'string') {
    throw new Error('Invalid lending supply deposit address')
  }
  const quoteResult = parseQuoteSuccessResponse(record.quoteSuccessResult)
  const quote = quoteResult.quoteSuccessResult?.quote
  if (!quote || quote.depositAddress !== record.depositAddress) {
    throw new Error('Lending supply quote deposit address does not match its response')
  }
  return Object.freeze({
    depositAddress: quote.depositAddress,
    expectedReceived: quote.amountOutFormatted,
    minAmountOut: formatRawAmount(quote.minAmountOut, destinationDecimals),
    amountInRaw: quote.amountIn,
    amountOutRaw: quote.amountOut,
    minAmountOutRaw: quote.minAmountOut,
    deadline: quote.deadline
  })
}
