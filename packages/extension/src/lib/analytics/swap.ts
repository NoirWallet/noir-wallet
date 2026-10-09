import { safeBig } from '@/lib/big'

interface SwapUsdAmountParams {
  amountIn?: string
  inputPrice?: number
  amountOut?: string
  outputPrice?: number
}

export function calculateSwapUsdAmount({
  amountIn,
  inputPrice,
  amountOut,
  outputPrice
}: SwapUsdAmountParams): string | undefined {
  const candidates = [
    { amount: amountIn, price: inputPrice },
    { amount: amountOut, price: outputPrice }
  ]

  for (const { amount, price } of candidates) {
    if (!amount || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
    const parsedAmount = safeBig(amount)
    if (parsedAmount.lte(0)) continue
    return parsedAmount.mul(price).toFixed(2)
  }

  return undefined
}
