export const ANALYTICS_SESSION_TIMEOUT_MS = 30 * 60 * 1_000

export interface AnalyticsSessionState {
  id: string
  lastForegroundActivityAt: number
}

interface SessionDecision {
  sessionId?: string
  state: AnalyticsSessionState | null
  shouldPersist: boolean
}

function isValidSession(
  state: AnalyticsSessionState | null,
  now: number
): state is AnalyticsSessionState {
  return Boolean(
    state &&
    /^\d+$/.test(state.id) &&
    Number.isFinite(state.lastForegroundActivityAt) &&
    state.lastForegroundActivityAt > 0 &&
    now >= state.lastForegroundActivityAt &&
    now - state.lastForegroundActivityAt < ANALYTICS_SESSION_TIMEOUT_MS
  )
}

/** Background events may reuse a session, but only foreground activity can create or refresh it. */
export function decideAnalyticsSession(
  state: AnalyticsSessionState | null,
  foreground: boolean,
  now: number
): SessionDecision {
  if (isValidSession(state, now)) {
    if (!foreground) {
      return { sessionId: state.id, state, shouldPersist: false }
    }
    const refreshed = { ...state, lastForegroundActivityAt: now }
    return { sessionId: refreshed.id, state: refreshed, shouldPersist: true }
  }

  if (!foreground) {
    return { state: null, shouldPersist: state !== null }
  }

  const created = {
    id: String(Math.floor(now / 1_000)),
    lastForegroundActivityAt: now
  }
  return { sessionId: created.id, state: created, shouldPersist: true }
}

export function parseAnalyticsSessionState(value: unknown): AnalyticsSessionState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AnalyticsSessionState>
  if (typeof candidate.id !== 'string' || typeof candidate.lastForegroundActivityAt !== 'number') {
    return null
  }
  return {
    id: candidate.id,
    lastForegroundActivityAt: candidate.lastForegroundActivityAt
  }
}
