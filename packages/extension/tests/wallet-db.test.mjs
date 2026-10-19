import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  closeConnection,
  blockWalletRecords,
  blockAccountRecords,
  deleteWalletDb,
  hasWalletDb,
  loadWalletDb,
  mutateTransactions,
  nextUnusedDerivationIndex,
  saveVotingState,
  saveWalletDb
} from '../src/lib/indexed-db.ts'

const walletKey = 'mainnet_synthetic-wallet'
const chunks = () => Array.from({ length: 6 }, (_, index) => new Uint8Array([index + 1]))
const expectedBytes = new Uint8Array([1, 2, 3, 4, 5, 6])

test('wallet write block commits after queued writes and prevents late snapshot writes', async t => {
  installDatabase(t)
  const firstWrite = saveWalletDb(walletKey, chunks())
  const block = blockWalletRecords('mainnet', 'synthetic-wallet')
  await firstWrite
  await block
  closeConnection()
  await assert.rejects(saveWalletDb(walletKey, new Uint8Array([9])), /being removed/)
  assert.deepEqual(await loadWalletDb(walletKey), expectedBytes)
})

test('deleted account block rejects transaction and voting writebacks', async t => {
  installDatabase(t)
  await blockAccountRecords('mainnet', 'synthetic-wallet', 'account')
  await blockAccountRecords('mainnet', 'synthetic-wallet', '3')
  await assert.rejects(
    mutateTransactions('mainnet_synthetic-wallet_account', () => []),
    /being removed/
  )
  await assert.rejects(
    saveVotingState('mainnet_synthetic-wallet_3', new Uint8Array([1]), 1n),
    /being removed/
  )
})

test('re-added software account advances beyond removed voting derivations', async t => {
  installDatabase(t)
  await blockAccountRecords('mainnet', 'synthetic-wallet', '2')
  await blockAccountRecords('mainnet', 'synthetic-wallet', '3')
  await blockAccountRecords('mainnet', 'other-wallet', '9')
  const nextIndex = await nextUnusedDerivationIndex('mainnet', 'synthetic-wallet', 1)
  assert.equal(nextIndex, 4)
  await saveVotingState(`mainnet_synthetic-wallet_${nextIndex}`, new Uint8Array([4]), 1n)
})

function installDatabase(t) {
  const previousIndexedDb = globalThis.indexedDB
  const previousKeyRange = globalThis.IDBKeyRange
  const records = new Map()
  const writeBlocks = new Map()
  let transactionTail = Promise.resolve()
  let synchronousFailure
  let asynchronousFailure
  let openFailure

  const database = {
    close() {},
    transaction(_store, mode) {
      const predecessor = transactionTail
      let release
      transactionTail = new Promise(resolve => {
        release = resolve
      })
      const operations = []
      let snapshot
      let blockSnapshot
      let finished = false
      const transaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() {
          if (finished) throw new DOMException('Transaction finished', 'InvalidStateError')
          finished = true
          setImmediate(() => {
            transaction.onabort?.()
            release()
          })
        },
        objectStore(name) {
          const target = () => (name === 'walletWriteBlocks' ? blockSnapshot : snapshot)
          return {
            get(key) {
              const request = { result: undefined, error: null, onsuccess: null, onerror: null }
              operations.push(() => {
                if (asynchronousFailure?.key === key) {
                  request.error = asynchronousFailure.error
                  asynchronousFailure = undefined
                  transaction.error = request.error
                  request.onerror?.()
                  if (!finished) transaction.abort()
                  return
                }
                request.result = structuredClone(target().get(key))
                request.onsuccess?.()
              })
              return request
            },
            getAllKeys(range) {
              const request = { result: [], error: null, onsuccess: null, onerror: null }
              operations.push(() => {
                request.result = [...target().keys()].filter(
                  key => typeof key === 'string' && key >= range.lower && key <= range.upper
                )
                request.onsuccess?.()
              })
              return request
            },
            put(value, key) {
              if (synchronousFailure?.key === key) {
                const error = synchronousFailure.error
                synchronousFailure = undefined
                throw error
              }
              const cloned = structuredClone(value)
              operations.push(() => {
                if (asynchronousFailure?.key === key) {
                  transaction.error = asynchronousFailure.error
                  asynchronousFailure = undefined
                  transaction.onerror?.()
                  transaction.abort()
                  return
                }
                target().set(key, cloned)
              })
            },
            delete(key) {
              operations.push(() => {
                if (typeof key === 'string') target().delete(key)
                else {
                  for (const storedKey of target().keys()) {
                    if (storedKey >= key.lower && storedKey <= key.upper) target().delete(storedKey)
                  }
                }
              })
            }
          }
        }
      }
      const run = () => {
        if (finished) return
        snapshot ??= new Map(records)
        blockSnapshot ??= new Map(writeBlocks)
        const operation = operations.shift()
        if (operation) {
          try {
            operation()
          } catch (error) {
            transaction.error = error
            transaction.abort()
          }
          setImmediate(run)
          return
        }
        finished = true
        if (mode === 'readwrite') {
          records.clear()
          for (const entry of snapshot) records.set(...entry)
          writeBlocks.clear()
          for (const entry of blockSnapshot) writeBlocks.set(...entry)
        }
        transaction.oncomplete?.()
        release()
      }
      // Each transaction sees one committed snapshot; a later writer waits for its readers.
      void predecessor.then(() => setImmediate(run))
      return transaction
    }
  }

  globalThis.indexedDB = {
    open() {
      const request = { result: database, error: null, onsuccess: null, onerror: null }
      setImmediate(() => {
        if (openFailure) {
          request.error = openFailure
          openFailure = undefined
          request.onerror?.()
        } else request.onsuccess?.()
      })
      return request
    }
  }
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) }
  t.after(async () => {
    await transactionTail
    closeConnection()
    if (previousIndexedDb === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = previousIndexedDb
    if (previousKeyRange === undefined) delete globalThis.IDBKeyRange
    else globalThis.IDBKeyRange = previousKeyRange
  })
  return {
    records,
    failOpen(error) {
      closeConnection()
      openFailure = error
    },
    failPut(key, error, synchronous = true) {
      if (synchronous) synchronousFailure = { key, error }
      else asynchronousFailure = { key, error }
    },
    failRead(key, error) {
      asynchronousFailure = { key, error }
    }
  }
}

