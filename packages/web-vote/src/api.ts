import type { SignupRepository } from './signup-store'

const SIGNUP_PATH = '/api/frost-signups'
const MAX_BODY_BYTES = 1024
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code)
  }
}

export async function handleSignupRequest(
  request: Request,
  repository: SignupRepository,
  allowedOrigins: readonly string[],
  now: () => number = Date.now
): Promise<Response> {
  const origin = request.headers.get('origin')
  const allowed = origin !== null && allowedOrigins.includes(origin)
  const headers = new Headers({
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    vary: 'Origin'
  })
  if (allowed) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
    headers.set('access-control-allow-headers', 'Content-Type')
  }
  const fail = (status: number, error: string) => Response.json({ error }, { status, headers })

  if (new URL(request.url).pathname !== SIGNUP_PATH) return fail(404, 'NOT_FOUND')
  if ((origin !== null && !allowed) || (request.method !== 'GET' && !allowed)) {
    return fail(403, 'ORIGIN_NOT_ALLOWED')
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET' && request.method !== 'POST') {
    headers.set('allow', 'GET, POST, OPTIONS')
    return fail(405, 'METHOD_NOT_ALLOWED')
  }

  try {
    if (request.method === 'GET') {
      await repository.ready()
      return Response.json({ status: 'ok' }, { headers })
    }
    if (
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
    ) {
      return fail(415, 'JSON_REQUIRED')
    }
    const payload = await readJsonBody(request)
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !('email' in payload) ||
      typeof payload.email !== 'string'
    ) {
      return fail(400, 'INVALID_REQUEST')
    }
    const email = payload.email.trim()
    const at = email.indexOf('@')
    const local = email.slice(0, at)
    if (
      email.length > 254 ||
      at < 1 ||
      at > 64 ||
      local.startsWith('.') ||
      local.endsWith('.') ||
      local.includes('..') ||
      !EMAIL_PATTERN.test(email)
    ) {
      return fail(400, 'INVALID_EMAIL')
    }
    // Preserve the local part; domain names are case-insensitive.
    const normalized = email.slice(0, at) + '@' + email.slice(at + 1).toLowerCase()
    await repository.register(normalized, now())
    return Response.json({ ok: true }, { headers })
  } catch (error) {
    if (error instanceof RequestError) return fail(error.status, error.code)
    headers.set('retry-after', '5')
    return fail(503, 'SIGNUP_UNAVAILABLE')
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.body) throw new RequestError(400, 'INVALID_REQUEST')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timedOut = false
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  const timeout = setTimeout(() => {
    timedOut = true
    cancel()
  }, 2_000)
  request.signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      if (request.signal.aborted) throw new RequestError(408, 'REQUEST_TIMEOUT')
      const chunk = await reader.read().catch((error: unknown) => {
        if (timedOut || request.signal.aborted) throw new RequestError(408, 'REQUEST_TIMEOUT')
        throw error
      })
      if (timedOut || request.signal.aborted) throw new RequestError(408, 'REQUEST_TIMEOUT')
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) throw new RequestError(413, 'REQUEST_TOO_LARGE')
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
    } catch {
      throw new RequestError(400, 'INVALID_REQUEST')
    }
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
