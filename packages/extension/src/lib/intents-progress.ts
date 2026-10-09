import type { SwapStatus, SwapStatusType } from '@/core/services/intents-api'
import { WALLET_CONFIG, WASM_SELECTION_CONFIRMATIONS } from '@/config/wallet'

export const INTENTS_PROGRESS_STORAGE_KEY = 'pending_transactions'

export const INTENTS_PROGRESS_STALE_MS = 60 * 60 * 1000
export const SWAP_INTENTS_AUTO_REFRESH_MS = 3 * 60 * 60 * 1000
export const SWAP_PENDING_AUTO_HIDE_MS = 24 * 60 * 60 * 1000

export type IntentsProgressKind = 'swap' | 'supply' | 'withdraw' | 'claim'
export type SwapDirection = 'to_zcash' | 'from_zcash'

export interface IntentsProgressTxHash {
  hash: string
  explorerUrl?: string
}

export interface IntentsProgressEntry {
  kind: IntentsProgressKind
  direction?: SwapDirection
  depositAddress: string
  tokenInSymbol: string
  tokenOutSymbol: string
  tokenInIcon?: string
  tokenOutIcon?: string
  amountIn: string
  amountOut: string
  usdAmount?: string
  actionName: string
  accountKey: string
  transactionId?: string
  originChain?: string
  destinationChain?: string
  originAsset?: string
  destinationAsset?: string
  quoteExpiresAt?: number
  status: SwapStatusType
  createdAt: number
  lastCheckedAt: number
  lastStatusChangeAt: number
  hasLeftPendingDeposit: boolean
  completionHandledAt?: number
  actualAmountOut?: string
  originChainTxHashes?: IntentsProgressTxHash[]
  destinationChainTxHashes?: IntentsProgressTxHash[]
  destinationConfirmations?: number
  destinationRequiredConfirmations?: number
  destinationCatchUpConfirmations?: number
}

type IntentsProgressBaseInput = Omit<
  IntentsProgressEntry,
  | 'kind'
  | 'direction'
  | 'actionName'
  | 'status'
  | 'createdAt'
  | 'lastCheckedAt'
  | 'lastStatusChangeAt'
  | 'hasLeftPendingDeposit'
  | 'completionHandledAt'
  | 'actualAmountOut'
  | 'originChainTxHashes'
  | 'destinationChainTxHashes'
  | 'destinationConfirmations'
  | 'destinationRequiredConfirmations'
  | 'destinationCatchUpConfirmations'
>

export type IntentsProgressInput = IntentsProgressBaseInput & { actionName?: string } & (
    | { kind: 'swap'; direction: SwapDirection }
    | { kind: Exclude<IntentsProgressKind, 'swap'>; direction?: never }
  )

const STATUSES = new Set<SwapStatusType>([
  'KNOWN_DEPOSIT_TX',
  'PENDING_DEPOSIT',
  'INCOMPLETE_DEPOSIT',
  'PROCESSING',
  'SUCCESS',
  'REFUNDED',
  'FAILED'
])

