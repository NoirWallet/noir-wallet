import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { mapWasmAccountBalanceToZcashBalance } from '../src/core/wallet/balance-summary.ts'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function loadManager(dependencies) {
  const source = readFileSync(
    new URL('../src/core/wallet/account-manager.ts', import.meta.url),
    'utf8'
  )
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
  return module.exports.accountManager
}

function createHarness() {
  const balance = {
    shielded: '0',
    transparent: '0.002',
    total: '0.002',
    spendable: '0',
    available: '0',
    confirmed: { shielded: '0', transparent: '0' },
    pending: { shielded: '0', transparent: '0.002', total: '0.002' }
  }
  const wallet = { id: 'wallet', accounts: [{ id: 'account', derivationIndex: 0 }] }
  const walletState = {
    wallets: [wallet],
    currentWalletId: wallet.id,
    currentAccountId: 'account',
    setCurrentNetwork() {},
    getWallet: id => (id === wallet.id ? wallet : null),
    getAccount: (id, accountId) =>
      id === wallet.id ? (wallet.accounts.find(account => account.id === accountId) ?? null) : null
  }
  const accountData = {
    balances: new Map([['mainnet_wallet_account', balance]]),
    getWalletSyncState: () => ({ isSyncing: false, syncProgress: 0, currentHeight: 99 })
  }
  const events = []
  const manager = loadManager({
    '@/store/wallet-store': { useWalletStore: { getState: () => walletState } },
    '@/store/account-data-store': {
      useAccountDataStore: {
        getState: () => accountData,
        persist: {
          hasHydrated: () => false,
          async rehydrate() {
            events.push('rehydrate')
          }
        }
      },
      buildAccountKey: (network, walletId, accountId) => `${network}_${walletId}_${accountId}`
    },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/config/rpc-endpoints': { async ensureRpcEndpointPreferencesLoaded() {} },
    '@/config/rpc-failover': { async ensureRpcFailoverStateLoaded() {} },
    '@/lib/logger': {
      logger: {
        log() {},
        warn() {},
        error(error) {
          events.push(error)
        },
        async refreshCache() {}
      }
    },
    './balance-summary': { mapWasmAccountBalanceToZcashBalance }
  })
  return { manager, walletState, accountData, balance, events }
}

function createDeferredSummaryHarness() {
  const { manager, accountData, balance } = createHarness()
  let releaseSummary
  let signalSummaryStarted
  const summaryStarted = new Promise(resolve => {
    signalSummaryStarted = resolve
  })
  const summary = {
    fully_scanned_height: 99,
    chain_tip_height: 100,
    account_balances: [
      [
        7,
        {
          unshielded_balance: 200_000n,
          unshielded_total_balance: 200_000n,
          unshielded_pending_balance: 0n,
          spendable_balance: 200_000n,
          pending_balance: 0n,
          total_balance: 200_000n
        }
      ]
    ]
  }
  const core = {
    hasAccount: () => true,
    getWalletSummary() {
      signalSummaryStarted()
      return new Promise(resolve => {
        releaseSummary = () => resolve(summary)
      })
    },
    async getAccountHdIndex() {
      return 0
    }
  }
  manager.walletCores.set('wallet', core)
  manager.isWalletActivelySyncing = () => false
  manager.assertWasmAccountInvariant = async () => {}
  manager.setAccountMapping = () => {}
  manager.setBalanceFor = (_walletId, _accountId, next) => {
    accountData.balances.set('mainnet_wallet_account', next)
  }
  manager.broadcastSyncProgress = () => {}
  return {
    manager,
    accountData,
    balance,
    core,
    summaryStarted,
    releaseSummary: () => releaseSummary()
  }
}

test('initialization schedules a persisted summary refresh without awaiting WASM', async () => {
  const { manager, events } = createHarness()
  let initializeCore
  const core = {
    initialize: () =>
      new Promise(resolve => {
        initializeCore = resolve
      })
  }
  manager.getOrCreateWalletCore = () => core
  manager.refreshCachedBalancesAfterReady = async () => {
    events.push('refresh')
  }

  await manager.initialize()
  assert.deepStrictEqual(events, [])

  initializeCore()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepStrictEqual(events, ['rehydrate', 'refresh'])
})

