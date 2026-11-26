import { FetchTimeoutError, fetchWithTimeout, jsonRequestInit } from '@/lib/fetch-utils'

interface RpcEndpoint {
  readonly url: string
}

interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: string
  readonly params: readonly unknown[] | Readonly<Record<string, unknown>>
}

interface JsonRpcRequestOptions {
  readonly timeoutMs: number
  readonly maxBytes: number
  readonly signal?: AbortSignal
}

type JsonRpcHttpResponse =
  | { readonly ok: false; readonly status: number }
  | { readonly ok: true; readonly validJson: false }
  | { readonly ok: true; readonly validJson: true; readonly body: unknown }

export type JsonRpcTransport = (
  url: string,
  request: JsonRpcRequest,
  options: JsonRpcRequestOptions,
  fetcher?: typeof fetch
) => Promise<JsonRpcHttpResponse>

export async function fetchJsonRpcResponse(
  url: string,
  request: JsonRpcRequest,
  options: JsonRpcRequestOptions,
  fetcher?: typeof fetch
): Promise<JsonRpcHttpResponse> {
  const response = await fetchWithTimeout(url, {
    ...jsonRequestInit(
      {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
      },
      request
    ),
    ...options,
    fetcher,
    acceptHttpErrors: 'status-only'
  })
  if (!response.ok) return { ok: false, status: response.status }
  try {
    const body: unknown = await response.json()
    return { ok: true, validJson: true, body }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { ok: true, validJson: false }
  }
}

function isRetryableJsonRpcResponse(response: JsonRpcHttpResponse, requestId: number): boolean {
  if (!response.ok) {
    return (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      response.status >= 500
    )
  }
  if (!response.validJson) return true
  const decoded = response.body
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return true
  const envelope = decoded as Record<string, unknown>
  if (envelope.jsonrpc !== '2.0' || envelope.id !== requestId) return true
  const error = envelope.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const code = (error as Record<string, unknown>).code
    return code === 429 || code === -32_005
  }
  return !Object.prototype.hasOwnProperty.call(envelope, 'result')
}

export function createJsonRpcFailoverFetch(
  endpoints: readonly RpcEndpoint[],
  attest: (url: string, signal?: AbortSignal) => Promise<void>,
  fetchImplementation?: typeof fetch
): JsonRpcTransport {
  if (endpoints.length === 0) throw new Error('No RPC endpoints configured')
  const verified = new Set<string>()
  let activeIndex = 0

  return async (_input, request, options, fetcher = fetchImplementation) => {
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const { method, id } = request
    const mayRetry =
      method !== 'sendTransaction' &&
      method !== 'broadcast_tx_async' &&
      method !== 'broadcast_tx_commit'
    let lastError: unknown
    const startIndex = activeIndex
    try {
      for (let offset = 0; offset < endpoints.length; offset += 1) {
        signal.throwIfAborted()
        const index = (startIndex + offset) % endpoints.length
        const url = endpoints[index].url
        try {
          if (!verified.has(url)) {
            await attest(url, signal)
            signal.throwIfAborted()
            verified.add(url)
          }
        } catch (error) {
          verified.delete(url)
          signal.throwIfAborted()
          lastError = error
          continue
        }
        try {
          const response = await fetchJsonRpcResponse(url, request, { ...options, signal }, fetcher)
          signal.throwIfAborted()
          if (mayRetry && isRetryableJsonRpcResponse(response, id)) {
            lastError = new Error('RPC endpoint returned an invalid or unavailable response')
            verified.delete(url)
            continue
          }
          activeIndex = index
          return response
        } catch (error) {
          signal.throwIfAborted()
          verified.delete(url)
          if (!mayRetry) throw error
          lastError = error
        }
      }
      throw lastError ?? new Error('All RPC endpoints are unavailable')
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason
      if (timeout.aborted) throw new FetchTimeoutError(options.timeoutMs)
      throw error
    }
  }
}
