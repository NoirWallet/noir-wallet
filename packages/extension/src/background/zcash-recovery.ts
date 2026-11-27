import { getNetworkConfig } from '@/lib/runtime-network'
import { isValidZcashBirthdayHeight } from '@/core/wallet/birthday-height'
import { isAccountNetworkEnabled } from '@/core/wallet/account-network-selection'
import { buildAccountKey } from '@/core/wallet/account-scope'
import { fetchLatestBlockHeight } from '@/infrastructure/chains/rpc-registry-client'
import { loadTransactions } from '@/lib/indexed-db'
import { getVerboseTransaction, ZcashRpcError } from '@/lib/zcash-node-rpc'
import { normalizeTxHash } from '@/lib/tx-history-dedup'
import { useWalletStore } from '@/store/wallet-store'
import type { Network } from '@/types'
import { syncScheduler } from './sync-scheduler'
import { backgroundZcashWalletRuntime as runtime } from './zcash-wallet-runtime'

type RecoveryScope = {
  network: Network
  walletId: string
  accountId: string
  scopeVersion: number
  isCurrent: () => boolean
  assertCurrent: () => Promise<void>
}

type TransactionRecoveryResult = {
  status: 'already-present' | 'restored' | 'pending' | 'not-found' | 'unavailable'
  transactionId?: string
}

const recoveries = new Map<string, Promise<TransactionRecoveryResult>>()
const ranges = new Map<string, Promise<{ checkedThrough: number }>>()
const RANGE_BATCH_SIZE = 100

function findLocalTransaction(scope: RecoveryScope, txid: string) {
  const accountKey = buildAccountKey(scope.network, scope.walletId, scope.accountId)
  return loadTransactions(accountKey).then(records =>
    records.find(
      record => record.network === scope.network && normalizeTxHash(record.txHash) === txid
    )
  )
}

function walletBirthday(scope: RecoveryScope): number {
  const wallet = useWalletStore.getState().getWallet(scope.walletId)
  const birthdays = (wallet?.accounts ?? [])
    .filter(account => isAccountNetworkEnabled(account, scope.network, 'zcash'))
    .map(account => account.birthdayHeight)
    .filter(isValidZcashBirthdayHeight)
  if (!birthdays.length) throw new Error('Zcash wallet birthday is unavailable.')
  return Math.min(...birthdays)
}

async function rescanChunk(scope: RecoveryScope, start: number, endExclusive: number) {
  await runtime.runRecoveryMutation(
    scope.walletId,
    scope.accountId,
    scope.assertCurrent,
    async core => {
      const requestedHeight = endExclusive - 1
      const summary = await core.getWalletSummary({ allowDuringSync: true })
      if (!summary || !(summary.chain_tip_height >= requestedHeight)) {
        const latestHeight = await core.getLatestHeight()
        if (!isValidZcashBirthdayHeight(latestHeight) || latestHeight < requestedHeight) {
          throw new Error('The wallet node has not reached the requested height.')
        }
        await core.syncSessionSetup()
      }
      await core.rescanRange(start, endExclusive)
    }
  )
}

async function refreshRecoveryProjection(scope: RecoveryScope): Promise<void> {
  await scope.assertCurrent()
  await runtime.refreshBalances(scope.walletId, true, {
    localOnly: true,
    canApply: scope.isCurrent
  })
  await runtime.refreshTransactionHistoryFromWasm(scope.walletId, scope.accountId, {
    localOnly: true,
    canApply: scope.isCurrent
  })
  await scope.assertCurrent()
}

async function recoveredTransaction(scope: RecoveryScope, txid: string) {
  if (!(await runtime.hasRecoveryTransaction(scope.walletId, scope.accountId, txid))) return
  await refreshRecoveryProjection(scope)
  return findLocalTransaction(scope, txid)
}

