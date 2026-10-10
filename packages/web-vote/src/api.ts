import type { VoteRepository } from './vote-store'

const VOTE_PATH = '/api/frost-votes'
const VOTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export async function handleVoteRequest(
  request: Request,
  repository: VoteRepository,
  allowedOrigins: readonly string[]
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
    headers.set('access-control-allow-headers', 'X-Voter-ID, X-Vote-Choice')
  }
  const fail = (status: number, error: string) => Response.json({ error }, { status, headers })

  if (new URL(request.url).pathname !== VOTE_PATH) return fail(404, 'Not found')
  if ((origin !== null && !allowed) || (request.method !== 'GET' && !allowed)) {
    return fail(403, 'Website origin is not allowed')
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'GET' && request.method !== 'POST') {
    headers.set('allow', 'GET, POST, OPTIONS')
    return fail(405, 'Method not allowed')
  }

  const voterId = request.headers.get('x-voter-id')
  if ((voterId !== null && !VOTER_ID.test(voterId)) || (request.method === 'POST' && !voterId)) {
    return fail(400, 'A valid browser identity is required')
  }
  const choice = request.headers.get('x-vote-choice')
  if (request.method === 'POST' && choice !== 'support' && choice !== 'oppose') {
    return fail(400, 'Choose support or oppose')
  }
  try {
    if (await hasBodyBytes(request)) return fail(400, 'Request bodies are not accepted')
    const voterHash = voterId ? await hashVoter(voterId) : undefined
    const snapshot =
      request.method === 'POST' && voterHash && (choice === 'support' || choice === 'oppose')
        ? await repository.cast(voterHash, choice)
        : await repository.read(voterHash)
    return Response.json(snapshot, { headers })
  } catch {
    headers.set('retry-after', '5')
    return fail(503, 'Voting is temporarily unavailable. Please try again.')
  }
}

async function hasBodyBytes(request: Request): Promise<boolean> {
  if (!request.body) return false
  const reader = request.body.getReader()
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
    // Worker HTTP requests may expose an empty stream even without a body.
    // Read only until the first byte, rather than buffering an unbounded payload.
    while (true) {
      if (request.signal.aborted) throw new Error('Request was cancelled')
      const chunk = await reader.read()
      if (timedOut || request.signal.aborted) throw new Error('Request body was not completed')
      if (chunk.done) return false
      if (chunk.value.byteLength > 0) return true
    }
  } finally {
    clearTimeout(timeout)
    request.signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function hashVoter(voterId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`noir:frost-v1:${voterId}`)
  )
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
