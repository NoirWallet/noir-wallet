import { useMemo, useEffect, useRef } from 'react'
import { Icon } from '@iconify/react'
import {
  useAccountDataStore,
  formatTransactionForDisplay,
  buildAccountKey
} from '@/store/account-data-store'
import { TokenIcon } from '../tokens/TokenIcon'
import { WALLET_CONFIG } from '@/config/wallet'
import { getNetworkConfig } from '@/config/networks'
import { getTransactionConfirmations } from '@/lib/zcash-node-rpc'
import { useWalletStore } from '@/store/wallet-store'
import type { Transaction } from '@/types'
import { useIntentsProgress } from '../../hooks/useIntentsProgress'
import { isTerminalIntentsStatus } from '@/lib/intents-progress'
import { getIntentsStatusCopy, type TransactionStatusTone } from '@/lib/transaction-status-copy'

interface TransactionListProps {
  network: 'mainnet' | 'testnet'
  onItemClick?: (txId: string) => void
}

async function checkZcashTxOnChain(
  txHash: string,
  network: 'mainnet' | 'testnet'
): Promise<boolean> {
  const rpcUrl = getNetworkConfig(network).nodeRpcUrl
  if (!rpcUrl) return false

  const confirmations = await getTransactionConfirmations(rpcUrl, txHash)
  return confirmations !== null && confirmations >= WALLET_CONFIG.MIN_CONFIRMATIONS
}

async function recheckPendingTx(tx: Transaction): Promise<Partial<Transaction> | null> {
  if (tx.txHash && (tx.type === 'send' || tx.type === 'shield')) {
    const confirmed = await checkZcashTxOnChain(tx.txHash, tx.network)
    return confirmed ? { status: 'success', notified: true } : null
  }

  // Tx stuck without txHash for > 10 min means the WASM call failed but the
  // status update was lost (e.g. popup closed before background could notify).
  const ORPHAN_TIMEOUT_MS = 10 * 60 * 1000
  if (!tx.txHash && Date.now() - tx.timestamp > ORPHAN_TIMEOUT_MS) {
    return { status: 'failed', notified: true }
  }

  return null
}

function getStatusClassName(tone: TransactionStatusTone): string {
  if (tone === 'error') return 'text-red-500'
  if (tone === 'success') return 'text-green-500'
  return 'text-yellow-500'
}

/**
 * Displays transaction history grouped by date
 */