test('restored account refreshes from local summary before network scanning', async () => {
  const { manager, accountData, balance, events } = createHarness()
  let restored = false
  let summary = {
    fully_scanned_height: 99,
    chain_tip_height: 100,
    account_balances: [
      [
        7,
        {
          unshielded_balance: 200_000n,
          unshielded_total_balance: 200_000n,
          unshielded_pending_balance: 0n,
          unshielded_shieldable_balance: 200_000n,
          spendable_balance: 200_000n,
          pending_balance: 0n,
          total_balance: 200_000n
        }
      ]
    ]
  }
  const core = {
    hasAccount: () => restored,
    async restoreFromDB(index) {
      assert.strictEqual(index, 0)
      events.push('restore')
      restored = true
      return true
    },
    async getWalletSummary() {
      events.push('summary')
      if (summary instanceof Error) throw summary
      return summary
    },
    async getAccountHdIndex(id) {
      assert.strictEqual(id, 7)
      return 0
    }
  }
  manager.walletCores.set('wallet', core)
  manager.isWalletActivelySyncing = () => false
  manager.assertWasmAccountInvariant = async () => {}
  manager.getCachedWalletSummary = async () => {
    throw new Error('network summary path must not run')
  }
  manager.setAccountMapping = () => {}
  manager.setBalanceFor = (_walletId, _accountId, next) => {
    events.push('balance')
    accountData.balances.set('mainnet_wallet_account', next)
  }
  manager.broadcastSyncProgress = () => {}

  await manager.refreshCachedBalancesAfterReady('wallet', 'account', core)
  assert.deepStrictEqual(events, ['restore', 'summary', 'balance'])
  assert.notStrictEqual(accountData.balances.get('mainnet_wallet_account'), balance)
  assert.deepStrictEqual(
    {
      total: accountData.balances.get('mainnet_wallet_account').total,
      available: accountData.balances.get('mainnet_wallet_account').available,
      confirmed: accountData.balances.get('mainnet_wallet_account').confirmed,
      pending: accountData.balances.get('mainnet_wallet_account').pending
    },
    {
      total: '0.002',
      available: '0.002',
      confirmed: { shielded: '0', transparent: '0.002' },
      pending: { shielded: '0', transparent: '0', total: '0' }
    }
  )

  for (const unavailable of [null, new Error('summary unavailable')]) {
    accountData.balances.set('mainnet_wallet_account', balance)
    events.length = 0
    summary = unavailable
    await manager.refreshCachedBalancesAfterReady('wallet', 'account', core)
    assert.strictEqual(accountData.balances.get('mainnet_wallet_account'), balance)
    assert.deepStrictEqual(events.slice(0, 1), ['summary'])
    assert.ok(!events.includes('balance'))
  }

  accountData.balances.set('mainnet_wallet_account', balance)
  restored = false
  events.length = 0
  core.restoreFromDB = async () => {
    restored = true
    manager.walletCores.set('wallet', {})
    return true
  }
  await manager.refreshCachedBalancesAfterReady('wallet', 'account', core)
  assert.deepStrictEqual(events, [])
  assert.strictEqual(accountData.balances.get('mainnet_wallet_account'), balance)

  accountData.balances.clear()
  events.length = 0
  await manager.refreshCachedBalancesAfterReady('wallet', 'account', core)
  assert.deepStrictEqual(events, [])
})

test('local summary cannot overwrite a balance after a sync starts and finishes', async () => {
  const fixture = createDeferredSummaryHarness()
  const { manager, accountData, core, summaryStarted } = fixture
  const refresh = manager.refreshCachedBalancesAfterReady('wallet', 'account', core)
  await summaryStarted

  const newerBalance = { total: '0.003', available: '0.003' }
  accountData.balances.set('mainnet_wallet_account', newerBalance)
  manager.activeSyncWalletIds.add('wallet')
  manager.walletRuntimeGeneration.set('wallet', 1)
  manager.activeSyncWalletIds.delete('wallet')
  fixture.releaseSummary()
  await refresh

  assert.strictEqual(accountData.balances.get('mainnet_wallet_account'), newerBalance)
})

test('local summary cannot write after its wallet core or preflight changes', async () => {
  for (const change of ['core', 'preflight']) {
    const fixture = createDeferredSummaryHarness()
    const { manager, accountData, balance, core, summaryStarted } = fixture
    manager.syncPreflightWalletIds.set('wallet', 1)
    manager.nextSyncPreflightId = 1
    manager.isWalletActivelySyncing = () => true
    const refresh = manager.refreshCachedBalancesAfterReady('wallet', 'account', core, true)
    await summaryStarted

    if (change === 'core') {
      manager.walletCores.set('wallet', {})
    } else {
      manager.syncPreflightWalletIds.set('wallet', 2)
      manager.nextSyncPreflightId = 2
    }
    fixture.releaseSummary()
    await refresh

    assert.strictEqual(accountData.balances.get('mainnet_wallet_account'), balance)
  }
})

test('own readiness preflight can refresh despite another wallet starting preflight', async () => {
  const fixture = createDeferredSummaryHarness()
  const { manager, accountData, core, summaryStarted } = fixture
  manager.syncPreflightWalletIds.set('wallet', 1)
  manager.walletRuntimeGeneration.set('wallet', 1)
  manager.isWalletActivelySyncing = () => true
  const refresh = manager.refreshCachedBalancesAfterReady('wallet', 'account', core, true)
  await summaryStarted

  manager.syncPreflightWalletIds.set('other-wallet', 2)
  manager.walletRuntimeGeneration.set('other-wallet', 1)
  fixture.releaseSummary()
  await refresh

  assert.strictEqual(accountData.balances.get('mainnet_wallet_account').available, '0.002')
})
