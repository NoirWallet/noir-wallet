export type VoteChoice = 'support' | 'oppose'

export interface VoteSnapshot {
  total: number
  support: number
  oppose: number
  choice: VoteChoice | null
}

const STORAGE_KEY = 'noir_frost_voter_id'
const VOTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function getVoterId(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  createId: () => string = () => crypto.randomUUID()
): string {
  const existing = storage.getItem(STORAGE_KEY)
  if (existing && VOTER_ID.test(existing)) return existing
  const id = createId()
  if (!VOTER_ID.test(id)) throw new Error('Could not create a browser identity.')
  storage.setItem(STORAGE_KEY, id)
  if (storage.getItem(STORAGE_KEY) !== id) throw new Error('Browser storage is unavailable.')
  return id
}

export function parseVoteSnapshot(value: unknown): VoteSnapshot {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('total' in value) ||
    typeof value.total !== 'number' ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    !('support' in value) ||
    !isVoteCount(value.support) ||
    !('oppose' in value) ||
    !isVoteCount(value.oppose) ||
    value.support + value.oppose !== value.total ||
    !('choice' in value) ||
    (value.choice !== null && value.choice !== 'support' && value.choice !== 'oppose') ||
    (value.choice === 'support' && value.support === 0) ||
    (value.choice === 'oppose' && value.oppose === 0)
  ) {
    throw new Error('The voting service returned an invalid result. Please try again.')
  }
  return { total: value.total, support: value.support, oppose: value.oppose, choice: value.choice }
}

function isVoteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export async function fetchVoteSnapshot(
  method: 'GET' | 'POST',
  voterId: string | null,
  choice: VoteChoice | null,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<VoteSnapshot> {
  if (method === 'POST' && (!choice || !voterId)) {
    throw new Error('Choose a voting option before submitting.')
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(abort, 10_000)
  try {
    const response = await fetcher('/api/frost-votes', {
      method,
      headers: {
        ...(voterId ? { 'X-Voter-ID': voterId } : {}),
        ...(method === 'POST' && choice ? { 'X-Vote-Choice': choice } : {})
      },
      cache: 'no-store',
      signal: controller.signal
    })
    if (!response.ok) throw new Error('Voting is temporarily unavailable. Please try again.')
    const snapshot = parseVoteSnapshot(await response.json())
    if (method === 'POST' && !snapshot.choice) {
      throw new Error('Your vote was not confirmed. Please try again.')
    }
    return snapshot
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
