import { ONE_CLICK_TOKEN_CATALOG_URL } from '@/config/intents'
import {
  FetchResponseTooLargeError,
  fetchArrayBufferWithTimeout,
  getDefaultFetchTransportIdentity
} from '@/lib/fetch-utils'

const MAXIMUM_CATALOG_BYTES = 8 * 1024 * 1024
export const ONE_CLICK_TOKEN_REFRESH_INTERVAL_MS = 60_000

interface RequestOptions {
  readonly fetcher?: typeof fetch
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

interface CatalogResponse {
  readonly value: unknown
  readonly byteLength: number
}

interface CatalogRequest {
  readonly response: Promise<CatalogResponse>
  nextRequestAt: number
}

const requests = new WeakMap<object, CatalogRequest>()

async function requestCatalog(options: RequestOptions): Promise<CatalogResponse> {
  const bytes = await fetchArrayBufferWithTimeout(ONE_CLICK_TOKEN_CATALOG_URL, {
    method: 'GET',
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes ?? MAXIMUM_CATALOG_BYTES,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer'
  })
  return { value: JSON.parse(new TextDecoder().decode(bytes)), byteLength: bytes.byteLength }
}

function readSharedCatalog(): Promise<CatalogResponse> {
  const transport = getDefaultFetchTransportIdentity()
  const now = Date.now()
  const cached = requests.get(transport)
  if (cached && now < cached.nextRequestAt) return cached.response

  const response = requestCatalog({})
  const pending = { response, nextRequestAt: Infinity }
  requests.set(transport, pending)
  const complete = () => {
    pending.nextRequestAt = now + ONE_CLICK_TOKEN_REFRESH_INTERVAL_MS
  }
  void response.then(complete, complete)
  return response
}

export async function fetchOneClickTokenCatalog(options: RequestOptions = {}): Promise<unknown> {
  const response =
    options.fetcher || options.timeoutMs !== undefined
      ? await requestCatalog(options)
      : await readSharedCatalog()
  if (options.maxBytes !== undefined && response.byteLength > options.maxBytes) {
    throw new FetchResponseTooLargeError(options.maxBytes)
  }
  return response.value
}
