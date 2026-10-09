const DEFAULT_TIMEOUT_MS = 15000

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
  }
}

export class FetchHttpError extends Error {
  status: number
  statusText: string
  /** Server-provided error detail parsed from the response body, if any. */
  detail?: string

  constructor(status: number, statusText: string, detail?: string) {
    super(
      detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}: ${statusText || 'Request failed'}`
    )
    this.name = 'FetchHttpError'
    this.status = status
    this.statusText = statusText
    this.detail = detail
  }
}

/**
 * Best-effort extraction of a human-readable message from an error response.
 * Reads the body once (safe: the caller discards the response on error) and
 * prefers common JSON error fields, falling back to trimmed raw text. Without
 * this, callers only see "HTTP 400: Bad Request" instead of the API's reason.
 */
async function readErrorDetail(resp: Response): Promise<string | undefined> {
  try {
    const text = (await resp.text()).trim()
    if (!text) return undefined
    const contentType = resp.headers.get('content-type')?.toLowerCase() || ''
    if (contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
      return undefined
    }
    try {
      const json = JSON.parse(text)
      const field = json?.message ?? json?.error ?? json?.error_description ?? json?.detail
      if (typeof field === 'string' && field.trim()) return field.trim()
      if (field && typeof field === 'object' && typeof field.message === 'string') {
        return field.message
      }
    } catch {
      // Body is not JSON; fall back to raw text below.
    }
    return text.slice(0, 300)
  } catch {
    return undefined
  }
}

/**
 * Fetch wrapper with timeout via AbortController and automatic response.ok check
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init || {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(input, { ...fetchInit, signal: controller.signal })
    if (!resp.ok) {
      const detail = await readErrorDetail(resp)
      throw new FetchHttpError(resp.status, resp.statusText, detail)
    }
    return resp
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : 'unknown'
      throw new FetchTimeoutError(url, timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
