import type { ZeroIndexerOptions } from './zero-indexer'
import { normalizeZeroIndexerUrl } from './zero-indexer-nodes'

export function parseZeroIndexerRuntimeOptions(value: unknown): ZeroIndexerOptions | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid privacy broadcast configuration')
  }
  const options = value as Record<string, unknown>
  if (
    Object.keys(options).some(key => key !== 'urls' && key !== 'sendTimeoutMs') ||
    !Array.isArray(options.urls) ||
    options.urls.length === 0
  ) {
    throw new Error('Invalid privacy broadcast configuration')
  }
  const urls = options.urls.map(url => normalizeZeroIndexerUrl(url))
  const timeout = options.sendTimeoutMs
  const uniqueUrls = [...new Set(urls)]
  if (timeout === undefined) return { urls: uniqueUrls }
  if (
    typeof timeout !== 'number' ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > 0xffffffff
  ) {
    throw new Error('Invalid privacy broadcast timeout')
  }
  return { urls: uniqueUrls, sendTimeoutMs: timeout }
}