export function TransactionList({ network, onItemClick }: TransactionListProps) {
  const transactions = useAccountDataStore(state => state.getCurrentTransactions())
  const reloadTransactions = useAccountDataStore(state => state.reloadTransactions)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const accountKey =
    currentWalletId && currentAccountId
      ? buildAccountKey(network, currentWalletId, currentAccountId)
      : undefined
  const intentsProgress = useIntentsProgress(accountKey)
  const isSyncing = useAccountDataStore(state =>
    currentWalletId ? state.getWalletSyncState(network, currentWalletId).isSyncing : false
  )
  const recheckedRef = useRef(false)

  useEffect(() => {
    recheckedRef.current = false

    if (currentAccountId && currentWalletId) {
      const currentNetwork = useWalletStore.getState().currentNetwork
      const accountKey = buildAccountKey(currentNetwork, currentWalletId, currentAccountId)
      console.log('[TransactionList] Reloading for:', accountKey)
      reloadTransactions(accountKey).catch(console.error)
    }
  }, [currentWalletId, currentAccountId, reloadTransactions, isSyncing])

  useEffect(() => {
    if (recheckedRef.current) return
    const backgroundRecheckTxs = transactions.filter(
      tx =>
        tx.network === network &&
        (tx.status === 'pending' ||
          tx.status === 'confirming' ||
          tx.status === 'relay_confirmed' ||
          (tx.status === 'failed' &&
            !tx.id.startsWith('wasm_') &&
            !!tx.txHash?.trim() &&
            (tx.type === 'send' || tx.type === 'shield' || tx.type === 'receive')))
    )
    if (backgroundRecheckTxs.length === 0 || !accountKey) return
    recheckedRef.current = true

    chrome.runtime.sendMessage({ type: 'RECHECK_PENDING_TRANSACTIONS', accountKey }).catch(() => {})

    const { updateTransaction } = useAccountDataStore.getState()
    const foregroundRecheckTxs = backgroundRecheckTxs.filter(
      tx =>
        tx.type !== 'swap' &&
        tx.type !== 'supply' &&
        tx.type !== 'withdraw' &&
        tx.type !== 'claim' &&
        tx.status === 'pending'
    )
    foregroundRecheckTxs.forEach(async tx => {
      try {
        const updates = await recheckPendingTx(tx)
        if (updates) {
          await updateTransaction(tx.id, updates)
        }
      } catch {}
    })
  }, [transactions, network, accountKey])

  const groups = useMemo(() => {
    const localFiltered = transactions.filter(tx => tx.network === network)

    const localItems = localFiltered
      .sort((a, b) => b.timestamp - a.timestamp)
      .map(tx => {
        const formatted = formatTransactionForDisplay(tx)
        const progress = intentsProgress.find(
          entry =>
            entry.transactionId === tx.id &&
            !isTerminalIntentsStatus(entry.status) &&
            (entry.kind !== 'swap' || entry.direction === 'from_zcash')
        )
        const progressCopy = progress ? getIntentsStatusCopy(progress.status) : null
        return {
          ...formatted,
          status: progressCopy?.compactLabel ?? formatted.status,
          statusTone: progressCopy?.tone ?? formatted.statusTone,
          statusDescription: progressCopy?.description ?? formatted.statusDescription,
          timestamp: tx.timestamp,
          isWasm: false,
          intentsProgress: progress
        }
      })

    const allItems = localItems

    const dateMap = new Map<string, typeof allItems>()
    for (const item of allItems) {
      const existing = dateMap.get(item.date)
      if (existing) {
        existing.push(item)
      } else {
        dateMap.set(item.date, [item])
      }
    }

    return Array.from(dateMap.entries()).map(([date, items]) => ({ date, items }))
  }, [transactions, network, intentsProgress])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted">
        <Icon icon="lucide:inbox" width={48} height={48} className="mb-4 opacity-50" />
        <p className="text-sm">No transactions yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(group => (
        <div key={group.date}>
          <p className="text-xs text-muted mb-2 px-5">{group.date}</p>
          <div className="space-y-2">
            {group.items.map(tx => (
              <button
                key={tx.id}
                onClick={() => onItemClick?.(tx.id)}
                className="w-full flex items-center justify-between py-3 px-5 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative size-8 rounded-full bg-foreground/10 flex items-center justify-center">
                    <Icon
                      icon={
                        tx.type === 'receive' || tx.type === 'withdraw' || tx.type === 'claim'
                          ? 'radix-icons:arrow-bottom-left'
                          : 'lucide:send'
                      }
                      className="size-4 text-foreground"
                    />
                    <TokenIcon
                      symbol="ZEC"
                      size={12}
                      className="absolute bottom-0 right-0 rounded-full"
                    />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="truncate font-medium">
                      {tx.type === 'receive'
                        ? 'Received'
                        : tx.type === 'shield'
                          ? 'Shielded'
                          : tx.type === 'swap'
                            ? 'Swap'
                            : tx.type === 'supply'
                              ? 'Supply'
                              : tx.type === 'withdraw'
                                ? 'Withdraw'
                                : tx.type === 'claim'
                                  ? 'Claim'
                                  : 'Sent'}{' '}
                      ZEC
                    </p>
                    <p
                      className={`truncate text-xs ${getStatusClassName(tx.statusTone)}`}
                      title={
                        tx.intentsProgress
                          ? `Deposit: ${tx.intentsProgress.depositAddress}\nUpdated: ${new Date(
                              tx.intentsProgress.lastStatusChangeAt
                            ).toLocaleString()}`
                          : tx.statusDescription
                      }
                    >
                      {tx.status}
                    </p>
                  </div>
                </div>
                <p className="ml-3 shrink-0 font-medium">{tx.amount}</p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
