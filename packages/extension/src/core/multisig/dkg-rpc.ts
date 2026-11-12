/**
 * The `vault.dkg.*` Worker RPC: one coordinator session per DKG session id, addressed by base64
 * id, with bytes crossing as base64 and roster-slot maps as plain objects. Requests are validated
 * here because they arrive from another extension context as JSON; the coordinator underneath only
 * ever sees well-typed values.
 */
import { base64ToBytes, bytesToBase64 } from '@/lib/bytes'
import { DkgCoordinatorSession } from './dkg-coordinator'
import { isBase64Text, isDkgShape, type VaultWasm } from './dkg-protocol'

export type VaultDkgAcceptRequest = { sessionId: string; senderSlot: number; envelope: string }

export type VaultDkgRound1Response =
  | { complete: false }
  | { complete: true; round1Hash: string; bundles: Record<string, string> }

export type VaultDkgRound2Response =
  | { complete: false }
  | {
      complete: true
      fingerprint: string
      inboxes: Record<string, string>
      sealedQsk: Record<string, string>
    }

export interface VaultDkgSchema {
  'vault.dkg.open': {
    request: { participants: 2 | 3; threshold: 2 | 3; mainnet: boolean }
    response: { sessionId: string }
  }
  'vault.dkg.acceptRound1': { request: VaultDkgAcceptRequest; response: VaultDkgRound1Response }
  'vault.dkg.acceptRound2': { request: VaultDkgAcceptRequest; response: VaultDkgRound2Response }
  'vault.dkg.close': { request: { sessionId: string }; response: true }
}

export type VaultDkgMethod = keyof VaultDkgSchema

const METHODS: readonly VaultDkgMethod[] = [
  'vault.dkg.open',
  'vault.dkg.acceptRound1',
  'vault.dkg.acceptRound2',
  'vault.dkg.close'
]

export function isVaultDkgMethod(method: string): method is VaultDkgMethod {
  return (METHODS as readonly string[]).includes(method)
}

export interface VaultDkgRpcHandler {
  handle<M extends VaultDkgMethod>(
    method: M,
    payload: unknown
  ): Promise<VaultDkgSchema[M]['response']>
  readonly sessionCount: number
}

export interface VaultDkgRpcOptions {
  now?: () => number
  maxSessions?: number
  idleMs?: number
  /** Arms a one-shot timer and returns its cancel; defaults to setTimeout. Tests inject their own. */
  schedule?: (fn: () => void, delayMs: number) => () => void
}

function scheduleWithTimeout(fn: () => void, delayMs: number): () => void {
  const id = setTimeout(fn, delayMs)
  // Under Node (tests) a pending timer would keep the process alive for idleMs; a Worker has no
  // unref and needs none.
  ;(id as { unref?: () => void }).unref?.()
  return () => clearTimeout(id)
}

const INVALID_REQUEST = 'Invalid vault DKG request'
const UNKNOWN_SESSION = 'Unknown vault DKG session'
const DEFAULT_MAX_SESSIONS = 4
const DEFAULT_IDLE_MS = 10 * 60_000

interface Entry {
  session: DkgCoordinatorSession
  lastUsed: number
  disarm: () => void
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return (
    actual.length === keys.length &&
    keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
  )
}

function parseOpen(payload: unknown): VaultDkgSchema['vault.dkg.open']['request'] {
  if (!hasExactKeys(payload, ['participants', 'threshold', 'mainnet'])) {
    throw new Error(INVALID_REQUEST)
  }
  const shape = { participants: payload.participants, threshold: payload.threshold }
  if (!isDkgShape(shape) || typeof payload.mainnet !== 'boolean') throw new Error(INVALID_REQUEST)
  return { participants: shape.participants, threshold: shape.threshold, mainnet: payload.mainnet }
}

function parseAccept(payload: unknown): VaultDkgAcceptRequest {
  if (
    !hasExactKeys(payload, ['sessionId', 'senderSlot', 'envelope']) ||
    !isBase64Text(payload.sessionId) ||
    typeof payload.senderSlot !== 'number' ||
    !Number.isInteger(payload.senderSlot) ||
    !isBase64Text(payload.envelope)
  ) {
    throw new Error(INVALID_REQUEST)
  }
  return {
    sessionId: payload.sessionId,
    senderSlot: payload.senderSlot,
    envelope: payload.envelope
  }
}

