import test from 'node:test'
import assert from 'node:assert/strict'
import { createChromeStorageAdapter } from '../src/lib/chrome-storage-adapter.ts'
import {
  setWalletCleanupPending,
  setAccountDeleted,
  removeWalletMetadata
} from '../src/lib/wallet-metadata-storage.ts'

function harness(t) {
  const previousChrome = globalThis.chrome
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let queue = Promise.resolve()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(_name, callback) {
          const result = queue.then(callback)
          queue = result.catch(() => {})
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
  const metadata = {
    state: {
      wallets: [
        { id: 'w', accounts: [{ id: 'a' }, { id: 'b' }] },
        { id: 'keep', accounts: [{ id: 'c' }] }
      ]
    }
  }
  const values = new Map([['wallet_state', metadata]])
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map(key => [
              key,
              structuredClone(values.get(key))
            ])
          )
        },
        async set(entries) {
          for (const [key, value] of Object.entries(entries))
            values.set(key, structuredClone(value))
        }
      }
    }
  }
  const old = {
    version: 2,
    state: {
      balances: {
        mainnet_w_a: { total: '1' },
        mainnet_w_b: { total: '2' },
        mainnet_keep_c: { total: '3' }
      },
      syncStates: { mainnet_w: {}, mainnet_w_a: {}, mainnet_keep: {} }
    }
  }
  return { values, old, adapter: createChromeStorageAdapter() }
}

test('stale popup writes cannot restore a removed wallet cache and preserve other wallets', async t => {
  const { old, values, adapter } = harness(t)
  await adapter.setItem('account_data', old)
  await removeWalletMetadata('w')
  await adapter.setItem('account_data', old)
  assert.deepEqual(values.get('account_data').state.balances, { mainnet_keep_c: { total: '3' } })
  assert.deepEqual(Object.keys(values.get('account_data').state.syncStates), ['mainnet_keep'])
})

test('pending cleanup blocks cache restoration and deleted account stays blocked after retry', async t => {
  const { old, values, adapter } = harness(t)
  await setWalletCleanupPending('w', true)
  await adapter.setItem('account_data', old)
  assert.equal(values.get('account_data').state.balances.mainnet_w_a, undefined)
  await setAccountDeleted('mainnet_w_a', true)
  await setWalletCleanupPending('w', false)
  await adapter.setItem('account_data', old)
  assert.equal(values.get('account_data').state.balances.mainnet_w_a, undefined)
  assert.deepEqual(values.get('account_data').state.balances.mainnet_w_b, { total: '2' })
})

test('hydration filters stale persisted cache after reset and supports string snapshots', async t => {
  const { old, values, adapter } = harness(t)
  values.set('account_data', JSON.stringify(old))
  values.set('wallet_state', { state: { wallets: [] } })
  const loaded = JSON.parse(await adapter.getItem('account_data'))
  assert.deepEqual(loaded.state.balances, {})
  assert.deepEqual(loaded.state.syncStates, {})
})
