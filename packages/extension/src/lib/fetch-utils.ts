import { DEFAULT_REQUEST_TIMEOUT_MS } from '@/config/extension'

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

export async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
  responseTooLarge: () => Error
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      throw responseTooLarge()
    }
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > maximumBytes) {
        await reader.cancel()
        throw responseTooLarge()
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  } finally {
    reader.releaseLock()
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
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal: callerSignal, ...fetchInit } = init || {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal

  try {
    const resp = await fetch(input, { ...fetchInit, signal })
    if (!resp.ok) {
      const detail = await readErrorDetail(resp)
      throw new FetchHttpError(resp.status, resp.statusText, detail)
    }
    return resp
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason
    if (error instanceof DOMException && error.name === 'AbortError' && controller.signal.aborted) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : 'unknown'
      throw new FetchTimeoutError(url, timeoutMs)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
