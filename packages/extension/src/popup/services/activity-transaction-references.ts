import type { ActivityItem } from '@/core/activity'

export interface ActivityTransactionReference {
  readonly id: string
  readonly label: string
  readonly hash: string
  readonly chainId: string | null
}

export function getActivityTransactionReferences(
  item: ActivityItem
): readonly ActivityTransactionReference[] {
  const roleOrder = { origin: 0, relay: 1, destination: 2, refund: 3 } as const
  const hashedSegments = item.segments
    .filter(segment => segment.evidence?.transactionHash)
    .sort((left, right) => roleOrder[left.role] - roleOrder[right.role])
  return hashedSegments.flatMap(segment => {
    const hash = segment.evidence?.transactionHash
    if (!hash) return []
    const chainId = segment.target.kind === 'onchain' ? segment.target.chainId : null
    const label =
      hashedSegments.length === 1 && item.segments.length === 1
        ? 'Transaction Hash'
        : segment.role === 'origin'
          ? 'Outgoing Hash'
          : segment.role === 'destination'
            ? 'Destination Hash'
            : segment.role === 'refund'
              ? 'Refund Hash'
              : 'Relay Hash'
    return [
      Object.freeze({
        id: segment.id,
        label,
        hash,
        chainId
      })
    ]
  })
}