async function recoverTransaction(
  scope: RecoveryScope,
  txid: string
): Promise<TransactionRecoveryResult> {
  const local = await findLocalTransaction(scope, txid)
  await scope.assertCurrent()
  if (local) return { status: 'already-present', transactionId: local.id }

  let enhancementFailed = false
  let enhanced
  try {
    enhanced = await syncScheduler.runRecoveryStep(async () => {
      await runtime.runRecoveryMutation(
        scope.walletId,
        scope.accountId,
        scope.assertCurrent,
        core => core.enhanceTransaction(txid)
      )
      return recoveredTransaction(scope, txid)
    })
  } catch {
    enhancementFailed = true
  }
  await scope.assertCurrent()
  if (enhanced) {
    return {
      status: enhanced.confirmations === 0 ? 'pending' : 'restored',
      transactionId: enhanced.id
    }
  }

  const { nodeRpcUrl, rpcUrl } = getNetworkConfig(scope.network)
  if (!nodeRpcUrl) return { status: 'unavailable' }
  let transaction
  try {
    transaction = await getVerboseTransaction(nodeRpcUrl, txid)
  } catch (error) {
    await scope.assertCurrent()
    return {
      status: error instanceof ZcashRpcError && error.code === -5 ? 'not-found' : 'unavailable'
    }
  }
  await scope.assertCurrent()
  if (typeof transaction?.txid !== 'string' || transaction.txid.toLowerCase() !== txid) {
    return { status: 'unavailable' }
  }
  if (transaction.confirmations === 0 || transaction.confirmations === undefined) {
    return { status: 'pending' }
  }
  const height = transaction.height
  if (
    !Number.isSafeInteger(transaction.confirmations) ||
    !transaction.confirmations ||
    transaction.confirmations < 0 ||
    !isValidZcashBirthdayHeight(height) ||
    !isValidZcashBirthdayHeight(height + 1)
  )
    return { status: 'unavailable' }
  if (height < walletBirthday(scope)) return { status: 'not-found' }

  let recovered
  try {
    const chainTip = await fetchLatestBlockHeight(rpcUrl)
    if (height > chainTip) return { status: 'unavailable' }
    recovered = await syncScheduler.runRecoveryStep(async () => {
      await rescanChunk(scope, height, height + 1)
      return recoveredTransaction(scope, txid)
    })
  } catch {
    await scope.assertCurrent()
    return { status: 'unavailable' }
  }
  await scope.assertCurrent()
  if (recovered) return { status: 'restored', transactionId: recovered.id }
  return { status: enhancementFailed ? 'unavailable' : 'not-found' }
}

export async function requestZcashTransactionRecovery(scope: RecoveryScope, input: string) {
  const txid = input.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Enter a valid Zcash transaction ID.')
  await scope.assertCurrent()
  const key = JSON.stringify([
    scope.network,
    scope.walletId,
    scope.accountId,
    scope.scopeVersion,
    txid
  ])
  const existing = recoveries.get(key)
  if (existing) return existing
  const task = recoverTransaction(scope, txid).finally(() => recoveries.delete(key))
  recoveries.set(key, task)
  return task
}

export async function requestZcashRangeRecovery(scope: RecoveryScope, start: number, end: number) {
  await scope.assertCurrent()
  if (!isValidZcashBirthdayHeight(start) || !isValidZcashBirthdayHeight(end + 1) || start > end) {
    throw new Error('Enter a valid block range.')
  }
  const key = JSON.stringify([
    scope.network,
    scope.walletId,
    scope.accountId,
    scope.scopeVersion,
    start,
    end
  ])
  const existing = ranges.get(key)
  if (existing) return existing
  const task = (async () => {
    if (start < walletBirthday(scope)) throw new Error('Start height is below the wallet birthday.')
    const chainTip = await fetchLatestBlockHeight(getNetworkConfig(scope.network).rpcUrl)
    if (!isValidZcashBirthdayHeight(chainTip) || end > chainTip) {
      throw new Error('End height is above the available chain tip.')
    }
    let checkedThrough: number | undefined
    for (let cursor = start; cursor <= end; cursor += RANGE_BATCH_SIZE) {
      const endExclusive = Math.min(cursor + RANGE_BATCH_SIZE, end + 1)
      try {
        await syncScheduler.runRecoveryStep(async () => {
          await rescanChunk(scope, cursor, endExclusive)
          checkedThrough = endExclusive - 1
          await refreshRecoveryProjection(scope)
        })
      } catch (error) {
        await scope.assertCurrent()
        if (checkedThrough === undefined) throw error
        return { checkedThrough }
      }
    }
    return { checkedThrough: end }
  })().finally(() => ranges.delete(key))
  ranges.set(key, task)
  return task
}
