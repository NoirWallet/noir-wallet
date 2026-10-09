import { useEffect, useRef } from 'react'
import {
  ANALYTICS_EVENTS,
  registerAnalyticsEngagementProvider,
  sendAnalyticsEvent
} from '@/lib/analytics'
import { ForegroundEngagementTracker } from '@/lib/analytics/engagement'
import { buildOutboundClickMetadata } from '@/lib/analytics/outbound'

const ENGAGEMENT_CHECKPOINT_MS = 60_000
const MIN_STANDALONE_ENGAGEMENT_MS = 1_000

function isDocumentActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function getOutboundEvent(target: EventTarget | null) {
  if (!(target instanceof Element)) return null

  const marked = target.closest<HTMLElement>('[data-analytics-outbound]')
  if (!marked) return null
  if (marked instanceof HTMLButtonElement && marked.disabled) return null

  return buildOutboundClickMetadata(
    marked.dataset.analyticsOutbound,
    marked.dataset.analyticsDomain ||
      (marked instanceof HTMLAnchorElement ? marked.href : undefined)
  )
}

/** Adds Web-like interaction measurement without loading remote analytics code. */
export function useAnalyticsAutoCollection(): void {
  const trackerRef = useRef<ForegroundEngagementTracker | null>(null)
  if (!trackerRef.current) {
    trackerRef.current = new ForegroundEngagementTracker(isDocumentActive(), Date.now())
  }

  useEffect(() => {
    const tracker = trackerRef.current
    if (!tracker) return

    const unregisterProvider = registerAnalyticsEngagementProvider(() => tracker.take(Date.now()))

    const flushStandaloneEngagement = () => {
      if (tracker.pending(Date.now()) < MIN_STANDALONE_ENGAGEMENT_MS) return
      sendAnalyticsEvent(ANALYTICS_EVENTS.EXTENSION_ENGAGEMENT)
    }

    const updateActiveState = () => {
      tracker.setActive(isDocumentActive(), Date.now())
      if (!isDocumentActive()) flushStandaloneEngagement()
    }

    const handlePageHide = () => {
      tracker.setActive(false, Date.now())
      flushStandaloneEngagement()
    }

    const reportOutbound = (event: Event) => {
      const outbound = getOutboundEvent(event.target)
      if (!outbound) return
      sendAnalyticsEvent(ANALYTICS_EVENTS.OUTBOUND_CLICK, {
        params: {
          link_domain: outbound.link_domain,
          link_id: outbound.link_id
        }
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (!(event.target instanceof Element)) return
      const marked = event.target.closest<HTMLElement>('[data-analytics-outbound][role]')
      if (!marked || marked instanceof HTMLAnchorElement || marked instanceof HTMLButtonElement)
        return
      reportOutbound(event)
    }

    const checkpoint = window.setInterval(() => {
      if (isDocumentActive() && tracker.pending(Date.now()) >= ENGAGEMENT_CHECKPOINT_MS) {
        sendAnalyticsEvent(ANALYTICS_EVENTS.EXTENSION_ENGAGEMENT)
      }
    }, ENGAGEMENT_CHECKPOINT_MS)

    window.addEventListener('focus', updateActiveState)
    window.addEventListener('blur', updateActiveState)
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', updateActiveState)
    document.addEventListener('click', reportOutbound, true)
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.clearInterval(checkpoint)
      window.removeEventListener('focus', updateActiveState)
      window.removeEventListener('blur', updateActiveState)
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', updateActiveState)
      document.removeEventListener('click', reportOutbound, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      tracker.setActive(false, Date.now())
      flushStandaloneEngagement()
      unregisterProvider()
    }
  }, [])
}
