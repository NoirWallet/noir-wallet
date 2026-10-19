/**
 * NEAR Intents API service for cross-chain swap quotes and status tracking
 */

import { config_near } from '@rhea-finance/cross-chain-sdk'
import {
  ZEC_ZCASH_ASSET,
  WNEAR_NEAR_ASSET,
  NOIR_SWAP_APP_FEES,
  NOIR_SWAP_REFERRAL
} from '@/config/near'
import {
  FetchHttpError,
  FetchResponseTooLargeError,
  FetchTimeoutError,
  fetchJsonWithTimeout
} from '@/lib/fetch-utils'
import { DedupPromise } from '@/lib/async-utils'
import { createIntentsDeadline } from '@/lib/intents-timeouts'

const INTENTS_API_BASE = 'https://api.rhea.finance/api/1click'
const ONECLICK_TOKENS_API = 'https://1click.chaindefuser.com/v0/tokens'
const TOKEN_ICONS_API = `${config_near.indexUrl}/get_multichain_lending_tokens_data`

export const SWAP_QUOTE_UNAVAILABLE_MESSAGE =
  'Swap quote service is temporarily unavailable. Please try again shortly.'

function getSwapQuoteErrorMessage(error: unknown): string {
  if (error instanceof FetchTimeoutError) {
    return 'Swap quote request timed out. Please try again.'
  }
  if (error instanceof FetchResponseTooLargeError) return SWAP_QUOTE_UNAVAILABLE_MESSAGE
  if (error instanceof FetchHttpError) {
    if (error.status === 429) {
      return 'Swap quote service is busy. Please try again shortly.'
    }
    if (error.status >= 500) return SWAP_QUOTE_UNAVAILABLE_MESSAGE
    if (error.detail) return error.detail
    return `Swap quote request failed (HTTP ${error.status}). Please try again.`
  }
  if (error instanceof TypeError) {
    return 'Unable to reach the swap quote service. Check your connection and try again.'
  }
  return error instanceof Error ? error.message : 'Failed to get quote'
}

export interface SwapToken {
  assetId: string
  blockchain: string
  contractAddress?: string
  decimals: number
  icon?: string | null
  price: number
  priceUpdatedAt: string
  symbol: string
  coingeckoId?: string
}

export interface QuoteParams {
  originAsset: string
  destinationAsset: string
  amount: string
  refundTo: string
  recipient: string
  slippageTolerance?: number
  dry?: boolean
  originChain: string
  destinationChain: string
  referral?: string
}

export interface QuoteResult {
  quoteStatus: 'success' | 'error'
  message?: string
  quoteSuccessResult?: {
    quote: {
      amountIn: string
      amountOut: string
      minAmountOut: string
      amountInFormatted: string
      amountOutFormatted: string
      amountInUsd?: string
      amountOutUsd?: string
      depositAddress: string
      deadline: string
    }
  }
}

export type SwapStatusType =
  | 'KNOWN_DEPOSIT_TX'
  | 'PENDING_DEPOSIT'
  | 'INCOMPLETE_DEPOSIT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'REFUNDED'
  | 'FAILED'

export interface SwapStatus {
  status: SwapStatusType
  swapDetails?: {
    amountOutFormatted?: string
    originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>
  }
  originAsset?: string
  destinationAsset?: string
}

interface SwapStatusApiResponse {
  status?: string
  swapDetails?: SwapStatus['swapDetails']
  status_response?: { status?: string; swapDetails?: SwapStatus['swapDetails'] }
  quoteResponse?: { quoteRequest?: { originAsset?: string; destinationAsset?: string } }
  quote_response?: { quoteRequest?: { originAsset?: string; destinationAsset?: string } }
}

const SWAP_STATUSES = new Set<SwapStatusType>([
  'KNOWN_DEPOSIT_TX',
  'PENDING_DEPOSIT',
  'INCOMPLETE_DEPOSIT',
  'PROCESSING',
  'SUCCESS',
  'REFUNDED',
  'FAILED'
])

// Token list cache (full list + USD prices from the 1Click API)
let tokenCache: SwapToken[] = []
let tokenCacheTime = 0
const TOKEN_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Coalesces concurrent (mount / selector / price-poll) fetches into one request
const fetchDedup = new DedupPromise<SwapToken[]>()

// assetId -> icon URL. 1Click has no icons, so we backfill once from rhea.
const iconMap = new Map<string, string>()
let iconsLoaded = false

/**
 * Backfills token icons (absent from the 1Click API) from the rhea multichain
 * endpoint. Chains are derived from the 1Click list, so no chain list needs
 * maintaining. Runs once per session; a failure just leaves the letter
 * fallback and is retried on the next fetch.
 */
