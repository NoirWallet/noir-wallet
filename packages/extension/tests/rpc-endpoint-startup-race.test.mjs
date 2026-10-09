import { test } from 'node:test'
import assert from 'node:assert/strict'

test('a new deliberate RPC choice during registry loading survives startup', async () => {
  const previousChrome = globalThis.chrome
  const previousFetch = globalThis.fetch
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let lockTail = Promise.resolve()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(_name, callback) {
          const result = lockTail.then(callback)
          lockTail = result.catch(() => {})
          return result
        }
      }
    }
  })
  const values = new Map([
    [
      'wallet_settings',
      {
        state: {
          autoLockMs: 60000,
          feeTier: 'normal',
          rpcEndpointPreferences: { zcash: 'deltarpc' },
          rpcEndpointModes: { zcash: 'auto' }
        },
        version: 0
      }
    ]
  ])
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: values.get(key) }
        },
        async set(entries) {
          for (const [key, value] of Object.entries(entries)) values.set(key, value)
        }
      },
      onChanged: { addListener() {} }
    }
  }
  let releaseFetch
  let fetchStarted
  const waitingForFetch = new Promise(resolve => {
    fetchStarted = resolve
  })
  globalThis.fetch = async () => {
    fetchStarted()
    await new Promise(resolve => {
      releaseFetch = resolve
    })
    return new Response(
      JSON.stringify({
        version: 1,
        updatedAt: '2026-10-09T00:00:00.000Z',
        chains: [
          {
            id: 'zcash-mainnet',
            chain: 'zcash',
            network: 'mainnet',
            label: 'Zcash',
            iconChain: 'zec',
            endpoints: [{ id: 'deltarpc', label: 'DeltaRPC', url: 'https://rpc.example.com' }]
          }
        ]
      }),
      { headers: { 'content-type': 'application/json' } }
    )
  }

  try {
    const rpc = await import('../src/config/rpc-endpoints.ts')
    const loading = rpc.ensureRpcEndpointPreferencesLoaded()
    await waitingForFetch
    values.set('wallet_settings', {
      state: {
        autoLockMs: 180000,
        feeTier: 'fast',
        rpcEndpointPreferences: { zcash: 'deltarpc' },
        rpcEndpointModes: { zcash: 'fixed' },
        zeroIndexerDefaultApplied: true
      },
      version: 0
    })
    releaseFetch()
    await loading

    assert.equal(rpc.getActiveRpcEndpointOption('zcash').id, 'deltarpc')
    assert.equal(rpc.getActiveRpcEndpointMode('zcash'), 'fixed')
    assert.equal(values.get('wallet_settings').state.autoLockMs, 180000)
    assert.equal(values.get('wallet_settings').state.feeTier, 'fast')
    assert.equal(values.get('wallet_settings').state.zeroIndexerDefaultApplied, true)
  } finally {
    globalThis.chrome = previousChrome
    globalThis.fetch = previousFetch
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  }
})
