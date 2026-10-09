import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChromeStorageAdapter } from '../src/lib/chrome-storage-adapter.ts'

test('concurrent settings writes preserve the latest choice and release the lock after failure', async () => {
  const previousChrome = globalThis.chrome
  const previousFetch = globalThis.fetch
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
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
  let lockTail = Promise.resolve()
  let lockHeld = false
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(_name, callback) {
          const result = lockTail.then(async () => {
            lockHeld = true
            try {
              return await callback()
            } finally {
              lockHeld = false
            }
          })
          lockTail = result.catch(() => {})
          return result
        }
      }
    }
  })

  let releaseLockedRead
  let lockedReadEntered
  let waitForLockedRead = new Promise(resolve => {
    lockedReadEntered = resolve
  })
  let pauseLockedRead = true
  let rejectNextSettingsSet = false
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === 'wallet_settings' && lockHeld && pauseLockedRead) {
            pauseLockedRead = false
            lockedReadEntered()
            await new Promise(resolve => {
              releaseLockedRead = resolve
            })
          }
          return { [key]: structuredClone(values.get(key)) }
        },
        async set(entries) {
          if (entries.wallet_settings && rejectNextSettingsSet) {
            rejectNextSettingsSet = false
            throw new Error('synthetic storage failure')
          }
          for (const [key, value] of Object.entries(entries)) {
            values.set(key, structuredClone(value))
          }
        },
        async remove(key) {
          values.delete(key)
        }
      },
      onChanged: { addListener() {} }
    }
  }
  globalThis.fetch = async () =>
    new Response(
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

  try {
    const rpc = await import('../src/config/rpc-endpoints.ts')
    const adapter = createChromeStorageAdapter()
    const migration = rpc.ensureRpcEndpointPreferencesLoaded()
    await waitForLockedRead

    const chosen = {
      state: {
        autoLockMs: 180000,
        feeTier: 'fast',
        rpcEndpointPreferences: { zcash: 'deltarpc' },
        rpcEndpointModes: { zcash: 'fixed' },
        zeroIndexerDefaultApplied: true
      },
      version: 0
    }
    const userWrite = adapter.setItem('wallet_settings', chosen)
    assert.equal(values.get('wallet_settings').state.autoLockMs, 60000)
    releaseLockedRead()
    await Promise.all([migration, userWrite])
    assert.deepEqual(values.get('wallet_settings'), chosen)

    pauseLockedRead = true
    waitForLockedRead = new Promise(resolve => {
      lockedReadEntered = resolve
    })
    rejectNextSettingsSet = true
    const failingWrite = rpc.writePersistedRpcEndpointSettings({
      preferences: { zcash: 'zero-indexer' },
      modes: { zcash: 'fixed' },
      customRpcEndpoints: { zcash: [] }
    })
    await waitForLockedRead
    const afterFailure = {
      ...chosen,
      state: { ...chosen.state, feeTier: 'slow' }
    }
    const subsequentWrite = adapter.setItem('wallet_settings', afterFailure)
    assert.deepEqual(values.get('wallet_settings'), chosen)
    releaseLockedRead()
    await assert.rejects(failingWrite, /synthetic storage failure/)
    await subsequentWrite
    assert.deepEqual(values.get('wallet_settings'), afterFailure)
  } finally {
    globalThis.chrome = previousChrome
    globalThis.fetch = previousFetch
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  }
})
