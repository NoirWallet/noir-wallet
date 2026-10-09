import { expect, test } from '@playwright/test'
import { calculateSwapUsdAmount } from '../src/lib/analytics/swap.ts'

test('swap USD analytics values both ZEC and non-ZEC source assets', () => {
  expect(
    calculateSwapUsdAmount({ amountIn: '0.5', inputPrice: 20, amountOut: '8', outputPrice: 1 })
  ).toBe('10.00')
  expect(calculateSwapUsdAmount({ amountIn: '12.5', inputPrice: 1 })).toBe('12.50')
})

test('swap USD analytics falls back to quoted output when the input price is unavailable', () => {
  expect(
    calculateSwapUsdAmount({ amountIn: '1', inputPrice: 0, amountOut: '3.25', outputPrice: 2 })
  ).toBe('6.50')
  expect(calculateSwapUsdAmount({ amountIn: '1', inputPrice: Number.NaN })).toBeUndefined()
})
