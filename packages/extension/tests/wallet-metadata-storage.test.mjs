import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as metadata from '../src/lib/wallet-metadata-storage.ts'
import { createChromeStorageAdapter } from '../src/lib/chrome-storage-adapter.ts'

const require = createRequire(import.meta.url)
const ts = require('typescript')

function loadStore() {
  const { outputText } = ts.transpileModule(
    readFileSync(new URL('../src/store/wallet-store.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  )
  const dependencies = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/lib/chrome-storage-adapter': { createChromeStorageAdapter },
    '@/lib/wallet-metadata-storage': metadata,
    '@/core/services/lending-home-cache': { clearLendingHomeCache: async () => {} }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    name => dependencies[name] ?? {},
    module,
    module.exports
  )
  return module.exports
}

function harness(t) {
  const previousChrome = globalThis.chrome
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const queues = new Map()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(name, callback) {
          const result = (queues.get(name) ?? Promise.resolve()).then(callback)
          queues.set(
            name,
            result.catch(() => {})
          )
          return result
        }
      }
    }
  })
  t.after(() => {
    globalThis.chrome = previousChrome
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  })
  const wallet = id => ({
    id,
    name: 'Keystone',
    keySource: 'keystone',
    seedPhraseKey: '',
    accounts: [{ id: `${id}-account`, name: 'Keystone', derivationIndex: 0 }]
  })
  const snapshot = {
    version: 0,
    state: {
      wallets: [wallet('removed'), wallet('retained')],
      currentWalletId: 'removed',
      currentAccountId: 'removed-account',
      currentNetwork: 'mainnet',
      zecPrice: 0,
      accountDisplayNames: { 'removed_removed-account': 'Old', 'retained_retained-account': 'Keep' }
    }
  }
  const values = new Map([
    ['wallet_state', structuredClone(snapshot)],
    ['hw_removed', 'synthetic-encrypted-record'],
    ['hw_retained', 'synthetic-encrypted-record']
  ])
  let beforeWrite = async () => {}
  let failRead = false
  const area = {
    async get(keys) {
      if (failRead) throw new Error('read unavailable')
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .filter(key => values.has(key))
          .map(key => [key, structuredClone(values.get(key))])
      )
    },
    async set(data) {
      await beforeWrite()
      for (const [key, value] of Object.entries(data)) values.set(key, structuredClone(value))
    },
    async remove(key) {
      values.delete(key)
    }
  }
  globalThis.chrome = { storage: { local: area } }
  return {
    values,
    snapshot,
    area,
    beforeWrite(callback) {
      beforeWrite = callback
    },
    failRead() {
      failRead = true
    }
  }
}

test('stale hardware tab writes cannot restore a removed duplicate or its selection', async t => {
  const { values } = harness(t)
  const popup = loadStore()
  const hardwareTab = loadStore()
  await Promise.all([popup.waitForHydration(), hardwareTab.waitForHydration()])
  await popup.useWalletStore.getState().removeWallet('removed')
  await hardwareTab.useWalletStore.getState().setZecPrice(42)
  await popup.rehydrateWalletStore()
  await hardwareTab.rehydrateWalletStore()
  for (const context of [popup, hardwareTab]) {
    const state = context.useWalletStore.getState()
    assert.deepEqual(
      state.wallets.map(wallet => wallet.id),
      ['retained']
    )
    assert.equal(state.currentWalletId, 'retained')
    assert.equal(state.currentAccountId, 'retained-account')
    assert.deepEqual(state.accountDisplayNames, { 'retained_retained-account': 'Keep' })
  }
  assert.equal(values.get('hw_retained'), 'synthetic-encrypted-record')
})

test('stale metadata writes cannot restore a deleted account or its selection', async t => {
  const { area, snapshot } = harness(t)
  await metadata.setAccountDeleted('mainnet_removed_removed-account', true)
  await metadata.writeWalletMetadata(area, snapshot)
  const current = await metadata.readWalletMetadata(area)
  assert.deepEqual(current.state.wallets.find(wallet => wallet.id === 'removed').accounts, [])
  assert.equal(current.state.currentWalletId, 'retained')
  assert.equal(current.state.currentAccountId, 'retained-account')
  assert.deepEqual(current.state.accountDisplayNames, {
    'retained_retained-account': 'Keep'
  })
})

