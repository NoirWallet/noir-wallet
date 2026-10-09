import assert from 'node:assert/strict'
import { test, describe, beforeEach, afterEach } from 'node:test'
import {
  readPersistedAutoLockMs,
  readStoredAutoLockMs,
  shouldRequireUnlock
} from '../src/config/auto-lock.ts'
import { WALLET_CONFIG } from '../src/config/wallet.ts'

describe('auto-lock settings', () => {
  let originalChrome

  beforeEach(() => {
    originalChrome = globalThis.chrome
  })

  afterEach(() => {
    globalThis.chrome = originalChrome
  })

  test('reads the selected timeout from Zustand persisted storage', async () => {
    globalThis.chrome = {
      storage: {
        local: {
          get: async () => ({
            wallet_settings: JSON.stringify({
              state: { autoLockMs: 4 * 60 * 60 * 1000 },
              version: 0
            })
          })
        }
      }
    }

    await assert.strictEqual(await readPersistedAutoLockMs(), 4 * 60 * 60 * 1000)
  })

  test('supports object and legacy flat settings without losing a disabled timeout', () => {
    assert.strictEqual(
      readStoredAutoLockMs({ state: { autoLockMs: 60 * 60 * 1000 } }),
      60 * 60 * 1000
    )
    assert.strictEqual(readStoredAutoLockMs({ autoLockMs: 30 * 60 * 1000 }), 30 * 60 * 1000)
    assert.strictEqual(readStoredAutoLockMs(JSON.stringify({ state: { autoLockMs: 0 } })), 0)
  })

  test('falls back to the default for missing or malformed settings', () => {
    const defaultMs = WALLET_CONFIG.SECURITY.AUTO_LOCK.DEFAULT_MS

    assert.strictEqual(readStoredAutoLockMs(undefined), defaultMs)
    assert.strictEqual(readStoredAutoLockMs('{invalid'), defaultMs)
    assert.strictEqual(readStoredAutoLockMs({ state: { autoLockMs: 'four hours' } }), defaultMs)
  })

  test('restores an existing session when auto-lock is disabled', async () => {
    let restoreCalled = false

    await assert.strictEqual(
      await shouldRequireUnlock({
        lastActivityTime: 1,
        autoLockMs: 0,
        now: 24 * 60 * 60 * 1000,
        isLocked: true,
        restoreSession: async () => {
          restoreCalled = true
          return true
        }
      }),
      false
    )
    assert.strictEqual(restoreCalled, true)
  })
})
