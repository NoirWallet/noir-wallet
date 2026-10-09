import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { decideMonitorSignal, isExpiredAtTip } from '../src/background/tx-monitor-policy.ts'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function loadMonitor(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022
    }
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  return module.exports
}

function transactionRecord(overrides) {
  return {
    id: 'tx_local',
    txHash: 'hash-local',
    type: 'send',
    status: 'pending',
    amount: '1',
    timestamp: Date.now(),
    ...overrides
  }
}

function decide(overrides) {
  return decideMonitorSignal({
    lookup: { status: 'mempool' },
    minConfirmations: 2,
    expired: false,
    elapsedMs: 0,
    timeoutMs: 1000,
    hasNode: true,
    confirmedInDb: false,
    ...overrides
  })
}

test('isExpiredAtTip requires tip and expiry past the buffer', () => {
  assert.equal(isExpiredAtTip(null, 100, 5), false)
  assert.equal(isExpiredAtTip(200, undefined, 5), false)
  assert.equal(isExpiredAtTip(104, 100, 5), false)
  assert.equal(isExpiredAtTip(105, 100, 5), true)
  assert.equal(isExpiredAtTip(110, 100, 5), true)
})

test('confirms once confirmations reach the minimum', () => {
  assert.equal(decide({ lookup: { status: 'confirmed', confirmations: 3 } }), 'confirm')
  assert.equal(decide({ lookup: { status: 'confirmed', confirmations: 2 } }), 'confirm')
})

test('a mined-but-immature tx keeps waiting even past the timeout', () => {
  assert.equal(
    decide({ lookup: { status: 'confirmed', confirmations: 1 }, elapsedMs: 999999 }),
    'wait'
  )
})

test('an authoritative notfound past expiry expires fast', () => {
  assert.equal(decide({ lookup: { status: 'notfound' }, expired: true }), 'expire')
})

test('a notfound within its expiry window and timeout keeps waiting', () => {
  assert.equal(decide({ lookup: { status: 'notfound' }, elapsedMs: 500 }), 'wait')
})

test('a notfound past the timeout fails as timeout', () => {
  assert.equal(decide({ lookup: { status: 'notfound' }, elapsedMs: 2000 }), 'timeout')
})

test('a transient node error never fails a live tx, even past the timeout', () => {
  assert.equal(decide({ lookup: { status: 'error' }, elapsedMs: 2000 }), 'wait')
})

test('a mempool tx keeps waiting past the timeout while the node is reachable', () => {
  assert.equal(decide({ lookup: { status: 'mempool' }, elapsedMs: 2000 }), 'wait')
})

test('clears a tx already confirmed in the local DB past the timeout', () => {
  assert.equal(decide({ elapsedMs: 2000, confirmedInDb: true }), 'clear')
})

test('with no node configured the wall-clock timeout is the only failure signal', () => {
  assert.equal(decide({ hasNode: false, lookup: { status: 'error' }, elapsedMs: 2000 }), 'timeout')
  assert.equal(decide({ hasNode: false, lookup: { status: 'error' }, elapsedMs: 500 }), 'wait')
})