test('deletion waits for an older in-flight write and blocks later stale writes', async t => {
  const h = harness(t)
  let entered
  const started = new Promise(resolve => {
    entered = resolve
  })
  let release
  const held = new Promise(resolve => {
    release = resolve
  })
  h.beforeWrite(async () => {
    entered()
    await held
  })
  const olderWrite = metadata.writeWalletMetadata(h.area, h.snapshot)
  await started
  const removal = metadata.removeWalletMetadata('removed')
  const laterWrite = metadata.writeWalletMetadata(h.area, h.snapshot)
  release()
  await Promise.all([olderWrite, removal, laterWrite])
  assert.deepEqual(
    h.values.get('wallet_state').state.wallets.map(w => w.id),
    ['retained']
  )
  assert.deepEqual(h.values.get('wallet_deleted_ids'), ['removed'])
})

test('failed deletion leaves metadata and credentials intact and can be retried', async t => {
  const h = harness(t)
  const popup = loadStore()
  await popup.waitForHydration()
  h.beforeWrite(async () => {
    throw new Error('storage unavailable')
  })
  await assert.rejects(
    popup.useWalletStore.getState().removeWallet('removed'),
    /storage unavailable/
  )
  assert.equal(popup.useWalletStore.getState().wallets.length, 2)
  assert.equal(h.values.get('wallet_state').state.wallets.length, 2)
  assert.equal(h.values.has('wallet_deleted_ids'), false)
  assert.equal(h.values.has('hw_removed'), true)
  h.beforeWrite(async () => {})
  await popup.useWalletStore.getState().removeWallet('removed')
  assert.equal(popup.useWalletStore.getState().wallets.length, 1)
})

test('deletion records survive reloads and reject an independently restored old snapshot', async t => {
  const h = harness(t)
  await metadata.removeWalletMetadata('removed')
  h.values.set('wallet_state', structuredClone(h.snapshot))
  const restarted = loadStore()
  await restarted.waitForHydration()
  assert.deepEqual(
    restarted.useWalletStore.getState().wallets.map(w => w.id),
    ['retained']
  )
})

test('reset prevents any formerly live context from restoring its wallet list', async t => {
  const h = harness(t)
  const popup = loadStore()
  await popup.waitForHydration()
  await popup.useWalletStore.getState().reset()
  await metadata.writeWalletMetadata(h.area, h.snapshot)
  const saved = await metadata.readWalletMetadata(h.area)
  assert.deepEqual(saved.state.wallets, [])
  assert.equal(saved.state.currentWalletId, null)
  assert.equal(saved.state.currentAccountId, null)
})

test('unreadable deletion records and storage failures do not silently authorize writes', async t => {
  const h = harness(t)
  h.values.set('wallet_deleted_ids', 'corrupt')
  await assert.rejects(metadata.writeWalletMetadata(h.area, h.snapshot), /deletion records/)
  assert.deepEqual(h.values.get('wallet_state'), h.snapshot)
  h.failRead()
  await assert.rejects(createChromeStorageAdapter().getItem('wallet_state'), /read unavailable/)
})

test('failed wallet refresh rejects instead of using previously hydrated metadata', async t => {
  const h = harness(t)
  const popup = loadStore()
  await popup.waitForHydration()
  h.failRead()
  await assert.rejects(popup.rehydrateWalletStore(), /could not be loaded/)
})

test('failed initial hydration rejects instead of waiting for a success-only event', async t => {
  const h = harness(t)
  h.failRead()
  const popup = loadStore()
  await assert.rejects(popup.waitForHydration(), /could not be loaded/)
})

test('selection commits before it reports success and a following refresh sees the write', async t => {
  const h = harness(t)
  const popup = loadStore()
  await popup.waitForHydration()
  let release
  const held = new Promise(resolve => {
    release = resolve
  })
  let entered
  const writing = new Promise(resolve => {
    entered = resolve
  })
  h.beforeWrite(async () => {
    entered()
    await held
  })
  let finished = false
  const selection = popup.useWalletStore
    .getState()
    .setCurrentAccount('retained', 'retained-account')
    .then(() => {
      finished = true
    })
  await writing
  const refresh = popup.rehydrateWalletStore()
  assert.equal(finished, false)
  assert.equal(h.values.get('wallet_state').state.currentWalletId, 'removed')
  release()
  await Promise.all([selection, refresh])
  assert.equal(finished, true)
  assert.equal(popup.useWalletStore.getState().currentWalletId, 'retained')
})