function parseClose(payload: unknown): { sessionId: string } {
  if (!hasExactKeys(payload, ['sessionId']) || !isBase64Text(payload.sessionId)) {
    throw new Error(INVALID_REQUEST)
  }
  return { sessionId: payload.sessionId }
}

function encodeBySlot(map: ReadonlyMap<number, Uint8Array>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [slot, bytes] of map) out[String(slot)] = bytesToBase64(bytes)
  return out
}

export function createVaultDkgRpcHandler(
  wasm: VaultWasm,
  options: VaultDkgRpcOptions = {}
): VaultDkgRpcHandler {
  const now = options.now ?? (() => Date.now())
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const schedule = options.schedule ?? scheduleWithTimeout
  const sessions = new Map<string, Entry>()

  function drop(id: string): void {
    const entry = sessions.get(id)
    if (!entry) return
    sessions.delete(id)
    entry.disarm()
    entry.session.close()
  }

  // A tab that is closed mid-ceremony never sends vault.dkg.close, and no later call may come at
  // all, so each session carries its own timer. Every use re-arms it; when it fires, the session
  // has been idle for idleMs by construction, and nothing else is needed to decide.
  function arm(id: string, entry: Entry, at: number): void {
    entry.lastUsed = at
    entry.disarm()
    entry.disarm = schedule(() => {
      entry.disarm = () => {}
      if (sessions.get(id) === entry) drop(id)
    }, idleMs)
  }

  // Fallback sweep on every call, for a timer source that was paused or dropped.
  function expireIdle(at: number): void {
    for (const [id, entry] of sessions) {
      if (at - entry.lastUsed >= idleMs) drop(id)
    }
  }

  function evictOldest(): void {
    let oldest: [string, Entry] | null = null
    for (const candidate of sessions) {
      if (!oldest || candidate[1].lastUsed < oldest[1].lastUsed) oldest = candidate
    }
    if (oldest) drop(oldest[0])
  }

  function take(id: string, at: number): Entry {
    const entry = sessions.get(id)
    if (!entry) throw new Error(UNKNOWN_SESSION)
    arm(id, entry, at)
    return entry
  }

  async function accept<T>(
    payload: unknown,
    at: number,
    run: (session: DkgCoordinatorSession, senderSlot: number, envelope: Uint8Array) => Promise<T>
  ): Promise<T> {
    const request = parseAccept(payload)
    const entry = take(request.sessionId, at)
    try {
      return await run(entry.session, request.senderSlot, base64ToBytes(request.envelope))
    } catch (error) {
      // The coordinator has already voided itself; the table must not keep a dead session.
      drop(request.sessionId)
      throw error
    }
  }

  async function dispatch(method: VaultDkgMethod, payload: unknown): Promise<unknown> {
    const at = now()
    expireIdle(at)
    switch (method) {
      case 'vault.dkg.open': {
        const request = parseOpen(payload)
        if (sessions.size >= maxSessions) evictOldest()
        const session = DkgCoordinatorSession.open(wasm, request)
        const id = bytesToBase64(session.sessionId)
        const entry: Entry = { session, lastUsed: at, disarm: () => {} }
        sessions.set(id, entry)
        arm(id, entry, at)
        return { sessionId: id }
      }
      case 'vault.dkg.acceptRound1':
        return accept(payload, at, async (session, senderSlot, envelope) => {
          const outcome = await session.acceptRound1(senderSlot, envelope)
          return outcome.complete
            ? {
                complete: true,
                round1Hash: outcome.round1Hash,
                bundles: encodeBySlot(outcome.bundles)
              }
            : { complete: false }
        })
      case 'vault.dkg.acceptRound2':
        return accept(payload, at, async (session, senderSlot, envelope) => {
          const outcome = await session.acceptRound2(senderSlot, envelope)
          return outcome.complete
            ? {
                complete: true,
                fingerprint: outcome.fingerprint,
                inboxes: encodeBySlot(outcome.inboxes),
                sealedQsk: encodeBySlot(outcome.sealedQsk)
              }
            : { complete: false }
        })
      case 'vault.dkg.close': {
        drop(parseClose(payload).sessionId)
        return true
      }
      default:
        throw new Error(INVALID_REQUEST)
    }
  }

  return {
    handle<M extends VaultDkgMethod>(method: M, payload: unknown) {
      return dispatch(method, payload) as Promise<VaultDkgSchema[M]['response']>
    },
    get sessionCount() {
      return sessions.size
    }
  }
}
