import type { TransactionGraph } from '@/core/transactions/domain'
import {
  transactionAnalyticsFamily,
  transactionBroadcasted
} from '@/core/transactions/transaction-analytics'
import { ANALYTICS_EVENTS, PAGE_IDS, trackEvent } from './reporter'

export function reportBackgroundSendBroadcast(
  graph: TransactionGraph,
  sink: typeof trackEvent = trackEvent
): void {
  const chainId = graph.root.intent?.sender?.chainId
  const chain = chainId ? transactionAnalyticsFamily(chainId) : null
  if (!chain || graph.root.kind !== 'transfer' || graph.root.intent?.protocol) return
  if (!transactionBroadcasted(graph)) return
  try {
    void Promise.resolve(
      sink(ANALYTICS_EVENTS.SEND_SUCCEEDED, {
        pageId: PAGE_IDS.BACKGROUND,
        chain,
        hasTransaction: 1,
        idempotencyKey: `send-broadcast:${graph.root.id}`
      })
    ).catch(() => {})
  } catch {
    // Reporting cannot change a persisted broadcast result.
  }
}
