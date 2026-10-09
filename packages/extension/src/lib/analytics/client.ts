/**
 * Batching client for the custom analytics collector.
 * Runs only in the background service worker: events are queued in memory,
 * flushed as encrypted batches, and dropped after repeated upload failures
 * (analytics must never impact wallet functionality).
 */

// Relative .ts imports (not `@/`) so Node-based tests can load this module directly
import { CUSTOM_ANALYTICS_CONFIG } from '../../config/analytics.ts'
import { encryptAnalyticsPayload } from './crypto.ts'
import type { AnalyticsEventPayload } from './types.ts'

const FLUSH_DELAY_MS = 2_000
const RETRY_DELAY_MS = 15_000
const MAX_BATCH_SIZE = 20
const MAX_QUEUE_SIZE = 200
const MAX_CONSECUTIVE_FAILURES = 3

const queue: AnalyticsEventPayload[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let isFlushing = false
let consecutiveFailures = 0
let activeAbortController: AbortController | null = null

function scheduleFlush(delayMs: number) {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, delayMs)
}

async function flush(): Promise<void> {
  if (isFlushing || queue.length === 0) return

  isFlushing = true

  const batch = queue.splice(0, MAX_BATCH_SIZE)
  const abortController = new AbortController()
  activeAbortController = abortController
  try {
    const encryptedData = await encryptAnalyticsPayload(
      JSON.stringify(batch),
      CUSTOM_ANALYTICS_CONFIG.cryptoPassword
    )
    if (abortController.signal.aborted) {
      return
    }

    const response = await fetch(CUSTOM_ANALYTICS_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: encryptedData }),
      signal: abortController.signal
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    // The collector returns HTTP 200 with a business code; non-zero means the
    // payload was rejected (validation) — retrying the same batch is pointless
    const body = await response.json().catch(() => null)
    if (body && body.code !== 0) {
      console.warn('[Analytics] Batch rejected by collector:', body.code, body.message)
    }
    consecutiveFailures = 0
  } catch (error) {
    if (abortController.signal.aborted) {
      return
    }
    consecutiveFailures++
    if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
      queue.unshift(...batch)
    } else {
      console.warn('[Analytics] Dropping batch after repeated failures:', error)
    }
  } finally {
    if (activeAbortController === abortController) {
      activeAbortController = null
    }
    isFlushing = false
  }

  if (queue.length > 0) {
    scheduleFlush(consecutiveFailures > 0 ? RETRY_DELAY_MS : FLUSH_DELAY_MS)
  }
}

/** Queues an event for batched upload. No-op when the password is unset. */
export function enqueueAnalyticsEvent(payload: AnalyticsEventPayload): void {
  if (!CUSTOM_ANALYTICS_CONFIG.cryptoPassword) return

  queue.push(payload)
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE)
  }

  if (queue.length >= MAX_BATCH_SIZE) {
    void flush()
  } else {
    scheduleFlush(FLUSH_DELAY_MS)
  }
}

/** Drops pending events and aborts an active upload. */
export function clearAnalyticsQueue(): void {
  queue.splice(0, queue.length)
  consecutiveFailures = 0
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  activeAbortController?.abort()
  activeAbortController = null
}
