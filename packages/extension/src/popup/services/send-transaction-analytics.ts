import type { TransactionGraph } from '@/core/transactions/domain'
import {
  transactionAnalyticsFamily,
  transactionBroadcasted,
  transactionFailedBeforeBroadcast
} from '@/core/transactions/transaction-analytics'
import { IndexedDbTransactionRepository } from '@/infrastructure/persistence/repositories'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent } from '@/lib/analytics'

type FundingSource = 'main' | 'private'

function reportSendOutcome(
  graph: TransactionGraph,
  symbol: string,
  fundingSource?: FundingSource
): void {
  const chainId = graph.root.intent?.sender?.chainId
  const chain = chainId ? transactionAnalyticsFamily(chainId) : null
  if (!chain || graph.root.intent?.protocol || graph.root.kind !== 'transfer') return
  const broadcast = transactionBroadcasted(graph)
  if (!broadcast && !transactionFailedBeforeBroadcast(graph)) return
  sendAnalyticsEvent(broadcast ? ANALYTICS_EVENTS.SEND_SUCCEEDED : ANALYTICS_EVENTS.SEND_FAILED, {
    pageId: PAGE_IDS.SEND,
    chain,
    hasTransaction: broadcast ? 1 : 0,
    inputSymbol: symbol,
    idempotencyKey: `send-${broadcast ? 'broadcast' : 'failed'}:${graph.root.id}`,
    extra: fundingSource ? { funding_source: fundingSource } : undefined
  })
}

export function recordSendSubmission(
  graph: TransactionGraph,
  symbol: string,
  fundingSource?: FundingSource
): void {
  const chainId = graph.root.intent?.sender?.chainId
  const chain = chainId ? transactionAnalyticsFamily(chainId) : null
  if (!chain) return
  sendAnalyticsEvent(ANALYTICS_EVENTS.SEND_SUBMITTED, {
    pageId: PAGE_IDS.SEND,
    chain,
    inputSymbol: symbol,
    idempotencyKey: `send-submitted:${graph.root.id}`,
    extra: fundingSource ? { funding_source: fundingSource } : undefined
  })
}

export function recordSendResult(
  graph: TransactionGraph,
  symbol: string,
  fundingSource?: FundingSource
): void {
  reportSendOutcome(graph, symbol, fundingSource)
}

export function recordSendApprovalFailure(
  review: TransactionGraph,
  symbol: string,
  fundingSource?: FundingSource
): void {
  void new IndexedDbTransactionRepository()
    .get(review.root.scope, review.root.id)
    .then(graph => {
      if (graph) reportSendOutcome(graph, symbol, fundingSource)
    })
    .catch(() => {})
}
