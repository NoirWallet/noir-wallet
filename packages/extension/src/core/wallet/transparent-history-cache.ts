import type { VerboseTransaction } from '../../lib/zcash-node-rpc.ts'

export interface PartitionedVerboseTransactions {
  reusable: Map<string, VerboseTransaction>
  txidsToFetch: string[]
}

function hasRequiredConfirmations(
  transaction: VerboseTransaction,
  requiredConfirmations: number
): boolean {
  if (typeof transaction.confirmations === 'number') {
    return transaction.confirmations >= requiredConfirmations
  }

  return (
    requiredConfirmations <= 1 && typeof transaction.height === 'number' && transaction.height > 0
  )
}

/**
 * Confirmed transaction bodies are immutable and can be reused across syncs.
 * Mempool transactions are refreshed so confirmation state cannot get stuck.
 */
export function partitionVerboseTransactions(
  txids: readonly string[],
  cached: Readonly<Record<string, VerboseTransaction>>,
  requiredConfirmations = 1
): PartitionedVerboseTransactions {
  const reusable = new Map<string, VerboseTransaction>()
  const txidsToFetch: string[] = []

  for (const txid of txids) {
    const transaction = cached[txid]
    if (transaction && hasRequiredConfirmations(transaction, requiredConfirmations)) {
      reusable.set(txid, transaction)
    } else {
      txidsToFetch.push(txid)
    }
  }

  return { reusable, txidsToFetch }
}