const KINDS = new Set<IntentsProgressKind>(['swap', 'supply', 'withdraw', 'claim'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function optionalImageUrl(value: unknown): string | undefined {
  const imageUrl = optionalString(value)
  if (!imageUrl) return undefined
  try {
    return new URL(imageUrl).protocol === 'https:' ? imageUrl : undefined
  } catch {
    return undefined
  }
}

function normalizeTxHashes(value: unknown): IntentsProgressTxHash[] | undefined {
  if (!Array.isArray(value)) return undefined
  const hashes = value.flatMap(item => {
    if (!isRecord(item)) return []
    const hash = optionalString(item.hash)
    if (!hash) return []
    return [{ hash, explorerUrl: optionalString(item.explorerUrl) }]
  })
  return hashes.length > 0 ? hashes : undefined
}

function inferKind(value: Record<string, unknown>): IntentsProgressKind {
  if (typeof value.kind === 'string' && KINDS.has(value.kind as IntentsProgressKind)) {
    return value.kind as IntentsProgressKind
  }
  const actionName = optionalString(value.actionName)?.toLowerCase()
  if (actionName === 'supply') return 'supply'
  if (actionName === 'withdraw') return 'withdraw'
  if (actionName === 'claim') return 'claim'
  return 'swap'
}

function inferDirection(
  value: Record<string, unknown>,
  kind: IntentsProgressKind
): SwapDirection | undefined {
  if (kind !== 'swap') return undefined
  if (value.direction === 'to_zcash' || value.direction === 'from_zcash') return value.direction

  const destination = `${optionalString(value.destinationChain) || ''} ${
    optionalString(value.destinationAsset) || ''
  } ${optionalString(value.tokenOutSymbol) || ''}`.toLowerCase()
  return destination.includes('zec') || destination.includes('zcash') ? 'to_zcash' : 'from_zcash'
}

export function isTerminalIntentsStatus(status: SwapStatusType): boolean {
  return status === 'SUCCESS' || status === 'REFUNDED' || status === 'FAILED'
}

export function needsZcashDestinationConfirmations(entry: IntentsProgressEntry): boolean {
  if (
    entry.kind !== 'swap' ||
    entry.direction !== 'to_zcash' ||
    entry.status !== 'SUCCESS' ||
    !entry.destinationChainTxHashes?.[0]?.hash
  ) {
    return false
  }

  const requiredConfirmations =
    entry.destinationRequiredConfirmations ?? WALLET_CONFIG.SPENDABILITY_CONFIRMATIONS
  return (
    (entry.destinationConfirmations ?? 0) < requiredConfirmations ||
    needsZcashDestinationCatchUp(entry)
  )
}

export function getZcashDestinationCatchUpThreshold(
  confirmations: number,
  requiredConfirmations: number = WALLET_CONFIG.SPENDABILITY_CONFIRMATIONS
): number {
  if (!Number.isSafeInteger(confirmations) || confirmations <= 0) return 0
  if (confirmations >= requiredConfirmations) return requiredConfirmations
  if (confirmations >= WASM_SELECTION_CONFIRMATIONS) return WASM_SELECTION_CONFIRMATIONS
  return 1
}

export function needsZcashDestinationCatchUp(entry: IntentsProgressEntry): boolean {
  return (
    entry.kind === 'swap' &&
    entry.direction === 'to_zcash' &&
    entry.status === 'SUCCESS' &&
    !!entry.destinationChainTxHashes?.[0]?.hash &&
    getZcashDestinationCatchUpThreshold(
      entry.destinationConfirmations ?? 0,
      entry.destinationRequiredConfirmations
    ) > (entry.destinationCatchUpConfirmations ?? 0)
  )
}

export function normalizeIntentsProgressEntry(
  value: unknown,
  now = Date.now()
): IntentsProgressEntry | null {
  if (!isRecord(value)) return null

  const depositAddress = optionalString(value.depositAddress)
  const tokenInSymbol = optionalString(value.tokenInSymbol)
  const tokenOutSymbol = optionalString(value.tokenOutSymbol)
  const amountIn = optionalString(value.amountIn)
  const amountOut = optionalString(value.amountOut)
  const accountKey = optionalString(value.accountKey)
  if (
    !depositAddress ||
    !tokenInSymbol ||
    !tokenOutSymbol ||
    !amountIn ||
    !amountOut ||
    !accountKey
  ) {
    return null
  }

  const status =
    typeof value.status === 'string' && STATUSES.has(value.status as SwapStatusType)
      ? (value.status as SwapStatusType)
      : 'PENDING_DEPOSIT'
  const createdAt = optionalTimestamp(value.createdAt) || now
  const lastStatusChangeAt = optionalTimestamp(value.lastStatusChangeAt) || createdAt
  const kind = inferKind(value)

  return {
    kind,
    direction: inferDirection(value, kind),
    depositAddress,
    tokenInSymbol,
    tokenOutSymbol,
    tokenInIcon: optionalImageUrl(value.tokenInIcon),
    tokenOutIcon: optionalImageUrl(value.tokenOutIcon),
    amountIn,
    amountOut,
    usdAmount: optionalString(value.usdAmount),
    actionName: optionalString(value.actionName) || 'Transaction',
    accountKey,
    transactionId: optionalString(value.transactionId),
    originChain: optionalString(value.originChain),
    destinationChain: optionalString(value.destinationChain),
    originAsset: optionalString(value.originAsset),
    destinationAsset: optionalString(value.destinationAsset),
    quoteExpiresAt: optionalTimestamp(value.quoteExpiresAt),
    status,
    createdAt,
    lastCheckedAt: optionalTimestamp(value.lastCheckedAt) || lastStatusChangeAt,
    lastStatusChangeAt,
    hasLeftPendingDeposit: value.hasLeftPendingDeposit === true || status !== 'PENDING_DEPOSIT',
    completionHandledAt: optionalTimestamp(value.completionHandledAt),
    actualAmountOut: optionalString(value.actualAmountOut),
    originChainTxHashes: normalizeTxHashes(value.originChainTxHashes),
    destinationChainTxHashes: normalizeTxHashes(value.destinationChainTxHashes),
    destinationConfirmations: optionalNonNegativeInteger(value.destinationConfirmations),
    destinationRequiredConfirmations: optionalPositiveInteger(
      value.destinationRequiredConfirmations
    ),
    destinationCatchUpConfirmations: optionalNonNegativeInteger(
      value.destinationCatchUpConfirmations
    )
  }
}

export function registerIntentsProgress(
  input: IntentsProgressInput,
  existing?: IntentsProgressEntry,
  now = Date.now()
): IntentsProgressEntry {
  return {
    ...existing,
    ...input,
    actionName: input.actionName || existing?.actionName || 'Transaction',
    transactionId: input.transactionId || existing?.transactionId,
    usdAmount: input.usdAmount || existing?.usdAmount,
    tokenInIcon: optionalImageUrl(input.tokenInIcon) || existing?.tokenInIcon,
    tokenOutIcon: optionalImageUrl(input.tokenOutIcon) || existing?.tokenOutIcon,
    status: existing?.status || 'PENDING_DEPOSIT',
    createdAt: existing?.createdAt || now,
    lastCheckedAt: existing?.lastCheckedAt || now,
    lastStatusChangeAt: existing?.lastStatusChangeAt || now,
    hasLeftPendingDeposit: existing?.hasLeftPendingDeposit || false,
    completionHandledAt: existing?.completionHandledAt,
    actualAmountOut: existing?.actualAmountOut,
    originChainTxHashes: existing?.originChainTxHashes,
    destinationChainTxHashes: existing?.destinationChainTxHashes,
    destinationConfirmations: existing?.destinationConfirmations,
    destinationRequiredConfirmations: existing?.destinationRequiredConfirmations,
    destinationCatchUpConfirmations: existing?.destinationCatchUpConfirmations
  }
}

export function applyIntentsProgressStatus(
  entry: IntentsProgressEntry,
  status: SwapStatus,
  now = Date.now()
): IntentsProgressEntry {
  const nextStatus = isTerminalIntentsStatus(entry.status) ? entry.status : status.status
  const changed = nextStatus !== entry.status
  return {
    ...entry,
    status: nextStatus,
    lastCheckedAt: now,
    lastStatusChangeAt: changed ? now : entry.lastStatusChangeAt,
    hasLeftPendingDeposit: entry.hasLeftPendingDeposit || nextStatus !== 'PENDING_DEPOSIT',
    actualAmountOut: status.swapDetails?.amountOutFormatted || entry.actualAmountOut,
    originAsset: status.originAsset || entry.originAsset,
    destinationAsset: status.destinationAsset || entry.destinationAsset,
    originChainTxHashes:
      normalizeTxHashes(status.swapDetails?.originChainTxHashes) || entry.originChainTxHashes,
    destinationChainTxHashes:
      normalizeTxHashes(status.swapDetails?.destinationChainTxHashes) ||
      entry.destinationChainTxHashes
  }
}

export function updateIntentsProgressStatus(
  entry: IntentsProgressEntry,
  status: SwapStatusType,
  now = Date.now()
): IntentsProgressEntry {
  return applyIntentsProgressStatus(entry, { status }, now)
}

export function isIntentsProgressStale(entry: IntentsProgressEntry, now = Date.now()): boolean {
  const timeout = entry.kind === 'swap' ? SWAP_INTENTS_AUTO_REFRESH_MS : INTENTS_PROGRESS_STALE_MS
  return now - entry.lastStatusChangeAt >= timeout
}

export function shouldAutoRefreshIntentsProgress(
  entry: IntentsProgressEntry,
  now = Date.now()
): boolean {
  if (entry.kind !== 'swap') {
    return !isTerminalIntentsStatus(entry.status) || !entry.completionHandledAt
  }
  if (needsZcashDestinationCatchUp(entry)) return true
  if (isIntentsProgressStale(entry, now)) return false
  return (
    needsZcashDestinationConfirmations(entry) ||
    !isTerminalIntentsStatus(entry.status) ||
    !entry.completionHandledAt
  )
}

export function shouldRefreshIntentsProgressOnOpen(entry: IntentsProgressEntry): boolean {
  return (
    entry.kind === 'swap' &&
    (needsZcashDestinationConfirmations(entry) ||
      !isTerminalIntentsStatus(entry.status) ||
      !entry.completionHandledAt)
  )
}

export function isIntentsProgressAutoHidden(
  entry: IntentsProgressEntry,
  now = Date.now()
): boolean {
  return (
    entry.kind === 'swap' &&
    entry.status === 'PENDING_DEPOSIT' &&
    !entry.hasLeftPendingDeposit &&
    now - entry.createdAt >= SWAP_PENDING_AUTO_HIDE_MS
  )
}

export function getIntentsExplorerUrl(depositAddress: string): string {
  return `https://explorer.near-intents.org/transactions/${encodeURIComponent(
    depositAddress
  )}?referral=noir_swap`
}