async function ensureIconsLoaded(tokens: SwapToken[]): Promise<void> {
  if (iconsLoaded) return
  try {
    const chains = [...new Set(tokens.map(t => t.blockchain))].join(',')
    const iconTokens = await fetchJsonWithTimeout<Array<{ assetId: string; icon?: string | null }>>(
      `${TOKEN_ICONS_API}?chains=${chains}`,
      {
        timeoutMs: 15000,
        maxBytes: 8 * 1024 * 1024
      }
    )
    for (const t of iconTokens) {
      if (t.icon) iconMap.set(t.assetId, t.icon)
    }
    iconsLoaded = true
  } catch (error) {
    console.error('Error loading token icons:', error)
  }
}

async function fetchAllTokens(): Promise<SwapToken[]> {
  const tokens = await fetchJsonWithTimeout<SwapToken[]>(ONECLICK_TOKENS_API, {
    timeoutMs: 15000,
    maxBytes: 8 * 1024 * 1024
  })
  await ensureIconsLoaded(tokens)
  const enriched = tokens.map(token => ({ ...token, icon: iconMap.get(token.assetId) ?? null }))
  tokenCache = enriched
  tokenCacheTime = Date.now()
  return enriched
}

/**
 * Fetches the full swap token list (with USD prices) from the 1Click API.
 * Cached with a TTL; concurrent callers share one in-flight request.
 * Pass `forceRefresh` to bypass the cache — used by price polling.
 */
export async function fetchSwapTokens(forceRefresh = false): Promise<SwapToken[]> {
  const now = Date.now()
  if (!forceRefresh && tokenCache.length > 0 && now - tokenCacheTime < TOKEN_CACHE_TTL) {
    return tokenCache
  }

  try {
    return await fetchDedup.run(fetchAllTokens)
  } catch (error) {
    console.error('Error fetching swap tokens:', error)
    return tokenCache.length > 0 ? tokenCache : []
  }
}

/**
 * Gets cached tokens without fetching
 */
export function getCachedTokens(): SwapToken[] {
  return tokenCache
}

/**
 * Gets the ZEC token from the token list, prioritizing native ZEC
 */
export function getZecToken(tokens: SwapToken[]): SwapToken | null {
  return (
    tokens.find(t => t.blockchain === 'zec' || t.blockchain === 'zcash') ||
    tokens.find(t => t.symbol === 'ZEC' && t.assetId === ZEC_ZCASH_ASSET) ||
    null
  )
}

/**
 * Gets non-ZEC tokens for the token selector
 */
export function getOtherTokens(tokens: SwapToken[]): SwapToken[] {
  return tokens.filter(t => t.blockchain !== 'zec' && t.blockchain !== 'zcash')
}

/**
 * Default "to" token for the swap form: native NEAR (wNEAR), falling back to
 * the first non-ZEC token when unavailable.
 */
export function getDefaultToToken(tokens: SwapToken[]): SwapToken | null {
  return tokens.find(t => t.assetId === WNEAR_NEAR_ASSET) || getOtherTokens(tokens)[0] || null
}

/**
 * Checks if the given token is ZEC
 */
export function isZecToken(token: SwapToken | null): boolean {
  if (!token) return false
  return token.blockchain === 'zec' || token.blockchain === 'zcash'
}

const DUMMY_ADDRESSES: Record<string, string> = {
  near: 'noir-wallet-placeholder.near',
  eth: '0x0000000000000000000000000000000000000001',
  arb: '0x0000000000000000000000000000000000000001',
  base: '0x0000000000000000000000000000000000000001',
  op: '0x0000000000000000000000000000000000000001',
  bsc: '0x0000000000000000000000000000000000000001',
  bera: '0x0000000000000000000000000000000000000001',
  sol: '11111111111111111111111111111111',
  btc: 'bc1qq5eqm72aglw8hy6z5r9rn56zwexd9ra83m9aa7',
  zec: 't1JeD77bXpj67Fe1umL1ZkpqrnPT1pPfbHA',
  zcash: 't1JeD77bXpj67Fe1umL1ZkpqrnPT1pPfbHA'
}

function getDummyAddress(blockchain: string): string {
  return DUMMY_ADDRESSES[blockchain] || DUMMY_ADDRESSES['near']
}

export interface DryQuoteParams {
  tokenIn: SwapToken
  tokenOut: SwapToken
  amount: string
  slippageTolerance?: number
  referral?: string
}

/**
 * Fetches a dry quote for real-time swap estimation (no deposit address generated)
 */
