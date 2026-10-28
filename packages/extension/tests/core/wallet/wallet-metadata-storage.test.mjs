import { test } from 'node:test'
import { expect } from '@playwright/test'
import {
  commitWalletMetadataDeletion,
  getWalletDeletionRecord,
  markWalletBackupVerified,
  readWalletMetadata,
  writeWalletMetadata
} from '../../../src/lib/wallet-metadata-storage.ts'

const wallet = {
  id: 'wallet:retained',
  name: 'Wallet 1791000000000',
  seedPhraseKey: 'seed_wallet:retained',
  createdAt: 1791000000000,
  accounts: [{ id: 'account:0' }]
}

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

function mockStorage(initial = {}) {
  const values = structuredClone(initial)
  let getFailure = null
  let setFailure = null
  let pendingGet = null
  const local = {
    async get(keys) {
      if (pendingGet) await pendingGet.promise
      if (getFailure) throw getFailure
      const requested = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(
        requested.map(key => [key, key in values ? structuredClone(values[key]) : undefined])
      )
    },
    async set(next) {
      if (setFailure) throw setFailure
      Object.assign(values, structuredClone(next))
    }
  }
  const originals = {
    chrome: Object.getOwnPropertyDescriptor(globalThis, 'chrome'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  }
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { storage: { local } }
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: async (_name, action) => action() } }
  })
  return {
    values,
    failGet(error) {
      getFailure = error
    },
    failSet(error) {
      setFailure = error
    },
    pauseGet() {
      pendingGet = deferred()
      return pendingGet
    },
    restore() {
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  }
}

test.describe('Wallet metadata persistence', () => {
  test('propagates storage faults without replacing existing wallet metadata', async () => {
    const initial = { wallet_state: { state: { wallets: [wallet] } } }
    const storage = mockStorage(initial)
    try {
      storage.failGet(new Error('storage read failed'))
      await expect(readWalletMetadata()).rejects.toThrow('storage read failed')
      await expect(writeWalletMetadata(initial.wallet_state)).rejects.toThrow('storage read failed')
      storage.failGet(null)
      storage.failSet(new Error('storage write failed'))
      await expect(commitWalletMetadataDeletion(wallet.id)).rejects.toThrow('storage write failed')
      expect(storage.values).toEqual(initial)
    } finally {
      storage.restore()
    }
  })

  test('tombstones a wallet before stale contexts can write it back, and retains retry inventory', async () => {
    const snapshot = { state: { wallets: [wallet], currentWalletId: wallet.id } }
    const storage = mockStorage({ wallet_state: snapshot })
    try {
      await commitWalletMetadataDeletion(wallet.id)
      await writeWalletMetadata(snapshot)
      expect((await readWalletMetadata()).state.wallets).toEqual([])
      expect(storage.values.wallet_deleted_ids).toContain(wallet.id)
      expect(await getWalletDeletionRecord(wallet.id)).toEqual(['account:0'])
    } finally {
      storage.restore()
    }
  })

  test('does not mark a backup verified if its session ends during the awaited storage read', async () => {
    const storage = mockStorage({ wallet_state: { state: { wallets: [wallet] } } })
    try {
      const pending = storage.pauseGet()
      let current = true
      const operation = markWalletBackupVerified(
        wallet.id,
        wallet.createdAt,
        wallet.seedPhraseKey,
        Date.now(),
        () => current
      )
      current = false
      pending.resolve()
      await expect(operation).rejects.toThrow(/changed or was removed/i)
      expect(
        storage.values.wallet_state.state.wallets[0].secretPhraseBackupVerifiedAt
      ).toBeUndefined()
    } finally {
      storage.restore()
    }
  })
})
