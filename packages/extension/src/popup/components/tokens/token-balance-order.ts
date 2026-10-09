import type { SwapToken } from '@/core/services/intents-api'
import { parseTokenBalanceDecimal } from './token-balance-format'

interface RankedToken {
  readonly token: SwapToken
  readonly index: number
  readonly tier: number
  readonly amount: ReturnType<typeof parseTokenBalanceDecimal>
  readonly fiatValue: ReturnType<typeof parseTokenBalanceDecimal>
}

function rankToken(
  token: SwapToken,
  index: number,
  balances: ReadonlyMap<string, string> | undefined
): RankedToken {
  const hasBalance = balances?.has(token.assetId) ?? false
  const amount = hasBalance ? parseTokenBalanceDecimal(balances?.get(token.assetId)) : null
  const price = amount?.gt(0) ? parseTokenBalanceDecimal(token.price) : null
  const fiatValue = price?.gt(0) ? (amount?.times(price) ?? null) : null
  const tier = fiatValue?.gt(0) ? 0 : amount?.gt(0) ? 1 : hasBalance ? 2 : 3
  return Object.freeze({ token, index, tier, amount, fiatValue })
}

/** Sorts wallet-held assets by USD value without mutating the provider token list. */
export function sortTokensByBalanceValue(
  tokens: readonly SwapToken[],
  balances?: ReadonlyMap<string, string>
): readonly SwapToken[] {
  if (!balances) return tokens

  return Object.freeze(
    tokens
      .map((token, index) => rankToken(token, index, balances))
      .sort((left, right) => {
        if (left.tier !== right.tier) return left.tier - right.tier
        if (left.fiatValue && right.fiatValue && !left.fiatValue.eq(right.fiatValue)) {
          return left.fiatValue.gt(right.fiatValue) ? -1 : 1
        }
        if (left.amount && right.amount && !left.amount.eq(right.amount)) {
          return left.amount.gt(right.amount) ? -1 : 1
        }
        const symbolOrder = left.token.symbol.localeCompare(right.token.symbol)
        if (symbolOrder !== 0) return symbolOrder
        const chainOrder = left.token.blockchain.localeCompare(right.token.blockchain)
        if (chainOrder !== 0) return chainOrder
        const assetOrder = left.token.assetId.localeCompare(right.token.assetId)
        return assetOrder !== 0 ? assetOrder : left.index - right.index
      })
      .map(item => item.token)
  )
}
