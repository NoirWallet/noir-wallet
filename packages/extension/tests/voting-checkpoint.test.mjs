import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  closeConnection,
  loadVotingState,
  validateVotingCheckpoint
} from '../src/lib/indexed-db.ts'

const checkpoint = { revision: '4', bytes: new Uint8Array([1, 2]), updatedAt: 0 }

test('voting checkpoints only advance monotonically', () => {
  assert.strictEqual(validateVotingCheckpoint(undefined, new Uint8Array([1]), 1n), 'write')
  assert.strictEqual(validateVotingCheckpoint(checkpoint, new Uint8Array([1, 2]), 4n), 'unchanged')
  assert.strictEqual(validateVotingCheckpoint(checkpoint, new Uint8Array([3]), 5n), 'write')
  assert.throws(() => validateVotingCheckpoint(checkpoint, new Uint8Array([1]), 3n), /stale/)
  assert.throws(
    () => validateVotingCheckpoint(checkpoint, new Uint8Array([9, 9]), 4n),
    /Conflicting/
  )
})

test('an existing version 6 wallet database upgrades before reading voting state', async () => {
  const previousIndexedDb = globalThis.indexedDB
  const stores = new Set([
    'walletData',
    'transactions',
    'transparentTransactionCache',
    'syncJournal',
    'syncJournalManifest'
  ])
  const database = {
    version: 6,
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore(name) {
      stores.add(name)
      return { createIndex() {} }
    },
    transaction(name) {
      if (!stores.has(name)) throw new DOMException('Object store not found', 'NotFoundError')
      return {
        objectStore() {
          return {
            get() {
              const request = { result: undefined, onsuccess: null }
              queueMicrotask(() => request.onsuccess?.())
              return request
            }
          }
        }
      }
    },
    close() {}
  }
  globalThis.indexedDB = {
    open(_name, version) {
      const request = { result: database, onupgradeneeded: null, onsuccess: null }
      queueMicrotask(() => {
        if (version > database.version) {
          database.version = version
          request.onupgradeneeded?.({ target: request })
        }
        request.onsuccess?.()
      })
      return request
    }
  }

  try {
    assert.equal(await loadVotingState('mainnet_wallet_0'), null)
    for (const name of ['walletData', 'transactions', 'syncJournal', 'syncJournalManifest']) {
      assert.equal(stores.has(name), true)
    }
  } finally {
    closeConnection()
    if (previousIndexedDb === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = previousIndexedDb
  }
})
