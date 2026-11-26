import {
  FetchResponseTooLargeError,
  FetchTimeoutError,
  fetchWithTimeout,
  jsonRequestInit
} from '@/lib/fetch-utils'
import { createRheaSwapFetch } from './rhea-swap-fetch'
import {
  getRheaSwapMinimumAmountMessage,
  RheaSwapHttpError,
  type RheaSwapErrorStage
} from './rhea-swap-error'

const DEFAULT_TIMEOUT_MS = 15_000
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024
const MAXIMUM_TOKEN_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024
const DEFAULT_RETRIES = 2

interface RheaSwapApiConfig {
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  fetch?: typeof fetch
  retry?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean }
}

interface RequestOptions {
  signal?: AbortSignal
  query?: Record<string, string | number | undefined>
  body?: unknown
  retryable?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeProviderMessage(value: unknown): string | null {
  if (!isRecord(value)) return null
  const message = typeof value.msg === 'string' ? value.msg : ''
  return getRheaSwapMinimumAmountMessage(message)
}

export class RheaSwapApi {
  private readonly baseUrl: string
  private readonly fetch: typeof fetch

  constructor(private readonly config: RheaSwapApiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
    this.fetch = createRheaSwapFetch(config.fetch ?? globalThis.fetch)
  }

  quote(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request('/crosschain/swap/quote', 'quote', 'POST', {
      body,
      signal,
      retryable: true
    })
  }

  build(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request('/crosschain/swap/swap', 'build', 'POST', { body, signal })
  }

  submitOrder(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request('/api/swap/order-submit', 'submit', 'POST', { body, signal })
  }

  report(body: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.request('/crosschain/swap/report', 'report', 'POST', { body, signal })
  }

  orderStatus(
    query: Record<string, string | number | undefined>,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.request('/api/swap/order-status', 'status', 'GET', {
      query,
      signal,
      retryable: true
    })
  }

  fromTokens(chainId: number, signal?: AbortSignal): Promise<unknown> {
    return this.request('/get_chain_prices', 'tokens', 'GET', {
      query: { chain: chainId },
      signal,
      retryable: true
    })
  }

  crossChainToTokens(chainId: number, signal?: AbortSignal): Promise<unknown> {
    return this.request('/api/swap/supported_to_tokens', 'tokens', 'GET', {
      query: { chain: chainId },
      signal,
      retryable: true
    })
  }

  private async request(
    path: string,
    stage: RheaSwapErrorStage,
    method: 'GET' | 'POST',
    options: RequestOptions
  ): Promise<unknown> {
    if (
      path.startsWith('/crosschain/swap/') &&
      isRecord(options.body) &&
      'confidentiality' in options.body
    ) {
      throw new RheaSwapHttpError('INVALID_REQUEST', stage, 'Confidential requests require 1Click')
    }
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const maxRetries = this.config.retry?.maxRetries ?? DEFAULT_RETRIES
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
      throw new RheaSwapHttpError('INVALID_REQUEST', stage, 'Invalid retry configuration')
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce(url, stage, method, options)
      } catch (error) {
        const failure =
          error instanceof RheaSwapHttpError
            ? error
            : new RheaSwapHttpError('HTTP_ERROR', stage, 'Network request failed', true)
        if (
          !options.retryable ||
          !failure.retryable ||
          attempt >= maxRetries ||
          options.signal?.aborted
        ) {
          throw failure
        }
        const baseDelay = this.config.retry?.baseDelayMs ?? 250
        const maxDelay = this.config.retry?.maxDelayMs ?? 2_000
        const jitter = this.config.retry?.jitter ?? true
        const exponential = Math.min(maxDelay, baseDelay * 2 ** attempt)
        const delay = jitter ? Math.min(maxDelay, exponential * (0.5 + Math.random())) : exponential
        await this.waitForRetry(delay, options.signal, stage)
      }
    }
  }

  private async requestOnce(
    url: URL,
    stage: RheaSwapErrorStage,
    method: 'GET' | 'POST',
    options: RequestOptions
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw new RheaSwapHttpError('REQUEST_ABORTED', stage, 'Request aborted')
    }
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    try {
      const response = await fetchWithTimeout(url.toString(), {
        ...jsonRequestInit({ method, signal: options.signal }, options.body, {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {})
        }),
        fetcher: this.fetch,
        timeoutMs,
        maxBytes:
          stage === 'tokens' ? MAXIMUM_TOKEN_CATALOG_RESPONSE_BYTES : MAXIMUM_RESPONSE_BYTES,
        acceptHttpErrors: true
      })
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        if (response.ok) {
          throw new RheaSwapHttpError(
            'INVALID_API_RESPONSE',
            stage,
            'RHEA Swap returned invalid JSON'
          )
        }
      }
      const minimum = safeProviderMessage(payload)
      if (!response.ok) {
        const status = response.status
        const code =
          status === 401 || status === 403
            ? 'AUTH_FAILED'
            : status === 429
              ? 'RATE_LIMITED'
              : 'HTTP_ERROR'
        throw new RheaSwapHttpError(
          code,
          stage,
          minimum ??
            (code === 'AUTH_FAILED'
              ? 'RHEA Swap authorization failed'
              : code === 'RATE_LIMITED'
                ? 'RHEA Swap rate limited'
                : `RHEA Swap HTTP ${status}`),
          status === 429 || status >= 500
        )
      }
      if (
        !isRecord(payload) ||
        typeof payload.code !== 'number' ||
        (payload.msg !== undefined && typeof payload.msg !== 'string')
      ) {
        throw new RheaSwapHttpError(
          'INVALID_API_RESPONSE',
          stage,
          'RHEA Swap returned an invalid response'
        )
      }
      if (payload.code !== 0) {
        throw new RheaSwapHttpError('API_ERROR', stage, minimum ?? 'RHEA Swap request failed')
      }
      if (!('data' in payload)) {
        throw new RheaSwapHttpError(
          'INVALID_API_RESPONSE',
          stage,
          'RHEA Swap returned an invalid response'
        )
      }
      return payload.data
    } catch (error) {
      if (error instanceof RheaSwapHttpError) throw error
      if (options.signal?.aborted) {
        throw new RheaSwapHttpError('REQUEST_ABORTED', stage, 'Request aborted')
      }
      if (error instanceof FetchTimeoutError) {
        throw new RheaSwapHttpError('REQUEST_TIMEOUT', stage, error.message, true)
      }
      if (error instanceof FetchResponseTooLargeError) {
        throw new RheaSwapHttpError(
          'INVALID_API_RESPONSE',
          stage,
          'RHEA Swap response is too large'
        )
      }
      throw new RheaSwapHttpError('HTTP_ERROR', stage, 'Network request failed', true)
    }
  }

  private waitForRetry(
    delay: number,
    signal: AbortSignal | undefined,
    stage: RheaSwapErrorStage
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new RheaSwapHttpError('REQUEST_ABORTED', stage, 'Request aborted'))
        return
      }
      const onAbort = () => {
        clearTimeout(timer)
        reject(new RheaSwapHttpError('REQUEST_ABORTED', stage, 'Request aborted'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, delay)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
