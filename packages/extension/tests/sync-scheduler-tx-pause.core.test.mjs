import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

function createScheduler(overrides = {}) {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/background/sync-scheduler.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  )
  const runtime = {
    ensureWalletReadyForSync: async () => true,
    waitForWalletReady: async () => true,
    syncBlocks: async () => ({ status: 'completed' }),
    refreshBalances: async () => {},
    refreshWalletTransactionHistoriesFromWasm: async () => {},
    getNetwork: () => 'testnet',
    isWalletSyncing: () => false,
    ...overrides.runtime
  }
  const noop = () => {}
  const dependencies = {
    './zcash-wallet-runtime': { backgroundZcashWalletRuntime: runtime },
    '@/lib/logger': { logger: { log: noop, warn: noop, error: noop } },
    '@/lib/sync-abort': {
      clearSyncAbort: overrides.clearSyncAbort ?? (async () => {}),
      signalSyncAbort: async () => {}
    },
    '@/config/wallet': { WALLET_CONFIG: { SYNC: { INIT_READY_TIMEOUT_MS: 1000 } } },
    '@/store/wallet-store': { useWalletStore: { getState: () => ({ currentWalletId: 'wallet' }) } },
    '../core/wallet/pending-zcash-tx': {
      hasPendingZcashTxForWallet: overrides.hasPendingZcashTxForWallet ?? (async () => false)
    },
    '@/core/zcash/wallet-core': { isRetryableWalletRpcError: () => false },
    '@/lib/errors': { isRpcEndpointError: () => false }
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
  const started = deferred()
  const done = deferred()
  let balanceRefreshes = 0
  let historyRefreshes = 0
  const scheduler = createScheduler({
    runtime: {
      syncBlocks: async () => {
        started.resolve()
        return done.promise
      },
      refreshBalances: async () => balanceRefreshes++,
      refreshWalletTransactionHistoriesFromWasm: async () => {
        historyRefreshes++
        return new Promise(() => {})
      }
    }
  })
  const task = scheduler.runSyncForWallet('wallet', 'account')
  await started.promise
  scheduler.pauseForTx()
  done.resolve({ status: 'partial' })
  assert.equal(
    await Promise.race([task, new Promise(resolve => setImmediate(() => resolve('blocked')))]),
    'partial'
  )
  assert.equal(await scheduler.waitForWalletSyncIdle('wallet', 100), true)
  assert.equal(balanceRefreshes, 0)
  assert.equal(historyRefreshes, 0)
  let retriggers = 0
  scheduler.scheduleRun = () => retriggers++
  scheduler.resumeAfterTx()
  assert.equal(retriggers, 1)
})

test('a pause during balance refresh prevents later history I/O', async () => {
  const started = deferred()
  const done = deferred()
  let historyRefreshes = 0
  const scheduler = createScheduler({
    runtime: {
      refreshBalances: async () => {
        started.resolve()
        await done.promise
      },
      refreshWalletTransactionHistoriesFromWasm: async () => historyRefreshes++
    }
  })
  const task = scheduler.runSyncForWallet('wallet', 'account')
  await started.promise
  scheduler.pauseForTx()
  done.resolve()
  assert.equal(await task, 'completed')
  assert.equal(historyRefreshes, 0)
  assert.equal(await scheduler.waitForWalletSyncIdle('wallet', 100), true)
})

test('an already paused scan preserves its abort marker and never starts recovery', async () => {
  let abortClears = 0
  let recoveries = 0
  const scheduler = createScheduler({
    clearSyncAbort: async () => abortClears++,
    runtime: { ensureWalletReadyForSync: async () => recoveries++ }
  })
  scheduler.pauseForTx()
  assert.equal(await scheduler.runSyncForWallet('wallet', 'account'), 'skipped')
  assert.equal(abortClears, 0)
  assert.equal(recoveries, 0)
})

for (const stage of [
  'clearSyncAbort',
  'ensureWalletReadyForSync',
  'waitForWalletReady',
  'hasPendingZcashTxForWallet'
]) {
  test(`a pause while awaiting ${stage} prevents a later scan`, async () => {
    const started = deferred()
    const done = deferred()
    let scans = 0
    const blockedStage = async () => {
      started.resolve()
      await done.promise
      return true
    }
    const scheduler = createScheduler({
      ...(stage === 'clearSyncAbort' ? { clearSyncAbort: blockedStage } : {}),
      ...(stage === 'hasPendingZcashTxForWallet'
        ? { hasPendingZcashTxForWallet: blockedStage }
        : {}),
      runtime: {
        ...(['ensureWalletReadyForSync', 'waitForWalletReady'].includes(stage)
          ? { [stage]: blockedStage }
          : {}),
        syncBlocks: async () => {
          scans++
          return { status: 'completed' }
        }
      }
    })
    const task = scheduler.runSyncForWallet('wallet', 'account')
    await started.promise
    scheduler.pauseForTx()
    done.resolve()
    assert.equal(await task, 'skipped')
    assert.equal(scans, 0)
    assert.equal(await scheduler.waitForWalletSyncIdle('wallet', 100), true)
  })
}
