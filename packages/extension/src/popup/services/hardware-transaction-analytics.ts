import { sendAnalyticsEvent, ANALYTICS_EVENTS, PAGE_IDS } from '@/lib/analytics'
import { projectZcashOperationEvent } from '@/lib/analytics/operations'
import type { HardwareSignRequest } from '@/lib/hardware-tab'

export function recordHardwareOperationOutcome(
  request: HardwareSignRequest,
  requestId: string | null,
  outcome: 'broadcast' | 'failed',
  transactionId?: string
): void {
  if (request.dappRequestId) return
  const event = projectZcashOperationEvent(
    request.kind,
    outcome,
    {
      pageId: PAGE_IDS.HARDWARE_SIGN,
      fundingSource: request.fundingSource,
      outputSymbol: request.monitorParams?.tokenOutSymbol,
      hardware: true
    },
    `zcash-hardware-${outcome}:${transactionId ?? requestId ?? request.createdAt}`
  )
  sendAnalyticsEvent(event.name, event.options)
}

export function recordHardwareSignFailure(
  kind: HardwareSignRequest['kind'],
  phase: 'build' | 'sign' | 'broadcast'
): void {
  sendAnalyticsEvent(ANALYTICS_EVENTS.HW_SIGN_FAILED, {
    pageId: PAGE_IDS.HARDWARE_SIGN,
    chain: 'zcash',
    extra: { kind, phase }
  })
}