test('restart restores hashed unfinished and failed standalone Zcash transactions', async t => {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })
  const persisted = {}
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...persisted }),
        set: async update => Object.assign(persisted, update)
      }
    },
    alarms: { create() {}, clear() {} }
  }
  const accountKey = 'mainnet_wallet_account'
  const records = [
    transactionRecord({ id: 'tx_send', txHash: 'send-hash' }),
    transactionRecord({
      id: 'tx_shield',
      type: 'shield',
      txHash: 'shield-hash',
      status: 'confirming'
    }),
    transactionRecord({ id: 'tx_supply', type: 'supply', txHash: 'supply-hash' }),
    transactionRecord({ id: 'tx_swap', type: 'swap', txHash: 'swap-hash' }),
    transactionRecord({ id: 'tx_failed_send', txHash: 'failed-send-hash', status: 'failed' }),
    transactionRecord({
      id: 'tx_failed_shield',
      type: 'shield',
      txHash: 'failed-shield-hash',
      status: 'failed'
    }),
    transactionRecord({
      id: 'tx_failed_receive',
      type: 'receive',
      txHash: 'failed-receive-hash',
      status: 'failed'
    }),
    transactionRecord({ id: 'tx_failed_supply', type: 'supply', status: 'failed' }),
    transactionRecord({ id: 'tx_failed_unbroadcast', txHash: '', status: 'failed' }),
    transactionRecord({ id: 'tx_no_hash', txHash: '' }),
    transactionRecord({ id: 'tx_done', txHash: 'done-hash', status: 'success' }),
    transactionRecord({ id: 'wasm_row', txHash: 'wasm-hash' })
  ]
  const { ZcashTxMonitor } = loadMonitor('../src/background/zcash-tx-monitor.ts', {
    '@/config/wallet': {
      WALLET_CONFIG: {
        ZCASH_TX_MONITOR: {
          TX_MONITOR_POLL_MS: 30_000,
          TIMEOUT_MS: 60_000,
          EXPIRY_BUFFER_BLOCKS: 5
        }
      }
    },
    '@/lib/indexed-db': { loadTransactions: async () => records }
  })
  const monitor = new ZcashTxMonitor()
  await monitor.restoreStuckWithdrawals([accountKey])
  const restored = persisted.pending_zcash_transactions
  assert.deepEqual(
    restored.map(entry => entry.txHash).sort(),
    [
      'send-hash',
      'shield-hash',
      'supply-hash',
      'swap-hash',
      'failed-send-hash',
      'failed-shield-hash',
      'failed-receive-hash'
    ].sort()
  )
  assert.ok(restored.every(entry => entry.accountKey === accountKey))
  await monitor.restoreStuckWithdrawals([accountKey])
  assert.equal(persisted.pending_zcash_transactions.length, 7)
})

function recoveryMonitor(t, record, lookups) {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })
  const accountKey = 'mainnet_wallet_account'
  const records = [record]
  const persisted = {}
  const updates = []
  const notifications = []
  let lookupCount = 0
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...persisted }),
        set: async update => Object.assign(persisted, update)
      }
    },
    alarms: { create() {}, clear() {} },
    runtime: { getURL: path => path, sendMessage: async message => notifications.push(message) },
    notifications: { create: () => {} }
  }
  const { ZcashTxMonitor } = loadMonitor('../src/background/zcash-tx-monitor.ts', {
    '@/config/wallet': {
      WALLET_CONFIG: {
        ZCASH_TX_MONITOR: {
          TX_MONITOR_POLL_MS: 30_000,
          TIMEOUT_MS: 60_000,
          EXPIRY_BUFFER_BLOCKS: 5
        }
      }
    },
    '@/config/networks': { getNetworkConfig: () => ({ nodeRpcUrl: 'https://rpc.example' }) },
    '@/lib/zcash-node-rpc': {
      lookupTransaction: async () => lookups[Math.min(lookupCount++, lookups.length - 1)]
    },
    '@/lib/indexed-db': { loadTransactions: async () => records },
    '@/lib/transaction-status': {
      getRequiredConfirmations: type => (type === 'receive' ? 10 : 2)
    },
    './transaction-recorder': {
      transactionRecorder: {
        updateTerminalTransaction: async (key, id, update, confirmation) => {
          updates.push({ key, id, update, confirmation })
          if (confirmation && (!record.txHash || confirmation.txHash === record.txHash)) {
            record.status = update.status
            record.txHash ||= confirmation.txHash
          }
          return { found: true, shouldNotify: false, statusMatches: true }
        }
      }
    },
    '@/lib/transaction-status-copy': {
      getZcashConfirmationNotificationCopy: () => ({ title: 'Confirmed', message: 'Confirmed' })
    }
  })
  return {
    monitor: new ZcashTxMonitor(),
    accountKey,
    persisted,
    updates,
    notifications,
    get lookupCount() {
      return lookupCount
    }
  }
}

