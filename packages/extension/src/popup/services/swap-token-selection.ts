import { getDefaultToToken, isZecToken, type SwapToken } from '@/core/services/intents-api'
import type { SavedSwapTokenSelection } from '@/store/swap-store'

export interface ResolvedSwapTokenSelection {
  readonly tokenIn: SwapToken
  readonly tokenOut: SwapToken | null
}

export function matchesSwapTokenSearch(token: SwapToken, search: string): boolean {
  const normalizedSearch = search.trim().toLowerCase()
  if (normalizedSearch.length === 0) return true
  if (token.symbol.toLowerCase().includes(normalizedSearch)) return true
  return token.contractAddress?.toLowerCase() === normalizedSearch
}

export function compareSwapTokenSearchRelevance(
  left: SwapToken,
  right: SwapToken,
  search: string
): number {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return 0
  const rank = (token: SwapToken): number => {
    const symbol = token.symbol.toLowerCase()
    if (symbol === normalizedSearch || token.contractAddress?.toLowerCase() === normalizedSearch) {
      return 0
    }
    if (symbol.startsWith(normalizedSearch)) return 1
    return 2
  }
  return rank(left) - rank(right)
}

export function createSwapTokenPreferenceScope(
  walletId: string | null,
  accountId: string | null
): string | null {
  return walletId && accountId ? `${walletId}:${accountId}` : null
}

export function getSavedSwapDestinationAssetId(
  selection: SavedSwapTokenSelection | undefined,
  sourceAssetId: string | null | undefined = selection?.tokenInId
): string | undefined {
  return selection?.tokenOutId && selection.tokenOutId !== sourceAssetId
    ? selection.tokenOutId
    : undefined
}

export function shouldWaitForSwapDestination(input: {
  readonly loading: boolean
  readonly savedDestinationAssetId?: string | null
  readonly resolvedDestinationAssetId?: string | null
}): boolean {
  return (
    input.loading &&
    (!input.savedDestinationAssetId ||
      input.resolvedDestinationAssetId !== input.savedDestinationAssetId)
  )
}

function findDefaultDestination(
  tokenIn: SwapToken,
  tokens: readonly SwapToken[],
  walletSourceTokens: readonly SwapToken[]
): SwapToken | null {
  const destinations = tokens.filter(token => token.assetId !== tokenIn.assetId)
  if (!isZecToken(tokenIn)) {
    const sameChainWalletAsset = walletSourceTokens.find(
      token =>
        token.assetId !== tokenIn.assetId &&
        token.blockchain === tokenIn.blockchain &&
        destinations.some(
          destination =>
            destination.assetId === token.assetId && destination.blockchain === token.blockchain
        )
    )
    if (sameChainWalletAsset) return sameChainWalletAsset
  }
  return getDefaultToToken(destinations) ?? destinations[0] ?? null
}

export function getSwapDestinationTokens<T extends SwapToken>(
  tokenIn: SwapToken | null,
  sourceTokens: readonly T[],
  crossChainTokens: readonly T[]
): readonly T[] {
  const eligible = tokenIn
    ? [
        ...sourceTokens.filter(token => token.blockchain === tokenIn.blockchain),
        ...crossChainTokens.filter(token => token.blockchain !== tokenIn.blockchain)
      ]
    : [...sourceTokens, ...crossChainTokens]
  return [
    ...new Map(eligible.map(token => [`${token.blockchain}:${token.assetId}`, token])).values()
  ]
}

export function resolveSwapTokenSelection(input: {
  readonly tokens: readonly SwapToken[]
  readonly walletSourceTokens: readonly SwapToken[]
  readonly sourceTokens?: readonly SwapToken[]
  readonly crossChainDestinationTokens?: readonly SwapToken[]
  readonly savedSelection?: SavedSwapTokenSelection
  readonly requestedSourceAssetId?: string | null
  readonly preferredSourceAssetId?: string
}): ResolvedSwapTokenSelection | null {
  if (input.walletSourceTokens.length === 0) return null
  const tokenIn =
    input.tokens.find(token => token.assetId === input.requestedSourceAssetId) ??
    input.tokens.find(token => token.assetId === input.savedSelection?.tokenInId) ??
    input.walletSourceTokens.find(token => token.assetId === input.preferredSourceAssetId) ??
    input.walletSourceTokens[0]
  const destinations = getSwapDestinationTokens(
    tokenIn,
    input.sourceTokens ?? input.tokens,
    input.crossChainDestinationTokens ?? input.tokens
  )
  const tokenOut =
    destinations.find(
      token =>
        token.assetId === input.savedSelection?.tokenOutId && token.assetId !== tokenIn.assetId
    ) ?? findDefaultDestination(tokenIn, destinations, input.walletSourceTokens)
  return Object.freeze({ tokenIn, tokenOut })
}
