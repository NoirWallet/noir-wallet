import { backgroundZcashWalletRuntime } from './zcash-wallet-runtime'
import { syncScheduler } from './sync-scheduler'
import { syncJobStore } from '@/lib/sync-job-store'
import { logger } from '@/lib/logger'
import { useWalletStore } from '@/store/wallet-store'
import type { Network } from '@/types'

// accountKey format from buildAccountKey: `${network}_${walletId}_${accountId}`
// (network and UUIDs never contain underscores)
export function parseAccountKey(
  accountKey: string
): { network: Network; walletId: string; accountId: string } | null {
  const [network, walletId, accountId, extra] = accountKey.split('_')
  if (
    (network !== 'mainnet' && network !== 'testnet') ||
    !walletId ||
    !accountId ||
    extra !== undefined
  ) {
    return null
  }
  return { network, walletId, accountId }
}

// Persist the catch-up request before scheduling work so a service-worker
// restart can still resume it from the wallet snapshot.
export async function markWalletNeedsCatchUp(walletId: string, accountId?: string): Promise<void> {
  const network = backgroundZcashWalletRuntime.getNetwork()
  const wallet = useWalletStore.getState().getWallet(walletId)
  const resolvedAccountId =
    accountId || wallet?.accounts[0]?.id || useWalletStore.getState().currentAccountId

  const scannedHeight = backgroundZcashWalletRuntime.getWalletScannedHeight(walletId)

  await syncJobStore.upsert(walletId, network, {
    accountId: resolvedAccountId || '',
    status: 'interrupted',
    resumeOnStartup: true,
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
  await backgroundZcashWalletRuntime.refreshBalances(walletId, true)
}

export async function catchUpAfterOnChainTx(walletId: string, accountId: string): Promise<boolean> {
  const network = backgroundZcashWalletRuntime.getNetwork()
  const status = await syncScheduler.runTransactionCatchUp(network, walletId, accountId)
  if (status !== 'completed') {
    await markWalletNeedsCatchUp(walletId, accountId)
  }
  return status === 'completed'
}

export async function finalizeTxCatchUp(
  accountKey: string,
  requiredHeight?: number
): Promise<boolean> {
  const parsed = parseAccountKey(accountKey)
  if (!parsed) return false
  const { network, walletId, accountId } = parsed
  return (
    (await syncScheduler.runTransactionCatchUp(
      network,
      walletId,
      accountId,
      requiredHeight ?? null
    )) === 'completed'
  )
}
