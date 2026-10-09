/**
 * Unified analytics API — dual-channel reporting:
 * 1. Google Analytics 4 (Measurement Protocol) — event name + params
 * 2. Custom collector (encrypted transport) — privacy-filtered event context
 *
 * UI contexts (popup, approval window, tabs) call `sendAnalytics*`, which
 * forwards through chrome.runtime messaging; the background service worker
 * performs the actual network reporting via `track*`.
 */

import { ANALYTICS_EVENTS, PAGE_IDS, resolvePageId } from './constants'
import { buildPayload } from './payload'
import { enqueueAnalyticsEvent } from './client'
import { getClientId, sendGaEvent, stopGoogleAnalyticsReporting } from './ga'
import { isGoogleAnalyticsEnabled, onGoogleAnalyticsPreferenceChange } from './preferences'
import { sanitizeAnalyticsEvent } from './policy'
import type { AnalyticsEventPayload, AnalyticsMessage, TrackOptions } from './types'

export { ANALYTICS_EVENTS, PAGE_IDS, resolvePageId }
export type { AnalyticsMessage, TrackOptions }

/** Last page seen by this UI context; default for events without a pageId. */
let currentPageId: string | null = null

onGoogleAnalyticsPreferenceChange(enabled => {
  if (!enabled) {
    void stopGoogleAnalyticsReporting()
  }
})

void isGoogleAnalyticsEnabled().then(enabled => {
  if (!enabled) {
    void stopGoogleAnalyticsReporting()
  }
})

// ============================================================
// Background context: performs the actual reporting
// ============================================================

async function finalizeAndEnqueue(payload: AnalyticsEventPayload): Promise<void> {
  payload.wallet_address = `anon_${await getClientId()}`
  enqueueAnalyticsEvent(payload)
}

/** Reports an event to both channels. Background service worker only. */
export function trackEvent(name: string, options: TrackOptions = {}, timestamp?: number): void {
  try {
    const event = sanitizeAnalyticsEvent(name, options)
    if (!event) return
    void sendGaEvent(event.name, event.options.params)
    const payload = buildPayload(event.name, event.options, timestamp)
    void finalizeAndEnqueue(payload).catch(() => {})
  } catch {
    // Analytics must never break wallet flows
  }
}

/** Reports a page view: GA `page_view` + custom `show_page`. */
export function trackPageView(page: string, timestamp?: number): void {
  try {
    const pageId = resolvePageId(page)
    void sendGaEvent('page_view', {
      page_location: `https://noir-wallet.extension${page}`,
      page_title: page
    })
    void finalizeAndEnqueue(buildPayload(ANALYTICS_EVENTS.SHOW_PAGE, { pageId }, timestamp)).catch(
      () => {}
    )
  } catch {
    // Analytics must never break wallet flows
  }
}

/** Routes ANALYTICS_* runtime messages to the reporters. Background only. */
export function handleAnalyticsMessage(message: AnalyticsMessage): void {
  if (message.type === 'ANALYTICS_EVENT') {
    trackEvent(message.name, message.options ?? {}, message.timestamp)
  } else if (message.type === 'ANALYTICS_PAGE_VIEW') {
    trackPageView(message.page, message.timestamp)
  }
}

// ============================================================
// UI contexts: forward to background via runtime messaging
// ============================================================

/** Tracks an event from popup/approval/tab contexts. */
export function sendAnalyticsEvent(name: string, options: TrackOptions = {}): void {
  const event = sanitizeAnalyticsEvent(name, {
    ...options,
    pageId: options.pageId ?? currentPageId ?? PAGE_IDS.HOME
  })
  if (!event) return
  const message: AnalyticsMessage = {
    type: 'ANALYTICS_EVENT',
    name: event.name,
    options: event.options,
    timestamp: Date.now()
  }
  chrome.runtime.sendMessage(message).catch(() => {})
}

/** Tracks a page view from popup/approval/tab contexts. */
export function sendAnalyticsPageView(page: string): void {
  currentPageId = resolvePageId(page)
  const message: AnalyticsMessage = {
    type: 'ANALYTICS_PAGE_VIEW',
    page,
    timestamp: Date.now()
  }
  chrome.runtime.sendMessage(message).catch(() => {})
}
