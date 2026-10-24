import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { KeyedTaskCoordinator } from '../src/lib/keyed-task-coordinator.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript')

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

function createScheduler(syncBlocks, refreshBalances, refreshHistory) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/background/sync-scheduler.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  )
  const manager = {
    beginSyncPreflight: () => null,
    finishSyncPreflight() {},
    ensureWalletReadyForSync: async () => true,
    waitForWalletReady: async () => true,
    syncBlocks,
    refreshBalances,
    refreshWalletTransactionHistoriesFromWasm: refreshHistory,
    getNetwork: () => 'testnet',
    isWalletSyncing: () => false
  }
  const noop = () => {}
  const dependencies = {
    '../core/wallet/account-manager': { accountManager: manager },
    '../core/wallet/secure-storage': { SecureStorage: {} },
    '@/lib/logger': { logger: { log: noop, info: noop, warn: noop, error: noop } },
    '@/lib/sync-job-store': { syncJobStore: {} },
    '@/lib/sync-abort': { clearSyncAbort: async () => {}, signalSyncAbort: async () => {} },
    '@/core/zcash/wallet-core': {},
    '@/config/wallet': { WALLET_CONFIG: { SYNC: { INIT_READY_TIMEOUT_MS: 1000 } } },
    '@/store/wallet-store': { useWalletStore: { getState: () => ({ currentWalletId: 'wallet' }) } },
    '@/store/account-data-store': { useAccountDataStore: { getState: () => ({}) } },
    '../core/wallet/pending-zcash-tx': { hasPendingZcashTxForWallet: async () => false },
    '@/config/rpc-failover': {},
    './passive-sync-policy': {},
    './sync-status-policy': { getVisibleSyncReason: () => null },
    '@/lib/errors': { isRpcEndpointError: () => false },
    '@/lib/keyed-task-coordinator': { KeyedTaskCoordinator }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  return new module.exports.SyncScheduler()
}

test('a paused partial scan releases its wallet without waiting for history I/O', async () => {
  const scanStarted = deferred()
  const scanDone = deferred()
  const historyNeverFinishes = deferred()
  let balanceRefreshes = 0
  let historyRefreshes = 0
  const scheduler = createScheduler(
    async () => {
      scanStarted.resolve()
      return scanDone.promise
    },
    async () => {
      balanceRefreshes++
    },
    async () => {
      historyRefreshes++
      return historyNeverFinishes.promise
    }
  )

  const task = scheduler.runSyncForWallet('wallet', 'account', 'requested')
  await scanStarted.promise
  scheduler.pauseForTx('wallet')
  scanDone.resolve({ status: 'partial' })
  const settled = await Promise.race([
    task.then(() => true),
    new Promise(resolve => setImmediate(() => resolve(false)))
  ])

  assert.equal(settled, true)
  assert.equal(scheduler.isWalletSyncActive('wallet'), false)
  assert.equal(balanceRefreshes, 0)
  assert.equal(historyRefreshes, 0)
})

test('a pause during balance refresh prevents later history I/O', async () => {
  const balanceStarted = deferred()
  const balanceDone = deferred()
  let historyRefreshes = 0
  let scheduler
  scheduler = createScheduler(
    async () => ({ status: 'completed' }),
    async () => {
      balanceStarted.resolve()
      await balanceDone.promise
    },
    async () => {
      historyRefreshes++
    }
  )

  const task = scheduler.runSyncForWallet('wallet', 'account', 'requested')
  await balanceStarted.promise
  scheduler.pauseForTx('wallet')
  balanceDone.resolve()
  await task

  assert.equal(scheduler.isWalletSyncActive('wallet'), false)
  assert.equal(historyRefreshes, 0)
})

test('a pause before the queued sync starts prevents wallet recovery work', async () => {
  let scanCalls = 0
  const scheduler = createScheduler(
    async () => {
      scanCalls++
      return { status: 'completed' }
    },
    async () => {},
    async () => {}
  )

  const task = scheduler.runSyncForWallet('wallet', 'account', 'requested')
  scheduler.pauseForTx('wallet')
  assert.equal(await task, 'skipped')
  assert.equal(scanCalls, 0)
  assert.equal(scheduler.isWalletSyncActive('wallet'), false)
})
