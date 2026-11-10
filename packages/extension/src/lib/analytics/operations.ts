import { ANALYTICS_EVENTS, PAGE_IDS, type AnalyticsEventName } from './constants'
import { transactionAnalyticsFamily } from '@/core/transactions/transaction-analytics'
import { ZCASH_CHAIN_IDS } from '@/core/chains/registry/chain-ids'
import type { ConfidentialFundingPlan } from '@/core/services/confidential-funding/confidential-funding-model'
import type { ExternalShieldDeposit } from '@/core/services/confidential-funding/confidential-external-deposit'
import type { TrackOptions } from './types'

export type ZcashAnalyticsOperation = 'send' | 'unshield' | 'shield' | 'swap' | 'transfer'
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

export function resolveZcashAnalyticsOperation(
  kind: ZcashAnalyticsOperation,
  userAction?: 'transfer'
): ZcashAnalyticsOperation {
  return kind === 'swap' && userAction === 'transfer' ? 'transfer' : kind
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
          : operation === 'send' || operation === 'unshield' || operation === 'transfer'
            ? {
                funding_source: context.fundingSource,
                kind: operation === 'transfer' ? 'transfer' : 'send'
              }
            : undefined
    }
  }
}

function confidentialResultEvent(
  operation: NonNullable<ConfidentialFundingPlan['operation']>,
  status: 'success' | 'refunded' | 'failed' | 'expired' | 'cancelled',
  sourceChainId: string,
  idempotencyKey: string
): OperationAnalyticsEvent {
  return {
    name: ANALYTICS_EVENTS.SHIELD_OPERATION_RESULT,
    options: {
      pageId: PAGE_IDS.BACKGROUND,
      chain:
        sourceChainId === ZCASH_CHAIN_IDS.mainnet || sourceChainId === ZCASH_CHAIN_IDS.testnet
          ? 'zcash'
          : (transactionAnalyticsFamily(sourceChainId) ?? 'near'),
      hasTransaction: status === 'success' || status === 'refunded' ? 1 : 0,
      idempotencyKey,
      extra: { operation, status }
    }
  }
}

export function projectConfidentialPlanResult(
  previous: ConfidentialFundingPlan,
  next: ConfidentialFundingPlan
): OperationAnalyticsEvent | null {
  if (previous.phase === next.phase) return null
  const status = next.phase === 'ready' ? 'success' : next.phase
  if (
    status !== 'success' &&
    status !== 'refunded' &&
    status !== 'failed' &&
    status !== 'expired' &&
    status !== 'cancelled'
  )
    return null
  if (
    status === 'failed' &&
    next.errorStatus === 'LOCAL_PROCESSING_FAILED' &&
    next.requiresDeposit &&
    Boolean(next.preparedDeposit?.transactionHash)
  )
    return null
  return confidentialResultEvent(
    next.operation ?? 'cluster',
    status,
    next.source.chainId,
    `shield-plan:${next.planId}`
  )
}

export function projectExternalDepositResult(
  previous: ExternalShieldDeposit,
  next: ExternalShieldDeposit
): OperationAnalyticsEvent | null {
  const settled = (record: ExternalShieldDeposit) =>
    record.phase === 'refunded'
      ? 'refunded'
      : record.phase === 'ready' &&
          record.settledOutputRaw !== undefined &&
          /^[1-9]\d*$/.test(record.settledOutputRaw)
        ? 'success'
        : null
  const status = settled(next)
  if (!status || status === settled(previous)) return null
  return confidentialResultEvent(
    'deposit',
    status,
    next.source.chainId,
    `shield-deposit:${next.depositId}`
  )
}
