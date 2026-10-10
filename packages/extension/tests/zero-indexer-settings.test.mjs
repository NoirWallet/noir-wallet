import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseZeroIndexerEnabled,
  readZeroIndexerEnabled,
  readZeroIndexerEnabledForWorker,
  writeZeroIndexerEnabled
} from '../src/config/zero-indexer-settings.ts'
import { createChromeStorageAdapter } from '../src/lib/chrome-storage-adapter.ts'
import { getZeroIndexerOptions } from '../src/config/zero-indexer.ts'

test('privacy broadcast defaults on and respects an explicit off preference', () => {
  assert.equal(parseZeroIndexerEnabled(undefined), true)
  assert.equal(parseZeroIndexerEnabled({ state: { zeroIndexerDefaultApplied: true } }), true)
  assert.equal(parseZeroIndexerEnabled({ state: { zeroIndexerEnabled: false } }), false)
})

test('offscreen init resolves an explicit opt-out through background without storage access', async () => {
  const previousChrome = globalThis.chrome
  const requests = []
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        requests.push(message)
        return { success: true, enabled: false }
      }
    }
  }
  try {
    const enabled = await readZeroIndexerEnabledForWorker()
    assert.equal(enabled, false)
    assert.equal(getZeroIndexerOptions('mainnet', enabled), null)
    assert.deepEqual(requests, [{ type: 'GET_ZERO_INDEXER_ENABLED' }])

    globalThis.chrome.runtime.sendMessage = async () => ({ success: true, enabled: 'false' })
    await assert.rejects(readZeroIndexerEnabledForWorker(), /Invalid privacy broadcast/)
    globalThis.chrome.runtime.sendMessage = async () => ({ error: 'settings unavailable' })
    await assert.rejects(readZeroIndexerEnabledForWorker(), /settings unavailable/)
  } finally {
    globalThis.chrome = previousChrome
  }
})

test('changing privacy broadcast preference preserves concurrent wallet settings', async () => {
  const previousChrome = globalThis.chrome
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let lockTail = Promise.resolve()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(_name, callback) {
          const operation = lockTail.then(callback)
          lockTail = operation.catch(() => {})
          return operation
        }
      }
    }
  })
  let settings = {
    state: {
      autoLockMs: 60000,
      rpcEndpointPreferences: { zcash: 'deltarpc' },
      zeroIndexerDefaultApplied: true
    },
    version: 0
  }
  const staleSettings = structuredClone(settings)
  let signalZeroWrite
  const zeroWriteStarted = new Promise(resolve => {
    signalZeroWrite = resolve
  })
  let releaseZeroWrite
  let pauseZeroWrite = true
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return { wallet_settings: structuredClone(settings) }
        },
        async set(value) {
          if (pauseZeroWrite && value.wallet_settings.state.zeroIndexerEnabled === false) {
            pauseZeroWrite = false
            signalZeroWrite()
            await new Promise(resolve => {
              releaseZeroWrite = resolve
            })
          }
          settings = structuredClone(value.wallet_settings)
        }
      }
    }
  }

  try {
    const privacyWrite = writeZeroIndexerEnabled(false)
    await zeroWriteStarted
    const ordinaryWrite = createChromeStorageAdapter().setItem('wallet_settings', {
      ...staleSettings,
      state: { ...staleSettings.state, autoLockMs: 180000, zeroIndexerEnabled: true }
    })
    releaseZeroWrite()
    await Promise.all([privacyWrite, ordinaryWrite])
    assert.equal(await readZeroIndexerEnabled(), false)
    assert.equal(settings.state.autoLockMs, 180000)
    assert.deepEqual(settings.state.rpcEndpointPreferences, { zcash: 'deltarpc' })
    assert.equal('zeroIndexerDefaultApplied' in settings.state, false)
  } finally {
    globalThis.chrome = previousChrome
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  }
})
