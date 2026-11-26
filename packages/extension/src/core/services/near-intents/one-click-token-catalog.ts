import { ONE_CLICK_TOKEN_CATALOG_URL } from '@/config/intents'
import { DedupPromise } from '@/lib/async-utils'
import { FetchResponseTooLargeError, fetchWithTimeout } from '@/lib/fetch-utils'

const MAXIMUM_CATALOG_BYTES = 8 * 1024 * 1024

interface RequestOptions {
  readonly fetcher?: typeof fetch
  readonly timeoutMs?: number
  readonly maxBytes?: number
}

interface CatalogResponse {
  readonly value: unknown
  readonly byteLength: number
}

const catalogRequest = new DedupPromise<CatalogResponse>()

async function requestCatalog(options: RequestOptions): Promise<CatalogResponse> {
  const response = await fetchWithTimeout(ONE_CLICK_TOKEN_CATALOG_URL, {
    method: 'GET',
    fetcher: options.fetcher,
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes ?? MAXIMUM_CATALOG_BYTES,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer'
  })
  const bytes = await response.arrayBuffer()
  return { value: JSON.parse(new TextDecoder().decode(bytes)), byteLength: bytes.byteLength }
}

export async function fetchOneClickTokenCatalog(options: RequestOptions = {}): Promise<unknown> {
  const response =
    options.fetcher || options.timeoutMs !== undefined
      ? await requestCatalog(options)
      : await catalogRequest.run(() => requestCatalog({}))
  if (options.maxBytes !== undefined && response.byteLength > options.maxBytes) {
    throw new FetchResponseTooLargeError(options.maxBytes)
  }
  return response.value
}