test('reading a wallet while its snapshot is deleted returns the complete previous snapshot', async t => {
  installDatabase(t)
  await saveWalletDb(walletKey, chunks())

  const [loaded] = await Promise.all([loadWalletDb(walletKey), deleteWalletDb(walletKey)])

  assert.deepEqual(loaded, expectedBytes)
  assert.equal(await loadWalletDb(walletKey), null)
})

test('reading a wallet while its snapshot shrinks does not mix snapshot generations', async t => {
  const { records } = installDatabase(t)
  await saveWalletDb(walletKey, chunks())

  const [loaded] = await Promise.all([
    loadWalletDb(walletKey),
    saveWalletDb(walletKey, new Uint8Array([9]))
  ])

  assert.deepEqual(loaded, expectedBytes)
  assert.deepEqual(await loadWalletDb(walletKey), new Uint8Array([9]))
  assert.equal(records.has(`${walletKey}::c::5`), false)
})

test('a synchronous chunk or manifest write failure preserves the last committed wallet', async t => {
  const database = installDatabase(t)
  await saveWalletDb(walletKey, chunks())

  for (const key of [`${walletKey}::c::0`, `${walletKey}::c::1`, walletKey]) {
    const error = new DOMException('Cannot clone snapshot', 'DataCloneError')
    database.failPut(key, error)

    await assert.rejects(saveWalletDb(walletKey, chunks()), failure => failure === error)
    assert.deepEqual(await loadWalletDb(walletKey), expectedBytes)
  }
})

test('an asynchronous storage failure rolls back replacement chunks and the manifest', async t => {
  const database = installDatabase(t)
  await saveWalletDb(walletKey, chunks())
  const error = new DOMException('Storage full', 'QuotaExceededError')
  database.failPut(walletKey, error, false)

  await assert.rejects(saveWalletDb(walletKey, new Uint8Array([9])), failure => failure === error)
  assert.deepEqual(await loadWalletDb(walletKey), expectedBytes)
})

test('an empty serialization cannot overwrite an existing wallet snapshot', async t => {
  installDatabase(t)
  await saveWalletDb(walletKey, chunks())

  await assert.rejects(saveWalletDb(walletKey, []), /Failed to serialize wallet database snapshot/)
  await assert.rejects(
    saveWalletDb(walletKey, new Uint8Array()),
    /Failed to serialize wallet database snapshot/
  )
  await assert.rejects(
    saveWalletDb(walletKey, [new Uint8Array([9]), new Uint8Array()]),
    /Failed to serialize wallet database snapshot/
  )
  assert.deepEqual(await loadWalletDb(walletKey), expectedBytes)
})

