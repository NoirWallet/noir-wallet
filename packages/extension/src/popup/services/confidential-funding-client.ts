import type {
  ConfidentialFundingPhase,
  ConfidentialFundingPlan,
  ConfidentialFundingReview
} from '@/core/services/confidential-funding'
import type { SwapStatus } from '@/core/services/intents-api'
import type { NetworkFeeTier } from '@/core/transactions/domain'

type RuntimeMessenger = (message: Readonly<Record<string, unknown>>) => Promise<unknown>

export interface PrepareConfidentialFundingRequest {
  readonly source: Readonly<{
    chainId: string
    chainName: string
    assetId: string
    protocolAssetId: string
    amountRaw: string
  }>
  readonly destination: Readonly<{
    chainId: string
    chainName: string
    assetId: string
    protocolAssetId: string
  }>
  readonly slippageBps: number
  readonly feeTier?: NetworkFeeTier
  readonly dedupKey?: string
}

export function getConfidentialFundingResult(plan: ConfidentialFundingPlan): Readonly<{
  completed: number
  total: number
  status: SwapStatus
}> {
  const total = plan.withdraws.length
  const completed = plan.withdraws.filter(row =>
    ['SUCCESS', 'COMPLETED', 'REFUNDED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(
      row.status.trim().toUpperCase()
    )
  ).length
  const status =
    plan.phase === 'ready'
      ? 'SUCCESS'
      : plan.phase === 'refunded'
        ? 'REFUNDED'
        : ['partial', 'failed', 'expired', 'cancelled'].includes(plan.phase)
          ? 'FAILED'
          : 'PROCESSING'
  return Object.freeze({
    completed,
    total,
    status: Object.freeze({
      status,
      originAsset: plan.source.protocolAssetId,
      destinationAsset: plan.destination.protocolAssetId,
      swapDetails: {
        destinationChainTxHashes: plan.withdraws.flatMap(row =>
          row.transactionHash ? [{ hash: row.transactionHash }] : []
        )
      }
    })
  })
}

const CONFIDENTIAL_TRANSACTION_PREFIX = 'tx:confidential:'

export function getConfidentialFundingPlanId(transactionId: string): string | null {
  if (!transactionId.startsWith(CONFIDENTIAL_TRANSACTION_PREFIX)) return null
  const planId = transactionId.slice(CONFIDENTIAL_TRANSACTION_PREFIX.length)
  return /^[a-zA-Z0-9:_-]{1,160}$/.test(planId) ? planId : null
}

const PHASES = new Set<ConfidentialFundingPhase>([
  'prepared',
  'authorized',
  'deposit-signed',
  'deposit-confirming',
  'signing-withdraws',
  'submitting',
  'processing',
  'partial',
  'ready',
  'refunded',
  'failed',
  'expired',
  'cancelled',
  'needs-auth'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value)) throw new Error('Confidential funding returned an invalid response')
  if (typeof value.error === 'string') throw new Error(value.error)
  if (!Object.prototype.hasOwnProperty.call(value, 'result')) {
    throw new Error('Confidential funding returned an invalid response')
  }
  return value.result
}

function parseReview(value: unknown): ConfidentialFundingReview {
  if (!isRecord(value)) throw new Error('Confidential funding review is invalid')
  const review = value as unknown as ConfidentialFundingReview
  if (
    typeof review.planId !== 'string' ||
    typeof review.transactionId !== 'string' ||
    !PHASES.has(review.phase) ||
    !/^[0-9a-f]{64}$/.test(review.payloadFingerprint) ||
    !Number.isSafeInteger(review.expiresAt) ||
    typeof review.requiresDeposit !== 'boolean' ||
    !/^\d+$/.test(review.sourceAmountRaw) ||
    !/^\d+$/.test(review.expectedOutputRaw) ||
    !/^\d+$/.test(review.minimumOutputRaw) ||
    !/^0x[0-9a-fA-F]{40}$/.test(review.sourceAddress) ||
    !/^0x[0-9a-fA-F]{40}$/.test(review.destinationAddress) ||
    !Number.isSafeInteger(review.withdrawCount) ||
    review.withdrawCount < 2 ||
    review.withdrawCount > 5 ||
    review.estimatedDurationMinutes !== 10 ||
    (review.sourceNetworkFee !== undefined &&
      (!/^\d+$/.test(review.sourceNetworkFee.raw) ||
        typeof review.sourceNetworkFee.symbol !== 'string' ||
        !Number.isSafeInteger(review.sourceNetworkFee.decimals)))
  ) {
    throw new Error('Confidential funding review is invalid')
  }
  return Object.freeze(review)
}

function parsePlan(value: unknown): ConfidentialFundingPlan {
  if (!isRecord(value) || !Array.isArray(value.withdraws)) {
    throw new Error('Confidential funding status is invalid')
  }
  const plan = value as unknown as ConfidentialFundingPlan
  if (
    typeof plan.planId !== 'string' ||
    typeof plan.transactionId !== 'string' ||
    !PHASES.has(plan.phase) ||
    !/^\d+$/.test(plan.expectedOutputRaw) ||
    plan.withdraws.length < 2 ||
    plan.withdraws.length > 5 ||
    plan.withdraws.some(
      (row, index) =>
        !isRecord(row) ||
        row.sequence !== index ||
        typeof row.status !== 'string' ||
        !/^\d+$/.test(row.amountRaw)
    )
  ) {
    throw new Error('Confidential funding status is invalid')
  }
  return Object.freeze(plan)
}

export function createConfidentialFundingClient(
  send: RuntimeMessenger = message => chrome.runtime.sendMessage(message)
) {
  return Object.freeze({
    prepare: async (
      request: PrepareConfidentialFundingRequest
    ): Promise<ConfidentialFundingReview> =>
      parseReview(unwrap(await send({ type: 'PREPARE_CONFIDENTIAL_FUNDING', request }))),
    confirm: async (planId: string, payloadFingerprint: string): Promise<ConfidentialFundingPlan> =>
      parsePlan(
        unwrap(
          await send({
            type: 'CONFIRM_CONFIDENTIAL_FUNDING',
            planId,
            payloadFingerprint
          })
        )
      ),
    get: async (planId: string): Promise<ConfidentialFundingPlan> =>
      parsePlan(unwrap(await send({ type: 'GET_CONFIDENTIAL_FUNDING', planId }))),
    cancel: async (planId: string): Promise<void> => {
      unwrap(await send({ type: 'CANCEL_CONFIDENTIAL_FUNDING', planId }))
    }
  })
}

export const confidentialFundingClient = createConfidentialFundingClient()
