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
  const binding = graph.root.intent?.protocol
  const rheaTransfer =
    binding?.provider === 'rhea-cross-chain-dex' && binding.userAction === 'transfer'
  if (!chain || (!rheaTransfer && (graph.root.kind !== 'transfer' || binding))) return
  if (!transactionBroadcasted(graph)) return
  try {
    void Promise.resolve(
      sink(ANALYTICS_EVENTS.SEND_SUCCEEDED, {
        pageId: PAGE_IDS.BACKGROUND,
        chain,
        hasTransaction: 1,
        idempotencyKey: rheaTransfer
          ? `rhea-origin:${binding.quoteHandle}`
          : `send-broadcast:${graph.root.id}`,
        ...(rheaTransfer ? { extra: { kind: 'transfer' } } : {})
      })
    ).catch(() => {})
  } catch {
    // Reporting cannot change a persisted broadcast result.
  }
}
