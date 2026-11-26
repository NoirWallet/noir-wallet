import type { ActivityItem, ActivityScope } from '@/core/activity'
import type { EvmTransferReview } from './evm-wallet-client'
import { getPendingEvmActivityOrigin } from './multichain-activity-presentation'

export interface EvmActivityRecoveryTarget {
  readonly scope: ActivityScope
  readonly chainId: string
  readonly address: string
  readonly executionMode: 'main' | 'private'
}

function matchesRecoverySender(item: ActivityItem, target: EvmActivityRecoveryTarget): boolean {
  const sender = item.snapshot?.sender
  return (
    item.source === 'wallet-v2' &&
    item.scope.keyDomainId === target.scope.keyDomainId &&
    item.scope.accountId === target.scope.accountId &&
    sender?.chainId === target.chainId &&
    sender.address.toLowerCase() === target.address.toLowerCase()
  )
}

export function getRecoverableEvmActivity(
  items: readonly ActivityItem[],
  target: EvmActivityRecoveryTarget
): readonly ActivityItem[] {
  return items.filter(
    item =>
      matchesRecoverySender(item, target) &&
      getPendingEvmActivityOrigin(item, [target.chainId]) !== null
  )
}

export function wasEvmActivityBroadcast(
  items: readonly ActivityItem[],
  target: EvmActivityRecoveryTarget,
  transactionId: string
): boolean {
  return items.some(
    item =>
      item.id === transactionId &&
      matchesRecoverySender(item, target) &&
      item.segments.some(
        segment =>
          segment.role === 'origin' &&
          segment.target.kind === 'onchain' &&
          segment.target.chainId === target.chainId &&
          ['broadcast', 'confirming', 'final'].includes(segment.status) &&
          segment.evidence?.transactionHash !== undefined
      )
  )
}

export function readEvmActivityRecoveryReview(
  review: EvmTransferReview,
  target: EvmActivityRecoveryTarget,
  expectedNonce: string
) {
  const root = review.graph.root
  const summary = review.review.summary
  const address = target.address.toLowerCase()
  if (
    root.scope.keyDomainId !== target.scope.keyDomainId ||
    root.scope.accountId !== target.scope.accountId ||
    root.kind !== 'cancel' ||
    root.status !== 'prepared' ||
    root.relation !== undefined ||
    review.review.chainId !== target.chainId ||
    summary.schema !== 'evm.transaction.v1' ||
    summary.fields.nonce !== expectedNonce ||
    summary.fields.from.toLowerCase() !== address ||
    summary.fields.to?.toLowerCase() !== address ||
    summary.fields.valueWei !== '0' ||
    summary.fields.calldata.byteLength !== 0
  ) {
    return null
  }
  return { nonce: summary.fields.nonce, maximumFeeWei: summary.fields.maximumFeeWei }
}
