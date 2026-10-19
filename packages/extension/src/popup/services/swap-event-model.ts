import type { AnalyticsChain } from '@/lib/analytics/constants'
import type { TransactionGraph } from '@/core/transactions/domain'

export function hasSubmittedRheaOrigin(graph: TransactionGraph): boolean {
  if (graph.root.intent?.protocol?.provider !== 'rhea-cross-chain-dex') return false
  return graph.segments.some(
    segment =>
      segment.role === 'origin' &&
      (segment.status === 'broadcast' ||
        segment.status === 'confirming' ||
        segment.status === 'final') &&
      (segment.target?.kind === 'onchain'
        ? Boolean(segment.evidence?.transactionHash)
        : segment.target?.kind === 'relay' && Boolean(segment.evidence?.externalReference))
  )
}

type SwapAnalyticsDirection = 'zec_to_other' | 'other_to_zec' | 'same_chain' | 'cross_chain'

function sourceChainFamily(
  chainId: string | undefined,
  blockchain: string | undefined
): AnalyticsChain | undefined {
  if (blockchain === 'zec' || blockchain === 'zcash' || chainId === 'zcash') return 'zcash'
  if (blockchain === 'btc' || chainId === 'btc') return 'bitcoin'
  if (blockchain === 'sol' || chainId === 'solana') return 'solana'
  if (blockchain === 'near' || chainId === 'near') return 'near'
  if (chainId && /^\d+$/.test(chainId)) return 'evm'
  return undefined
}

export function resolveSwapAnalyticsContext(input: {
  readonly sourceFamily?: AnalyticsChain | null
  readonly sourceBlockchain?: string
  readonly destinationBlockchain?: string
  readonly sourceChainId?: string
  readonly destinationChainId?: string
  readonly isTransfer: boolean
  readonly executionSourceMode: 'main' | 'private'
}): {
  readonly chain?: AnalyticsChain
  readonly direction: SwapAnalyticsDirection
  readonly fundingSource?: 'main' | 'private'
} {
  const chain =
    sourceChainFamily(input.sourceChainId, input.sourceBlockchain) ??
    input.sourceFamily ??
    undefined
  const sourceIsZec = chain === 'zcash'
  const destinationIsZec =
    input.destinationBlockchain === 'zec' ||
    input.destinationBlockchain === 'zcash' ||
    input.destinationChainId === 'zcash'
  const sameChain =
    input.sourceChainId !== undefined && input.sourceChainId === input.destinationChainId
  const direction = sameChain
    ? 'same_chain'
    : sourceIsZec
      ? 'zec_to_other'
      : destinationIsZec
        ? 'other_to_zec'
        : 'cross_chain'

  return {
    chain,
    direction,
    ...(input.isTransfer ? { fundingSource: input.executionSourceMode } : {})
  }
}

export function resolveSwapAnalyticsAction(input: {
  readonly privateTransferRequested: boolean
  readonly privateBalanceTransferRequested: boolean
  readonly crossChainSendRequested: boolean
  readonly isPrivateFunding: boolean
}): { readonly isTransfer: boolean; readonly kind: 'private-transfer' | 'transfer' } {
  return {
    isTransfer:
      input.privateTransferRequested ||
      input.privateBalanceTransferRequested ||
      input.crossChainSendRequested ||
      input.isPrivateFunding,
    kind: input.crossChainSendRequested ? 'transfer' : 'private-transfer'
  }
}
