import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function createSchedulerHarness() {
  const source = readFileSync(
    new URL('../src/background/sync-scheduler.ts', import.meta.url),
    'utf8'
  )
  const { outputText } = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022
    }
  })
  let quarantine = null
  let hasSession = true
  let initializationCount = 0
  const syncStates = []
  const messages = []
  const runtime = {
    getNetwork: () => 'mainnet',
    finishSyncPreflight: () => {},
    initialize: async () => {
      initializationCount++
    },
    isLocked: () => true
  }
  const dependencies = {
    './zcash-wallet-runtime': { backgroundZcashWalletRuntime: runtime },
    '@/lib/indexed-db': { getWalletPersistenceQuarantine: async () => quarantine },
    '@/store/wallet-store': {
      prepareWalletStoreForUse: async () => {},
      useWalletStore: { getState: () => ({ currentWalletId: 'wallet-a' }) }
    },
    '@/store/account-data-store': {
      useAccountDataStore: {
        getState: () => ({
          setWalletSyncStateFor: (_network, _walletId, state) => syncStates.push(state)
        })
      }
    },
    './credential-session': { credentialSession: { hasUnlockSession: async () => hasSession } }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  globalThis.chrome = {
    alarms: { create: () => {}, clear: () => {} },
    runtime: { sendMessage: async message => messages.push(message) }
  }
  return {
    scheduler: new module.exports.SyncScheduler(),
    setQuarantine: value => {
      quarantine = value
    },
    setSessionActive: value => {
      hasSession = value
    },
    getInitializationCount: () => initializationCount,
    syncStates,
    messages
  }
}

test('quarantined wallet stays idle until explicit recovery removes its marker', async () => {
  const harness = createSchedulerHarness()
  harness.setQuarantine({ snapshotQuarantined: false, journalQuarantined: true })

  await harness.scheduler.run()
  await harness.scheduler.run()
  harness.setQuarantine({ snapshotQuarantined: true, journalQuarantined: false })
  await harness.scheduler.run()
  assert.equal(harness.getInitializationCount(), 0)
  assert.equal(harness.scheduler.getSyncState('wallet-a').isSyncing, false)
  assert.equal(harness.syncStates.at(-1).syncReason, 'wallet_state_error')
  assert.equal(harness.syncStates.at(-1).isSyncing, false)
  assert.equal(harness.messages.at(-1).syncReason, 'wallet_state_error')

  harness.setQuarantine(null)
  harness.setSessionActive(false)
  await harness.scheduler.run()
  assert.equal(harness.getInitializationCount(), 1)
})

test('another confirmed transaction during catch-up triggers a subsequent wallet scan', async () => {
  const { scheduler } = createSchedulerHarness()
  let startFirstScan
  let finishFirstScan
  const firstStarted = new Promise(resolve => {
    startFirstScan = resolve
  })
  const firstFinished = new Promise(resolve => {
    finishFirstScan = resolve
  })
  let scans = 0
  scheduler.runSyncForWallet = async () => {
    scans++
    if (scans === 1) {
      startFirstScan()
      await firstFinished
    }
    return 'completed'
  }

  const first = scheduler.runTransactionCatchUp('wallet-a', 'account-a')
  await firstStarted
  const second = scheduler.runTransactionCatchUp('wallet-a', 'account-a')
  finishFirstScan()
  assert.deepEqual(await Promise.all([first, second]), ['completed', 'completed'])
  assert.equal(scans, 2)
})
