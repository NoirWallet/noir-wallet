/**
 * Google Analytics 4 Measurement Protocol reporter.
 * Runs only in the background service worker.
 */

declare const __APP_VERSION__: string

import { GA_CONFIG } from '@/config/analytics'
import { sanitizeAnalyticsMetadata } from './payload'
import { isGoogleAnalyticsEnabled } from './preferences'

let cachedClientId: string | null = null
let sessionId: string | null = null
const activeRequests = new Set<AbortController>()

/** Random per-install UUID, shared with the custom channel as anonymous id. */
export async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId
  const result = await chrome.storage.local.get('ga_client_id')
  if (result.ga_client_id) {
    cachedClientId = result.ga_client_id
    return result.ga_client_id as string
  }
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ ga_client_id: id })
  cachedClientId = id
  return id
}

async function getSessionId(): Promise<string> {
  if (sessionId) return sessionId
  const result = await chrome.storage.session.get('ga_session_id')
  if (result.ga_session_id) {
    sessionId = result.ga_session_id as string
    return sessionId
  }
  const id = String(Math.floor(Date.now() / 1000))
  await chrome.storage.session.set({ ga_session_id: id })
  sessionId = id
  return id
}

export async function sendGaEvent(name: string, params?: Record<string, unknown>): Promise<void> {
  let abortController: AbortController | null = null
  try {
    if (!GA_CONFIG.apiSecret) return
    if (!(await isGoogleAnalyticsEnabled())) return

    const clientId = await getClientId()
    const sid = await getSessionId()
    if (!(await isGoogleAnalyticsEnabled())) return

    const body = {
      client_id: clientId,
      events: [
        {
          name,
          params: {
            ...sanitizeAnalyticsMetadata(params),
            session_id: sid,
            extension_version: __APP_VERSION__,
            engagement_time_msec: 100
          }
        }
      ]
    }

    abortController = new AbortController()
    activeRequests.add(abortController)
    await fetch(
      `${GA_CONFIG.endpoint}?measurement_id=${GA_CONFIG.measurementId}&api_secret=${GA_CONFIG.apiSecret}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal: abortController.signal
      }
    )
  } catch {
    // Silently ignore analytics errors
  } finally {
    if (abortController) {
      activeRequests.delete(abortController)
    }
  }
}

/** Aborts active Google reports and clears their session after GA is disabled. */
export async function stopGoogleAnalyticsReporting(): Promise<void> {
  for (const request of activeRequests) {
    request.abort()
  }
  activeRequests.clear()
  sessionId = null
  await Promise.allSettled([chrome.storage.session.remove('ga_session_id')])
}