test('a missing chunk rejects without deleting the remaining recovery evidence', async t => {
  const { records } = installDatabase(t)
  await saveWalletDb(walletKey, chunks())
  records.delete(`${walletKey}::c::0`)

  await assert.rejects(loadWalletDb(walletKey), /Missing chunk 0\/6/)
  assert.equal(records.get(walletKey).chunkCount, 6)
  assert.deepEqual(records.get(`${walletKey}::c::1`), new Uint8Array([2]))
})

test('a queued replacement can repair an incomplete snapshot before recovery is required', async t => {
  const { records } = installDatabase(t)
  await saveWalletDb(walletKey, chunks())
  records.delete(`${walletKey}::c::0`)

  const [loaded] = await Promise.all([
    loadWalletDb(walletKey),
    saveWalletDb(walletKey, expectedBytes)
  ])

  assert.deepEqual(loaded, expectedBytes)
})

test('an incompatible snapshot read cannot delete a concurrently saved compatible snapshot', async t => {
  const { records } = installDatabase(t)
  records.set(walletKey, { metadata: { version: 0 }, data: expectedBytes })

  const [loaded] = await Promise.all([
    loadWalletDb(walletKey),
    saveWalletDb(walletKey, expectedBytes)
  ])

  assert.equal(loaded, null)
  assert.deepEqual(await loadWalletDb(walletKey), expectedBytes)
})

test('storage opening failures are not mistaken for an absent snapshot', async t => {
  const database = installDatabase(t)
  for (const lookup of [loadWalletDb, hasWalletDb]) {
    const error = new DOMException('Storage unavailable', 'UnknownError')
    database.failOpen(error)
    await assert.rejects(lookup(walletKey), failure => failure === error)
  }
  assert.equal(await loadWalletDb(walletKey), null)
  assert.equal(await hasWalletDb(walletKey), false)
})

test('snapshot existence checks propagate read failures and handle malformed entries', async t => {
  const database = installDatabase(t)
  await saveWalletDb(walletKey, chunks())
  assert.equal(await hasWalletDb(walletKey), true)
  const error = new DOMException('Storage unavailable', 'UnknownError')
  database.failRead(walletKey, error)
  await assert.rejects(hasWalletDb(walletKey), failure => failure === error)

  for (const entry of [null, 0, 'invalid', {}, { metadata: { version: 1 }, data: null }]) {
    database.records.set(walletKey, entry)
    assert.equal(await hasWalletDb(walletKey), false)
  }
})

test('malformed manifests and truncated chunks reject instead of loading incomplete bytes', async t => {
  const { records } = installDatabase(t)
  await saveWalletDb(walletKey, chunks())
  const manifest = records.get(walletKey)

  for (const invalid of [
    { chunkCount: -1 },
    { chunkSizes: [6] },
    { chunkSizes: [1, 1, 1, 1, 1, -1] },
    { totalBytes: 7 }
  ]) {
    records.set(walletKey, { ...manifest, ...invalid })
    await assert.rejects(loadWalletDb(walletKey), /Invalid wallet database snapshot/)
  }

  records.set(walletKey, manifest)
  for (const invalidChunk of [new Uint8Array(), new Uint8Array([1, 2]), null, 'invalid']) {
    records.set(`${walletKey}::c::0`, invalidChunk)
    await assert.rejects(loadWalletDb(walletKey), /Invalid wallet database snapshot/)
  }
})

test('manifest and chunk read failures reject with their storage error', async t => {
  const database = installDatabase(t)
  await saveWalletDb(walletKey, chunks())

  for (const key of [walletKey, `${walletKey}::c::0`]) {
    const error = new DOMException('Storage unavailable', 'UnknownError')
    database.failRead(key, error)
    await assert.rejects(loadWalletDb(walletKey), failure => failure === error)
  }
})

test('version-compatible snapshots from before chunking still load', async t => {
  const { records } = installDatabase(t)
  records.set(walletKey, { metadata: { version: 1 }, data: expectedBytes })

  assert.deepEqual(await loadWalletDb(walletKey), expectedBytes)
})
