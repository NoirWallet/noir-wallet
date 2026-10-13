import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { SignupStore } from '../src/signup-store.ts'
import { handleSignupRequest } from '../src/api.ts'

const origin = 'https://www.zknoir.com'
const endpoint = origin + '/api/frost-signups'

function createStore(t, setup) {
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  setup?.(database)
  const sql = {
    exec(query, ...bindings) {
      const statement = database.prepare(query)
      const isQuery = statement.columns().length > 0
      const rows = isQuery ? statement.all(...bindings) : []
      if (!isQuery) statement.run(...bindings)
      return {
        toArray() {
          return rows
        },
        one() {
          assert.equal(rows.length, 1)
          return rows[0]
        }
      }
    }
  }
  return { database, store: new SignupStore(sql), reopen: () => new SignupStore(sql) }
}

function request(value = { email: 'alice@example.com' }, headers = {}, method = 'POST') {
  return new Request(endpoint, {
    method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    ...(method === 'POST'
      ? { body: typeof value === 'string' ? value : JSON.stringify(value) }
      : {})
  })
}

function storedRows(database) {
  return database
    .prepare('SELECT email, created_at FROM frost_signups ORDER BY email')
    .all()
    .map(row => ({ ...row }))
}

test('signup stores the email and first signup time; duplicates have identical receipts', async t => {
  const { store, database, reopen } = createStore(t)
  const first = await handleSignupRequest(
    request({ email: ' alice+frost@EXAMPLE.COM ' }),
    store,
    [origin],
    () => 1000
  )
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), { ok: true })
  const repeated = await handleSignupRequest(
    request({ email: 'alice+frost@example.com' }),
    reopen(),
    [origin],
    () => 2000
  )
  assert.equal(repeated.status, 200)
  assert.deepEqual(await repeated.json(), { ok: true })
  assert.deepEqual(storedRows(database), [{ email: 'alice+frost@example.com', created_at: 1000 }])
})

test('one browser can submit multiple emails without a device identifier', async t => {
  const { store, database } = createStore(t)
  for (const email of ['alice@example.com', 'bob@example.com']) {
    const response = await handleSignupRequest(request({ email }), store, [origin], () => 3000)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  }
  assert.equal(storedRows(database).length, 2)
})

test('concurrent repeated requests create a single record', async t => {
  const { store, database } = createStore(t)
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => handleSignupRequest(request(), store, [origin], () => 4000))
  )
  for (const response of responses) {
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(storedRows(database).length, 1)
})

test('invalid emails and unexpected payloads cannot be registered', async t => {
  const { store, database } = createStore(t)
  const values = [
    null,
    [],
    {},
    { email: 123 },
    { email: '' },
    { email: 'invalid' },
    { email: 'a@@example.com' },
    { email: 'a b@example.com' },
    { email: '.alice@example.com' },
    { email: 'alice.@example.com' },
    { email: 'ali..ce@example.com' },
    { email: 'alice@-example.com' },
    { email: 'x'.repeat(65) + '@example.com' },
    { email: 'alice@example.com', deviceId: 'unwanted' },
    'not-json',
    { email: 'a'.repeat(300) + '@example.com' }
  ]
  for (const value of values) {
    const response = await handleSignupRequest(request(value), store, [origin])
    assert.equal(response.status, 400)
    assert.equal(JSON.stringify(await response.json()).includes('alice@'), false)
  }
  assert.deepEqual(storedRows(database), [])
})

test('signup requires an allowed origin and JSON content type', async t => {
  const { store, database } = createStore(t)
  for (const badOrigin of ['', 'null', 'https://attacker.example', 'https://www.zknoir.com.evil']) {
    const response = await handleSignupRequest(request(undefined, { origin: badOrigin }), store, [
      origin
    ])
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  }
  const missing = request()
  missing.headers.delete('origin')
  assert.equal((await handleSignupRequest(missing, store, [origin])).status, 403)
  assert.equal(
    (
      await handleSignupRequest(request(undefined, { 'content-type': 'text/plain' }), store, [
        origin
      ])
    ).status,
    415
  )
  assert.deepEqual(storedRows(database), [])
})

test('readiness checks and preflight reveal neither emails nor signup counts', async t => {
  const { store } = createStore(t)
  store.register('alice@example.com', 1000)
  const response = await handleSignupRequest(new Request(endpoint), store, [origin])
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const preflight = await handleSignupRequest(request(undefined, {}, 'OPTIONS'), store, [origin])
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type')
})

test('unknown paths, old vote endpoints and unsupported methods cannot expose signup data', async t => {
  const { store, database } = createStore(t)
  for (const path of ['/api/frost-signups/emails', '/api/frost-votes']) {
    assert.equal(
      (await handleSignupRequest(new Request(origin + path), store, [origin])).status,
      404
    )
  }
  assert.equal(
    (await handleSignupRequest(request(undefined, {}, 'DELETE'), store, [origin])).status,
    405
  )
  assert.deepEqual(storedRows(database), [])
})

test('oversized and malformed streamed bodies are rejected without storing an email', async t => {
  const { store, database } = createStore(t)
  assert.equal((await handleSignupRequest(request('x'.repeat(2048)), store, [origin])).status, 413)
  const malformed = new Request(endpoint, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array())
        controller.enqueue(Uint8Array.of(0xff))
        controller.close()
      }
    }),
    duplex: 'half'
  })
  assert.equal((await handleSignupRequest(malformed, store, [origin])).status, 400)
  assert.deepEqual(storedRows(database), [])
})

test('unfinished request bodies time out without registering an email', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store, database } = createStore(t)
  const stalled = new Request(endpoint, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: new ReadableStream(),
    duplex: 'half'
  })
  const response = handleSignupRequest(stalled, store, [origin])
  t.mock.timers.tick(2_000)
  assert.equal((await response).status, 408)
  assert.deepEqual(storedRows(database), [])
})

test('aborted request bodies stop without registering an email', async t => {
  const { store, database } = createStore(t)
  const controller = new AbortController()
  const pending = handleSignupRequest(
    new Request(endpoint, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: new ReadableStream(),
      duplex: 'half',
      signal: controller.signal
    }),
    store,
    [origin]
  )
  controller.abort()
  assert.equal((await pending).status, 408)
  assert.deepEqual(storedRows(database), [])
})

test('storage errors never become successful submissions or expose email details', async () => {
  const failing = {
    register() {
      throw new Error('failed to store alice@example.com')
    },
    ready() {
      throw new Error('private database details')
    }
  }
  for (const req of [request(), new Request(endpoint)]) {
    const response = await handleSignupRequest(req, failing, [origin])
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('retry-after'), '5')
    assert.equal(JSON.stringify(await response.json()).includes('alice'), false)
  }
})

test('creating signup storage preserves historical vote tables', t => {
  const { store, database } = createStore(t, database => {
    database.exec('CREATE TABLE votes (voter_hash TEXT PRIMARY KEY)')
    database.exec("INSERT INTO votes VALUES ('legacy-voter')")
  })
  store.register('alice@example.com', 1000)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM votes').get().count, 1)
})