export async function fetchDryQuote(params: DryQuoteParams): Promise<string | null> {
  const { tokenIn, tokenOut, amount, slippageTolerance } = params
  const isZecFrom = isZecToken(tokenIn)
  const refundTo = isZecFrom ? getDummyAddress('zec') : getDummyAddress(tokenIn.blockchain)
  const recipient = isZecFrom ? getDummyAddress(tokenOut.blockchain) : getDummyAddress('zec')

  const result = await fetchQuote({
    originAsset: tokenIn.assetId,
    destinationAsset: tokenOut.assetId,
    amount,
    refundTo,
    recipient,
    originChain: tokenIn.blockchain,
    destinationChain: tokenOut.blockchain,
    dry: true,
    slippageTolerance,
    referral: params.referral
  })

  if (result.quoteStatus === 'success' && result.quoteSuccessResult?.quote) {
    return result.quoteSuccessResult.quote.amountOutFormatted
  }
  return null
}

/**
 * Fetches cross-chain swap quote from the API
 */
export async function fetchQuote(params: QuoteParams): Promise<QuoteResult> {
  try {
    const requestBody = {
      originAsset: params.originAsset,
      destinationAsset: params.destinationAsset,
      amount: params.amount,
      refundTo: params.refundTo,
      recipient: params.recipient,
      dry: params.dry || false,
      swapType: 'EXACT_INPUT',
      refundType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      depositType: 'ORIGIN_CHAIN',
      deadline: createIntentsDeadline(params.originChain, params.destinationChain),
      referral: params.referral || NOIR_SWAP_REFERRAL,
      quoteWaitingTimeMs: 3000,
      slippageTolerance: params.slippageTolerance || 50,
      appFees: NOIR_SWAP_APP_FEES
    }

    const data = await fetchJsonWithTimeout<
      Partial<NonNullable<QuoteResult['quoteSuccessResult']>> & { message?: string }
    >(`${INTENTS_API_BASE}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      timeoutMs: 20000,
      maxBytes: 1024 * 1024
    })

    if (data?.quote) {
      return {
        quoteStatus: 'success',
        quoteSuccessResult: { quote: data.quote }
      }
    } else {
      return {
        quoteStatus: 'error',
        message: data?.message || 'Failed to get quote'
      }
    }
  } catch (error) {
    return {
      quoteStatus: 'error',
      message: getSwapQuoteErrorMessage(error)
    }
  }
}

/**
 * Fetches the current swap status for a deposit address
 */
export async function fetchSwapStatus(depositAddress: string): Promise<SwapStatus | null> {
  try {
    const data = await fetchJsonWithTimeout<SwapStatusApiResponse>(
      `${INTENTS_API_BASE}/status?depositAddress=${depositAddress}`,
      {
        timeoutMs: 15000,
        maxBytes: 1024 * 1024
      }
    )
    const swapDetails = data?.swapDetails || data?.status_response?.swapDetails
    const rawStatus = data?.status || data?.status_response?.status
    if (typeof rawStatus !== 'string' || !SWAP_STATUSES.has(rawStatus as SwapStatusType)) {
      return null
    }
    return {
      status: rawStatus as SwapStatusType,
      swapDetails,
      originAsset:
        data?.quoteResponse?.quoteRequest?.originAsset ||
        data?.quote_response?.quoteRequest?.originAsset,
      destinationAsset:
        data?.quoteResponse?.quoteRequest?.destinationAsset ||
        data?.quote_response?.quoteRequest?.destinationAsset
    }
  } catch (error) {
    console.error('Error fetching swap status:', error)
    return null
  }
}

/**
 * Polls swap status until completion (SUCCESS, REFUNDED, or FAILED)
 */
export async function pollingSwapStatus(
  depositAddress: string,
  onStatusChange?: (status: SwapStatus) => void,
  options?: { interval?: number; maxRetries?: number; signal?: AbortSignal }
): Promise<SwapStatus> {
  const interval = options?.interval ?? 5000
  const maxRetries = options?.maxRetries ?? 360
  const signal = options?.signal

  return new Promise((resolve, reject) => {
    let retries = 0

    const poll = async () => {
      if (signal?.aborted) {
        reject(new DOMException('Swap polling aborted', 'AbortError'))
        return
      }

      retries++
      const status = await fetchSwapStatus(depositAddress)

      if (status) {
        onStatusChange?.(status)

        if (
          status.status === 'SUCCESS' ||
          status.status === 'REFUNDED' ||
          status.status === 'FAILED'
        ) {
          resolve(status)
          return
        }
      }

      if (retries >= maxRetries) {
        reject(new Error(`Swap polling timed out after ${retries} attempts`))
        return
      }

      const timeoutId = setTimeout(poll, interval)
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeoutId)
          reject(new DOMException('Swap polling aborted', 'AbortError'))
        },
        { once: true }
      )
    }

    poll()
  })
}
