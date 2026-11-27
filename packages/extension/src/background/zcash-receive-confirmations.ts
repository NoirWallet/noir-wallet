import { buildAccountKey } from '@/core/wallet/account-scope'
import {
  fetchTransparentReceiveTransactions,
  readZcashReceiveObservations,
  type ZcashReceiveObservation
} from '@/core/wallet/transparent-history'
import { DedupPromise } from '@/lib/async-utils'
import { loadTransactions } from '@/lib/indexed-db'
import { writeLocalActivity } from '@/infrastructure/persistence/repositories/local-activity'
import { getNetworkConfig } from '@/lib/runtime-network'
import type { AccountAddresses, AccountData, Network, Transaction } from '@/types/wallet'

const refreshes = new Map<string, DedupPromise<Transaction[]>>()

export async function recordZcashReceiveObservations(
  accountKey: string,
  observed: ReadonlyMap<string, ZcashReceiveObservation>,
  addresses?: AccountAddresses
): Promise<Transaction[]> {
  const { changed, transactions } = await writeLocalActivity('legacy-zcash', accountKey, {
    kind: 'receive-confirmations',
    observed,
    addresses
  })
  if (changed) {
    void chrome.runtime.sendMessage({ type: 'TRANSACTION_UPDATED', accountKey }).catch(() => {})
  }
  return transactions
}

export async function discoverZcashTransparentReceipts(
  network: Network,
  walletId: string,
  account: AccountData
): Promise<boolean> {
  const baseUrl = getNetworkConfig(network).nodeRpcUrl
  if (!baseUrl || !account.addresses.transparent) return false
  const accountKey = buildAccountKey(network, walletId, account.id)
  const current = await loadTransactions(accountKey)
  const sent = new Set(
    current
      .filter(transaction => transaction.type !== 'receive' && transaction.txHash)
      .map(transaction => transaction.txHash.toLowerCase())
  )
  const incoming = await fetchTransparentReceiveTransactions(account, network, {
    baseUrl,
    cacheKey: accountKey,
    walletCreatedTxids: sent
  })
  if (incoming.length > 0) {
    await writeLocalActivity('legacy-zcash', accountKey, { kind: 'history', receipts: incoming })
  }
  return true
}

export async function refreshZcashReceiveConfirmations(
  network: Network,
  walletId: string,
  accountId: string
): Promise<Transaction[]> {
  const accountKey = buildAccountKey(network, walletId, accountId)
  let refresh = refreshes.get(accountKey)
  if (!refresh) {
    refresh = new DedupPromise()
    refreshes.set(accountKey, refresh)
  }

  try {
    return await refresh.run(async () => {
      const baseUrl = getNetworkConfig(network).nodeRpcUrl
      const transactions = await loadTransactions(accountKey)
      if (!baseUrl) return transactions
      const { useWalletStore } = await import('@/store/wallet-store')
      const addresses = useWalletStore
        .getState()
        .getWallet(walletId)
        ?.accounts.find(account => account.id === accountId)?.addresses

      // Bound the whole batch, including the time spent waiting for an RPC slot.
      const observed = await readZcashReceiveObservations(
        transactions,
        baseUrl,
        AbortSignal.timeout(8_000),
        addresses
      )
      if (observed.size === 0) return loadTransactions(accountKey)
      return recordZcashReceiveObservations(accountKey, observed, addresses)
    })
  } finally {
    if (!refresh.isPending && refreshes.get(accountKey) === refresh) refreshes.delete(accountKey)
  }
}
