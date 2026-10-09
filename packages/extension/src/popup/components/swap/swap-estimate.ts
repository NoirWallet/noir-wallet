import Big from '@/lib/big'

export function estimateSwapOutputFromPrices({
  amountIn,
  tokenInPrice,
  tokenOutPrice
}: {
  readonly amountIn: string
  readonly tokenInPrice: number | null | undefined
  readonly tokenOutPrice: number | null | undefined
}): string {
  if (
    typeof tokenInPrice !== 'number' ||
    typeof tokenOutPrice !== 'number' ||
    !Number.isFinite(tokenInPrice) ||
    !Number.isFinite(tokenOutPrice) ||
    tokenInPrice <= 0 ||
    tokenOutPrice <= 0
  ) {
    return ''
  }

  try {
    const amount = new Big(amountIn)
    if (amount.lte(0)) return ''
    return amount.mul(tokenInPrice).div(tokenOutPrice).toFixed()
  } catch {
    return ''
  }
}
