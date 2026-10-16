import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function createScheduler() {
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
  const selected = { currentWalletId: 'wallet-a', currentAccountId: 'account-a' }
  const balances = new Map([
    ['mainnet_wallet-a_account-a', { total: '0' }],
    ['mainnet_wallet-a_account-b', { total: '9' }],
    ['mainnet_wallet-b_account-a', { total: '6' }],
    ['testnet_wallet-a_account-a', { total: '5' }]
  ])
  const runtime = { getNetwork: () => 'mainnet' }
  const dependencies = {
    './zcash-wallet-runtime': { backgroundZcashWalletRuntime: runtime },
    '@/store/wallet-store': { useWalletStore: { getState: () => selected } },
    '@/store/account-data-store': {
      useAccountDataStore: {
        getState: () => ({
          getBalance: (network, walletId, accountId) =>
            balances.get(`${network}_${walletId}_${accountId}`) ?? null
        })
      }
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  return { scheduler: new module.exports.SyncScheduler(), selected }
}

test('sync snapshot reads the current background balance for the requested account and network', () => {
  const { scheduler, selected } = createScheduler()
  scheduler.applySyncProgressMessage({
    walletId: 'wallet-a',
    isSyncing: true,
    balance: { total: '9' }
  })

  assert.equal(scheduler.getSyncState('wallet-a', 'account-a').balance.total, '0')
  assert.equal(scheduler.getSyncState('wallet-a', 'account-b').balance.total, '9')
  assert.equal(scheduler.getSyncState('wallet-b', 'account-a').balance.total, '6')
  assert.equal(scheduler.getSyncState('wallet-a', 'missing').balance, null)
  assert.equal(scheduler.getSyncState().balance.total, '0')

  selected.currentAccountId = null
  assert.equal('balance' in scheduler.getSyncState(), false)
})
