import { ANALYTICS_EVENTS, PAGE_IDS, type AnalyticsEventName } from './constants'
import type { TrackOptions } from './types'

export type ZcashAnalyticsOperation = 'send' | 'unshield' | 'shield' | 'swap'
export type AnalyticsSwapDirection = 'zec_to_other' | 'other_to_zec' | 'same_chain' | 'cross_chain'

/** Operation context only; the execution owner determines the event and outcome. */
export interface ZcashOperationAnalyticsContext {
  readonly pageId?: string
  readonly fundingSource?: 'shielded' | 'transparent'
  readonly outputSymbol?: string
  readonly direction?: AnalyticsSwapDirection
  readonly hardware?: boolean
}

export interface OperationAnalyticsEvent {
  readonly name: AnalyticsEventName
  readonly options: TrackOptions
}

export function isZcashOperationAnalyticsContext(
  value: unknown
): value is ZcashOperationAnalyticsContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, field]) => {
    if (key === 'pageId' || key === 'outputSymbol') {
      return field === undefined || (typeof field === 'string' && field.length <= 96)
    }
    if (key === 'fundingSource') {
      return field === undefined || field === 'shielded' || field === 'transparent'
    }
    if (key === 'hardware') return field === undefined || typeof field === 'boolean'
    if (key === 'direction') {
      return (
        field === undefined ||
        field === 'zec_to_other' ||
        field === 'other_to_zec' ||
        field === 'same_chain' ||
        field === 'cross_chain'
      )
    }
    return false
  })
}

/** Projects a verified operation outcome without accepting caller-chosen event names. */
export function projectZcashOperationEvent(
  operation: ZcashAnalyticsOperation,
  outcome: 'broadcast' | 'failed',
  context: ZcashOperationAnalyticsContext = {},
  idempotencyKey?: string
): OperationAnalyticsEvent {
  const broadcast = outcome === 'broadcast'
  const name =
    operation === 'swap'
      ? broadcast
        ? ANALYTICS_EVENTS.SWAP_DEPOSIT_SENT
        : ANALYTICS_EVENTS.SWAP_FAILED
      : operation === 'shield'
        ? broadcast
          ? ANALYTICS_EVENTS.SHIELD_SUCCEEDED
          : ANALYTICS_EVENTS.SHIELD_FAILED
        : broadcast
          ? ANALYTICS_EVENTS.SEND_SUCCEEDED
          : ANALYTICS_EVENTS.SEND_FAILED

  return {
    name,
    options: {
      pageId: context.pageId ?? PAGE_IDS.BACKGROUND,
      chain: 'zcash',
      hasTransaction: broadcast ? 1 : 0,
      inputSymbol: 'ZEC',
      ...(operation === 'swap' ? { outputSymbol: context.outputSymbol } : {}),
      idempotencyKey,
      params:
        operation === 'swap' && broadcast
          ? { from_token: 'ZEC', to_token: context.outputSymbol }
          : broadcast && context.hardware !== undefined
            ? { hardware: context.hardware }
            : undefined,
      extra:
        operation === 'swap'
          ? { direction: context.direction, sourceFamily: 'zcash' }
          : operation === 'send' || operation === 'unshield'
            ? { funding_source: context.fundingSource, kind: 'send' }
            : undefined
    }
  }
}
