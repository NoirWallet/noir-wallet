import assert from 'node:assert/strict'
import { test, describe, beforeEach, afterEach } from 'node:test'
import {
  readLendingHomeCache,
  writeLendingHomeCache
} from '../src/core/services/lending-home-cache.ts'

describe('lending home cache', () => {
  let originalChrome
  let sessionStorage

  beforeEach(() => {
    originalChrome = globalThis.chrome
    sessionStorage = {}
    globalThis.chrome = {
      storage: {
        local: {
          get: async key => ({ [key]: sessionStorage[key] }),
          set: async values => Object.assign(sessionStorage, values),
          remove: async key => {
            delete sessionStorage[key]
          }
        }
      }
    }
  })

  afterEach(() => {
    globalThis.chrome = originalChrome
  })

  test('keeps cached lending summaries scoped by wallet and account', async () => {
    await writeLendingHomeCache('mainnet', 'wallet-a', 'account-a', {
      suppliedZec: '1.25',
      mcaId: 'mca-a',
      signingMode: 'derived',
      mcaChecked: true,
      updatedAt: 100
    })
    await writeLendingHomeCache('mainnet', 'wallet-b', 'account-a', {
      suppliedZec: '3',
      mcaId: null,
      signingMode: 'legacy_index0',
      mcaChecked: true,
      updatedAt: 200
    })

    const walletA = await readLendingHomeCache('mainnet', 'wallet-a', 'account-a')
    const walletB = await readLendingHomeCache('mainnet', 'wallet-b', 'account-a')
    assert.strictEqual(walletA.suppliedZec, '1.25')
    assert.strictEqual(walletA.mcaId, 'mca-a')
    assert.strictEqual(walletB.suppliedZec, '3')
    assert.strictEqual(walletB.mcaId, null)
    assert.strictEqual(await readLendingHomeCache('testnet', 'wallet-a', 'account-a'), null)
  })

  test('ignores malformed cached values at the storage boundary', async () => {
    sessionStorage.lending_home_cache_v1 = {
      'mainnet:wallet-a:account-a': {
        suppliedZec: '-1',
        mcaId: 123,
        signingMode: 'unknown',
        mcaChecked: 'yes',
        updatedAt: 'now'
      }
    }

    assert.strictEqual(await readLendingHomeCache('mainnet', 'wallet-a', 'account-a'), null)
  })
})
