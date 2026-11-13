import { SwapSdkError } from '@rhea-finance/cross-chain-aggregation-dex'
import { readBoundedResponseText } from '@/lib/fetch-utils'
import { getRheaSwapMinimumAmountMessage } from './rhea-swap-error'

const MAXIMUM_QUOTE_ERROR_BYTES = 64 * 1024
const CROSSCHAIN_PATHS: Readonly<Record<string, string>> = {
  '/api/swap/quote': '/crosschain/swap/quote',
  '/api/swap/swap': '/crosschain/swap/swap',
  '/api/swap/report': '/crosschain/swap/report'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readQuoteFailure(value: unknown, depth = 0): 'timeout' | 'no-route' | null {
  if (depth >= 4 || !isRecord(value)) return null
  let failure: 'timeout' | 'no-route' | null = null
  for (const key of ['code', 'errorCode', 'reason']) {
    const code = typeof value[key] === 'string' ? value[key].trim().toLowerCase() : ''
    if (code === 'quote_timeout' || code === 'request_timeout') return 'timeout'
    if (
      code === 'route_not_found' ||
      code === 'route_unavailable' ||
      code === 'confidential_route_unavailable' ||
      code === 'no_route'
    ) {
      failure = 'no-route'
    }
  }
  for (const key of ['data', 'error']) {
    const nested = readQuoteFailure(value[key], depth + 1)
    if (nested === 'timeout') return nested
    failure ??= nested
  }
  return failure
}

/** Adapt SDK 2.0.6 endpoints and preserve quote failure categories. */
export function createRheaSwapFetch(fetchImplementation: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = CROSSCHAIN_PATHS[url.pathname]
    if (path) {
      url.pathname = path
      input = input instanceof Request ? new Request(url, input) : url
    }
    const response = await fetchImplementation(input, init)
    if (
      url.pathname !== '/crosschain/swap/quote' ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429
    ) {
      return response
    }
    let payload: unknown
    try {
      payload = JSON.parse(
        await readBoundedResponseText(
          response.clone(),
          MAXIMUM_QUOTE_ERROR_BYTES,
          () => new Error('RHEA quote error response is too large')
        )
      )
    } catch {
      return response
    }
    if (!isRecord(payload) || typeof payload.code !== 'number' || payload.code === 0) {
      return response
    }
    if (typeof payload.msg === 'string' && getRheaSwapMinimumAmountMessage(payload.msg)) {
      return response
    }
    const failure = readQuoteFailure(payload)
    if (!failure) return response
    // Only fixed categories cross the error boundary; provider payloads remain private.
    void response.body?.cancel().catch(() => {})
    throw new SwapSdkError(
      failure === 'timeout' ? 'REQUEST_TIMEOUT' : 'ROUTE_NOT_FOUND',
      'quote',
      failure === 'timeout' ? 'quote_timeout' : 'no route'
    )
  }
}
