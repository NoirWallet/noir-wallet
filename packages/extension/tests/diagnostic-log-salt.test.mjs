import assert from 'node:assert/strict'
import { test } from 'node:test'
import { serializeDiagnosticArgs } from '../src/lib/diagnostic-log.ts'

let contextSequence = 0

function loadContext() {
  const url = new URL('../src/lib/diagnostic-log-store.ts', import.meta.url)
  url.searchParams.set('context', String(contextSequence++))
  return import(url.href)
}

function installDatabase(t, storedSalt) {
  const previous = globalThis.indexedDB
  const metadata = new Map()
  if (storedSalt !== undefined) metadata.set('fingerprint_salt', storedSalt)
  let transactionTail = Promise.resolve()
  let failNextTransaction = false
  let writes = 0

  const database = {
    objectStoreNames: { contains: () => true },
    close() {},
    transaction(_name, mode) {
      const predecessor = transactionTail
      let release
      transactionTail = new Promise(resolve => {
        release = resolve
      })
      const operations = []
      const pendingRequests = new Set()
      const pendingWrites = []
      let finished = false
      const transaction = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() {
          if (finished) return
          finished = true
          transaction.error = new DOMException('Diagnostic storage unavailable', 'AbortError')
          queueMicrotask(() => {
            for (const request of pendingRequests) {
              request.error = transaction.error
              request.onerror?.()
            }
            transaction.onabort?.()
          })
          release()
        },
        objectStore() {
          return {
            get(key) {
              const request = { result: undefined, error: null, onsuccess: null, onerror: null }
              pendingRequests.add(request)
              operations.push(() => {
                request.result = metadata.get(key)
                pendingRequests.delete(request)
                request.onsuccess?.()
              })
              return request
            },
            put(value, key) {
              if (mode !== 'readwrite') throw new DOMException('Read-only transaction')
              operations.push(() => pendingWrites.push([key, value]))
            }
          }
        }
      }
      const run = () => {
        if (finished) return
        if (failNextTransaction) {
          failNextTransaction = false
          transaction.abort()
          return
        }
        const operation = operations.shift()
        if (operation) {
          operation()
          setImmediate(run)
          return
        }
        finished = true
        for (const [key, value] of pendingWrites) {
          metadata.set(key, value)
          writes += 1
        }
        transaction.oncomplete?.()
        release()
      }
      // Store transactions are queued across all simulated extension contexts.
      // Splitting a read from its write still lets a second context read first.
      void predecessor.then(() => setImmediate(run))
      return transaction
    }
  }

  globalThis.indexedDB = {
    open() {
      const request = { result: database, onsuccess: null, onerror: null }
      setImmediate(() => request.onsuccess?.())
      return request
    }
  }
  t.after(() => {
    if (previous === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = previous
  })
  return {
    metadata,
    get writes() {
      return writes
    },
    failNext() {
      failNextTransaction = true
    }
  }
}

test('concurrent background and Worker startup share one persisted wallet fingerprint', async t => {
  const database = installDatabase(t)
  const [background, worker] = await Promise.all([loadContext(), loadContext()])
  const [backgroundSalt, workerSalt] = await Promise.all([
    background.getDiagnosticLogSalt(),
    worker.getDiagnosticLogSalt()
  ])

  assert.equal(backgroundSalt, workerSalt)
  assert.equal(database.writes, 1)
  assert.equal(database.metadata.get('fingerprint_salt'), backgroundSalt)

  const walletId = '9e14524d-f793-493c-a2f2-2d362ade3c45'
  const args = ['Wallet RPC failed', { walletId }, { message: 'Wallet not initialized' }]
  const [backgroundLog, workerLog] = await Promise.all([
    serializeDiagnosticArgs(args, backgroundSalt),
    serializeDiagnosticArgs(args, workerSalt)
  ])
  assert.equal(backgroundLog, workerLog)
  assert.ok(!workerLog.includes(walletId))
  assert.ok(workerLog.includes('Wallet not initialized'))

  const restartedWorker = await loadContext()
  assert.equal(await restartedWorker.getDiagnosticLogSalt(), backgroundSalt)
  assert.equal(database.writes, 1)
})

test('existing diagnostic fingerprints survive an extension context restart', async t => {
  const storedSalt = 'eaf2ec98a4b75acb8952e13d8f51b34f'
  const database = installDatabase(t, storedSalt)
  const [background, worker] = await Promise.all([loadContext(), loadContext()])
  assert.deepEqual(
    await Promise.all([background.getDiagnosticLogSalt(), worker.getDiagnosticLogSalt()]),
    [storedSalt, storedSalt]
  )
  assert.equal(database.writes, 0)
})

test('invalid stored salt is replaced once across concurrent contexts', async t => {
  const database = installDatabase(t, 'short')
  const [background, worker] = await Promise.all([loadContext(), loadContext()])
  const salts = await Promise.all([
    background.getDiagnosticLogSalt(),
    worker.getDiagnosticLogSalt()
  ])
  assert.equal(salts[0], salts[1])
  assert.match(salts[0], /^[a-f0-9]{32}$/)
  assert.equal(database.writes, 1)
})

test('a failed salt transaction can retry without caching an unpersisted fingerprint', async t => {
  const database = installDatabase(t)
  const context = await loadContext()
  database.failNext()
  await assert.rejects(context.getDiagnosticLogSalt(), /Diagnostic storage unavailable/)
  assert.equal(database.writes, 0)
  const salt = await context.getDiagnosticLogSalt()
  assert.equal(database.metadata.get('fingerprint_salt'), salt)
  assert.equal(database.writes, 1)
})