test('historical failed shield recovers only after matching RPC confirmation', async t => {
  const record = transactionRecord({
    type: 'shield',
    status: 'failed',
    txHash: 'shield-hash',
    failureReason: 'timeout'
  })
  const harness = recoveryMonitor(t, record, [
    { status: 'confirmed', confirmations: 1 },
    { status: 'confirmed', confirmations: 3 }
  ])
  await harness.monitor.restoreStuckWithdrawals([harness.accountKey])
  await harness.monitor.recheckNow()
  assert.equal(record.status, 'failed')
  assert.equal(harness.updates.length, 0)
  assert.equal(harness.persisted.pending_zcash_transactions.length, 1)

  await harness.monitor.recheckNow()
  assert.equal(record.status, 'success')
  assert.deepEqual(harness.updates[0].confirmation, {
    txHash: 'shield-hash',
    confirmations: 3
  })
  assert.deepEqual(harness.persisted.pending_zcash_transactions, [])
  await harness.monitor.recheckNow()
  assert.equal(harness.updates.length, 1)
})

test('failed send remains failed on RPC error or notfound and can be checked again', async t => {
  const record = transactionRecord({ status: 'failed', txHash: 'send-hash' })
  const harness = recoveryMonitor(t, record, [{ status: 'error' }, { status: 'notfound' }])
  await harness.monitor.restoreStuckWithdrawals([harness.accountKey])
  await harness.monitor.recheckNow()
  assert.equal(record.status, 'failed')
  assert.deepEqual(harness.persisted.pending_zcash_transactions, [])

  await harness.monitor.restoreStuckWithdrawals([harness.accountKey])
  await harness.monitor.recheckNow()
  assert.equal(record.status, 'failed')
  assert.equal(harness.lookupCount, 2)
  assert.equal(harness.updates.length, 0)
})

test('existing broadcast monitor can recover a failed record missing its hash', async t => {
  const record = transactionRecord({ status: 'failed', txHash: '' })
  const harness = recoveryMonitor(t, record, [{ status: 'confirmed', confirmations: 3 }])
  harness.monitor.pendingTxs.set('broadcast-hash', {
    txHash: 'broadcast-hash',
    accountKey: harness.accountKey,
    transactionId: record.id,
    type: record.type,
    startTime: record.timestamp
  })
  await harness.monitor.recheckNow()
  assert.equal(record.status, 'success')
  assert.equal(record.txHash, 'broadcast-hash')
  assert.deepEqual(harness.updates[0].confirmation, {
    txHash: 'broadcast-hash',
    confirmations: 3
  })
})

test('pending failed notification is retried after an inconclusive lookup', async t => {
  const record = transactionRecord({ status: 'failed', txHash: 'send-hash' })
  const harness = recoveryMonitor(t, record, [{ status: 'error' }])
  harness.monitor.pendingTxs.set(record.txHash, {
    txHash: record.txHash,
    accountKey: harness.accountKey,
    transactionId: record.id,
    type: record.type,
    startTime: record.timestamp,
    notificationPending: true
  })
  await harness.monitor.recheckNow()
  assert.equal(harness.updates[0].update.status, 'failed')
  assert.equal(harness.notifications[0].status, 'failed')
  assert.deepEqual(harness.persisted.pending_zcash_transactions, [])
})

test('failed cross-chain transaction is not recovered by its origin Zcash hash', async t => {
  const record = transactionRecord({ type: 'supply', status: 'failed', txHash: 'origin-hash' })
  const harness = recoveryMonitor(t, record, [{ status: 'confirmed', confirmations: 10 }])
  await harness.monitor.restoreStuckWithdrawals([harness.accountKey])
  assert.equal(harness.persisted.pending_zcash_transactions, undefined)

  harness.monitor.pendingTxs.set(record.txHash, {
    txHash: record.txHash,
    accountKey: harness.accountKey,
    transactionId: record.id,
    type: record.type,
    startTime: record.timestamp
  })
  await harness.monitor.recheckNow()
  assert.equal(record.status, 'failed')
  assert.equal(harness.lookupCount, 0)
  assert.equal(harness.updates.length, 0)
})

