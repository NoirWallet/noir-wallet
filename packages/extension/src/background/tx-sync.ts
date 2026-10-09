import { accountManager } from '../core/wallet/account-manager'
import { syncScheduler } from './sync-scheduler'
import { syncJobStore } from '@/lib/sync-job-store'
import { logger } from '@/lib/logger'
import { useWalletStore } from '@/store/wallet-store'

// accountKey format from buildAccountKey: `${network}_${walletId}_${accountId}`
// (network and UUIDs never contain underscores)
export function parseAccountKey(
  accountKey: string
): { walletId: string; accountId: string } | null {
  const parts = accountKey.split('_')
  if (parts.length < 3) return null
  return { walletId: parts[1], accountId: parts[2] }
}

export function isForegroundWallet(walletId: string): boolean {
  const { currentWalletId } = useWalletStore.getState()
  const fg = syncScheduler.getForegroundWalletId() || currentWalletId
  return fg === walletId
}

// Records an 'interrupted' sync job so the next foreground sync reloads the
// wallet from the persisted DB (reloadPersistedWalletIfInterrupted) and
// catches up with the missed on-chain tx. Intentionally does NOT mark the
// wallet dirty: an idle wallet's in-memory state is consistent (just behind
// the chain tip), and marking it dirty would fail every read until the next
// sync runs.
export async function markWalletNeedsCatchUp(walletId: string, accountId?: string): Promise<void> {
  const network = accountManager.getNetwork()
  const wallet = useWalletStore.getState().getWallet(walletId)
  const resolvedAccountId =
    accountId || wallet?.accounts[0]?.id || useWalletStore.getState().currentAccountId

  const scannedHeight = accountManager.getWalletScannedHeight(walletId)

  await syncJobStore.upsert(walletId, network, {
    accountId: resolvedAccountId || '',
    status: 'interrupted',
    ...(scannedHeight > 0 ? { lastPersistedHeight: scannedHeight } : {})
  })

  logger.log(
    'Marked wallet for catch-up on next foreground sync',
    walletId,
    resolvedAccountId ?? undefined
  )
}

/** Refreshes the pending balance produced by WASM without forcing chain settlement. */
export async function refreshAfterOnChainBroadcast(walletId: string): Promise<void> {
  await accountManager.refreshBalances(walletId, true)
}

export async function catchUpAfterOnChainTx(walletId: string, accountId: string): Promise<boolean> {
  const status = await syncScheduler.runTransactionCatchUp(walletId, accountId)

  if (status === 'skipped' || status === 'failed' || status === 'partial') {
    logger.warn(`Tx catch-up sync ${status}, scheduling retry`, walletId, accountId)
    await markWalletNeedsCatchUp(walletId, accountId)
    accountManager.requestSync('transaction')
  }

  await accountManager.refreshBalances(walletId, true)
  await accountManager.refreshTransactionHistoryFromWasm(walletId, accountId).catch(() => {})
  return status === 'completed'
}

export async function finalizeTxCatchUp(accountKey: string): Promise<boolean> {
  const parsed = parseAccountKey(accountKey)
  if (!parsed) return false

  const { walletId, accountId } = parsed

  // Persist recovery before starting foreground work. The service worker may
  // be suspended while the immediate catch-up is still in flight.
  await markWalletNeedsCatchUp(walletId, accountId)

  return runScheduledTxCatchUp(accountKey)
}

/** Runs an already-persisted catch-up immediately when its wallet is foreground. */
export async function runScheduledTxCatchUp(accountKey: string): Promise<boolean> {
  const parsed = parseAccountKey(accountKey)
  if (!parsed) return false

  const { walletId, accountId } = parsed

  if (isForegroundWallet(walletId)) {
    try {
      return await catchUpAfterOnChainTx(walletId, accountId)
    } catch (err) {
      logger.warn('Foreground catch-up after tx confirm failed', walletId, accountId)
      console.error('[TxSync] catch-up failed:', err)
      await markWalletNeedsCatchUp(walletId, accountId)
      accountManager.requestSync('transaction')
    }
    return false
  }

  return false
}
