const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const MAX_ERROR_BYTES = 16 * 1024

export class FetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`)
    this.name = 'FetchTimeoutError'
  }
}

export class FetchResponseTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response exceeds ${maxBytes} bytes`)
    this.name = 'FetchResponseTooLargeError'
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

interface FetchOptions extends RequestInit {
  timeoutMs?: number
  maxBytes?: number
}

function joinChunks(chunks: Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function readBody(
  response: Response,
  maxBytes: number,
  setReader: (reader: ReadableStreamDefaultReader<Uint8Array> | null) => void,
  truncate = false
): Promise<{ bytes: Uint8Array<ArrayBuffer>; truncated: boolean }> {
  const lengthHeader = response.headers.get('content-length')
  const contentLength = lengthHeader === null ? NaN : Number(lengthHeader)
  if (!truncate && Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel().catch(() => {})
    throw new FetchResponseTooLargeError(maxBytes)
  }
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false }

  const reader = response.body.getReader()
  setReader(reader)
  const chunks: Uint8Array[] = []
  let length = 0
  let finished = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        finished = true
        return { bytes: joinChunks(chunks, length), truncated: false }
      }
      if (length + value.byteLength > maxBytes) {
        if (!truncate) throw new FetchResponseTooLargeError(maxBytes)
        const remainder = maxBytes - length
        if (remainder > 0) chunks.push(value.subarray(0, remainder))
        return { bytes: joinChunks(chunks, maxBytes), truncated: true }
      }
      chunks.push(value)
      length += value.byteLength
    }
  } finally {
    if (!finished) void reader.cancel().catch(() => {})
    reader.releaseLock()
    setReader(null)
  }
}

function readErrorDetail(
  bytes: Uint8Array,
  contentType: string,
  truncated: boolean
): string | undefined {
  const text = new TextDecoder().decode(bytes).trim()
  if (
    !text ||
    contentType.toLowerCase().includes('text/html') ||
    /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)
  ) {
    return undefined
  }
  try {
    const json = JSON.parse(text)
    const field = json?.message ?? json?.error ?? json?.error_description ?? json?.detail
    if (typeof field === 'string' && field.trim()) return field.trim().slice(0, 300)
    if (field && typeof field === 'object' && typeof field.message === 'string') {
      return field.message.trim().slice(0, 300)
    }
  } catch {
    // Plain text errors are useful, but a truncated JSON document is not.
  }
  return truncated && contentType.toLowerCase().includes('json') ? undefined : text.slice(0, 300)
}

async function fetchBytes(
  input: RequestInfo | URL,
  init?: FetchOptions
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    signal: externalSignal,
    ...fetchInit
  } = init || {}
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let rejectAbort: (reason: unknown) => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    if (reader) void reader.cancel().catch(() => {})
    rejectAbort(controller.signal.reason)
  }
  controller.signal.addEventListener('abort', onAbort)
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  if (externalSignal?.aborted) abortFromExternal()
  const timeout = setTimeout(() => controller.abort(new FetchTimeoutError(timeoutMs)), timeoutMs)
  try {
    return await Promise.race([
      (async () => {
        if (controller.signal.aborted) throw controller.signal.reason
        const response = await fetch(input, { ...fetchInit, signal: controller.signal })
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {})
          throw controller.signal.reason
        }
        if (!response.ok) {
          let detail: string | undefined
          try {
            const body = await readBody(
              response,
              MAX_ERROR_BYTES,
              value => {
                reader = value
              },
              true
            )
            detail = readErrorDetail(
              body.bytes,
              response.headers.get('content-type') || '',
              body.truncated
            )
          } catch {
            // Retain the HTTP status when an error body cannot be read.
          }
          throw new FetchHttpError(response.status, response.statusText, detail)
        }
        const body = await readBody(response, maxBytes, value => {
          reader = value
        })
        return { bytes: body.bytes, contentType: response.headers.get('content-type') || '' }
      })(),
      aborted
    ])
  } catch (error) {
    if (externalSignal?.aborted) throw externalSignal.reason
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternal)
    controller.signal.removeEventListener('abort', onAbort)
  }
}

/** Fetches headers and a bounded JSON body within one deadline. */
export async function fetchJsonWithTimeout<T = unknown>(
  input: RequestInfo | URL,
  init?: FetchOptions
): Promise<T> {
  const { bytes } = await fetchBytes(input, init)
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

/** Fetches headers and a bounded binary body within one deadline. */
export async function fetchBlobWithTimeout(
  input: RequestInfo | URL,
  init?: FetchOptions
): Promise<Blob> {
  const { bytes, contentType } = await fetchBytes(input, init)
  return new Blob([bytes], { type: contentType })
}