test('serialized storage read cannot restore a removed notification task', async t => {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })
  const entry = {
    txHash: 'hash',
    accountKey: 'mainnet_wallet_account',
    transactionId: 'tx_local',
    startTime: 1,
    notificationPending: true
  }
  let releaseRead
  const readGate = new Promise(resolve => {
    releaseRead = resolve
  })
  let persisted = [entry]
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => {
          const snapshot = [...persisted]
          await readGate
          return { pending_zcash_transactions: snapshot }
        },
        set: async update => {
          persisted = update.pending_zcash_transactions
        }
      }
    }
  }
  const { ZcashTxMonitor } = loadMonitor('../src/background/zcash-tx-monitor.ts', {
    '@/config/wallet': {
      WALLET_CONFIG: {
        ZCASH_TX_MONITOR: {
          TX_MONITOR_POLL_MS: 30_000,
          TIMEOUT_MS: 60_000,
          EXPIRY_BUFFER_BLOCKS: 5
        }
      }
    }
  })
  const monitor = new ZcashTxMonitor()
  const read = monitor.loadFromStorage()
  const removal = monitor.removePersistedTask(entry)
  releaseRead()
  await Promise.all([read, removal])
  assert.equal(monitor.pendingTxs.size, 0)
  assert.deepEqual(persisted, [])
})

test('failed Intents completion save retains the task for another poll', async t => {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })
  let failSave = true
  let scheduled = 0
  let notifications = 0
  globalThis.chrome = {
    storage: {
      local: {
        set: async () => {
          if (failSave) throw new Error('storage unavailable')
        }
      }
    },
    alarms: {
      create() {
        scheduled++
      },
      clear() {}
    },
    runtime: { sendMessage: async () => {} }
  }
  const entry = {
    depositAddress: 'deposit',
    accountKey: 'mainnet_wallet_account',
    transactionId: 'tx_local',
    kind: 'withdraw',
    status: 'PENDING',
    amountIn: '1',
    amountOut: '1',
    tokenInSymbol: 'ZEC',
    tokenOutSymbol: 'ZEC'
  }
  const { TransactionMonitor } = loadMonitor('../src/background/transaction-monitor.ts', {
    '@/lib/intents-progress': {
      INTENTS_PROGRESS_STORAGE_KEY: 'pending_transactions',
      needsZcashDestinationConfirmations: () => false,
      shouldAutoRefreshIntentsProgress: () => true
    },
    '@/lib/indexed-db': {
      loadTransactions: async () => [transactionRecord({ id: 'tx_local', type: 'withdraw' })]
    },
    './transaction-recorder': { transactionRecorder: { updateTransaction: async () => {} } },
    '@/lib/logger': { logger: { log() {} } },
    '@/lib/analytics': { ANALYTICS_EVENTS: { SWAP_COMPLETED: 'swap' }, trackEvent() {} },
    '@/lib/transaction-status-copy': { getIntentsStatusCopy: () => ({ notification: null }) }
  })
  const monitor = new TransactionMonitor()
  monitor.pendingTransactions.set(entry.depositAddress, entry)
  await assert.rejects(monitor.handleCompletion(entry, { status: 'FAILED' }), /storage unavailable/)
  assert.equal(monitor.pendingTransactions.get(entry.depositAddress), entry)
  assert.equal(scheduled, 1)
  failSave = false
  monitor.notifyCompletion = () => {
    notifications++
  }
  await monitor.handleCompletion(entry, { status: 'FAILED' })
  assert.equal(monitor.pendingTransactions.has(entry.depositAddress), false)
  assert.equal(notifications, 1)
})
