import type { RpcEndpointChain, RpcEndpointOption } from './rpc-endpoints'
import { isZeroIndexerEndpoint } from './zero-indexer'

export type CustomRpcEndpoints = Record<RpcEndpointChain, RpcEndpointOption[]>

export const EMPTY_CUSTOM_RPC_ENDPOINTS: CustomRpcEndpoints = { zcash: [] }

const CUSTOM_RPC_ID_PREFIX = 'custom:'
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/

export function isCustomRpcEndpointId(id: string): boolean {
  return id.startsWith(CUSTOM_RPC_ID_PREFIX)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function normalizeCustomRpcUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length > 2_048) {
    throw new Error('Invalid custom RPC URL')
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Invalid custom RPC URL')
  }

  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Custom RPC must use HTTPS without credentials, query parameters, or fragments')
  }

  return url.toString().replace(/\/+$/, '')
}

export function normalizeCustomRpcLabel(value: unknown, url: string): string {
  if (value === undefined || value === null) {
    return new URL(url).host
  }
  if (typeof value !== 'string') throw new Error('Invalid custom RPC name')
  const normalized = value.normalize('NFC').trim()
  if (!normalized) return new URL(url).host
  if ([...normalized].length > 64 || CONTROL_CHARACTERS.test(normalized)) {
    throw new Error('Custom RPC name must be between 1 and 64 characters')
  }
  return normalized
}

export function createCustomRpcEndpoint(
  label: unknown,
  url: unknown,
  id = `${CUSTOM_RPC_ID_PREFIX}${crypto.randomUUID()}`
): RpcEndpointOption {
  const normalizedUrl = normalizeCustomRpcUrl(url)
  if (isZeroIndexerEndpoint({ id, url: normalizedUrl })) {
    throw new Error('This address is reserved for the privacy broadcast service')
  }
  if (!isCustomRpcEndpointId(id) || id.length > 128 || CONTROL_CHARACTERS.test(id)) {
    throw new Error('Invalid custom RPC ID')
  }
  return {
    id,
    label: normalizeCustomRpcLabel(label, normalizedUrl),
    url: normalizedUrl
  }
}

export function parseCustomRpcEndpoints(value: unknown): CustomRpcEndpoints {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { zcash: [] }
  }

  const raw = (value as Partial<Record<RpcEndpointChain, unknown>>).zcash
  if (!Array.isArray(raw)) return { zcash: [] }

  const ids = new Set<string>()
  const urls = new Set<string>()
  const endpoints: RpcEndpointOption[] = []
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const endpoint = candidate as Partial<RpcEndpointOption>
    try {
      const parsed = createCustomRpcEndpoint(endpoint.label, endpoint.url, endpoint.id)
      if (ids.has(parsed.id) || urls.has(parsed.url)) continue
      ids.add(parsed.id)
      urls.add(parsed.url)
      endpoints.push(parsed)
    } catch {
      // Ignore malformed persisted entries without discarding the valid endpoints.
    }
  }
  return { zcash: endpoints }
}
