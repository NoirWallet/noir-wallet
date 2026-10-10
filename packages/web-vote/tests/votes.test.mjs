import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { VoteStore } from '../src/vote-store.ts'
import { handleVoteRequest } from '../src/api.ts'

const firstId = '946f2853-a8d7-49ae-a34a-9b44dc9e773d'
const secondId = '7142ae84-5d56-4b9c-9f42-18728c06e0b2'
const origin = 'https://www.zknoir.com'

function createStore(t, setup) {
  const database = new DatabaseSync(':memory:')
  t.after(() => database.close())
  setup?.(database)
  const storage = {
    sql: {
      exec(query, ...bindings) {
        const statement = database.prepare(query)
        const isQuery = statement.columns().length > 0
        const rows = isQuery ? statement.all(...bindings) : []
        const rowsWritten = isQuery ? 0 : Number(statement.run(...bindings).changes)
        return {
          rowsWritten,
          toArray() {
            return rows
          },
          one() {
            assert.equal(rows.length, 1)
            return rows[0]
          }
        }
      }
    },
    transactionSync(callback) {
      database.exec('BEGIN')
      try {
        const result = callback()
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
  }
  return { store: new VoteStore(storage), reopen: () => new VoteStore(storage), database }
}

function request(method = 'GET', id = firstId, options = {}) {
  return new Request('https://www.zknoir.com/api/frost-votes', {
    method,
    headers: {
      origin,
      ...(id ? { 'x-voter-id': id } : {}),
      ...(method === 'POST' ? { 'x-vote-choice': 'support' } : {}),
      ...options.headers
    },
    ...(options.body ? { body: options.body } : {})
  })
}

test('duplicate submissions keep the total unchanged, including after reopening storage', t => {
  const { store, reopen } = createStore(t)
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
  assert.deepEqual(store.cast('a'.repeat(64), 'support'), {
    total: 1,
    support: 1,
    oppose: 0,
    choice: 'support'
  })
  assert.deepEqual(store.cast('a'.repeat(64), 'oppose'), {
    total: 1,
    support: 1,
    oppose: 0,
    choice: 'support'
  })
  assert.deepEqual(store.cast('b'.repeat(64), 'oppose'), {
    total: 2,
    support: 1,
    oppose: 1,
    choice: 'oppose'
  })
  assert.deepEqual(store.read('c'.repeat(64)), { total: 2, support: 1, oppose: 1, choice: null })
  const reopened = reopen()
  assert.deepEqual(reopened.read('a'.repeat(64)), {
    total: 2,
    support: 1,
    oppose: 1,
    choice: 'support'
  })
})

test('existing single-option votes migrate to support without recounting on reopen', t => {
  const { store, reopen } = createStore(t, database => {
    database.exec('CREATE TABLE votes (voter_hash TEXT PRIMARY KEY)')
    database.exec(
      'CREATE TABLE poll (id INTEGER PRIMARY KEY CHECK (id = 1), total INTEGER NOT NULL DEFAULT 0)'
    )
    database.exec('INSERT INTO poll VALUES (1, 2)')
    database.prepare('INSERT INTO votes VALUES (?)').run('a'.repeat(64))
    database.prepare('INSERT INTO votes VALUES (?)').run('b'.repeat(64))
  })
  assert.deepEqual(store.read('a'.repeat(64)), {
    total: 2,
    support: 2,
    oppose: 0,
    choice: 'support'
  })
  assert.deepEqual(store.cast('c'.repeat(64), 'oppose'), {
    total: 3,
    support: 2,
    oppose: 1,
    choice: 'oppose'
  })
  assert.deepEqual(reopen().read('b'.repeat(64)), {
    total: 3,
    support: 2,
    oppose: 1,
    choice: 'support'
  })
})

test('concurrent submissions of one browser identity count as one vote', async t => {
  const { store } = createStore(t)
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => handleVoteRequest(request('POST'), store, [origin]))
  )
  for (const response of responses) {
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { total: 1, support: 1, oppose: 0, choice: 'support' })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const distinct = await handleVoteRequest(
    request('POST', secondId, { headers: { 'x-vote-choice': 'oppose' } }),
    store,
    [origin]
  )
  assert.deepEqual(await distinct.json(), { total: 2, support: 1, oppose: 1, choice: 'oppose' })
  const status = await handleVoteRequest(request(), store, [origin])
  assert.deepEqual(await status.json(), { total: 2, support: 1, oppose: 1, choice: 'support' })
})

test('anonymous reads work but writes require an allowed origin and a valid identity', async t => {
  const { store } = createStore(t)
  const anonymous = await handleVoteRequest(request('GET', null), store, [origin])
  assert.deepEqual(await anonymous.json(), { total: 0, support: 0, oppose: 0, choice: null })
  for (const badId of [null, '', 'garbage', firstId.toUpperCase(), 'x'.repeat(500)]) {
    const response = await handleVoteRequest(request('POST', badId), store, [origin])
    assert.equal(response.status, 400)
  }
  for (const badOrigin of ['', 'null', 'https://attacker.example', 'https://www.zknoir.com.evil']) {
    const response = await handleVoteRequest(
      request('POST', firstId, { headers: { origin: badOrigin } }),
      store,
      [origin]
    )
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  }
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
})

test('missing or invalid vote choices are rejected without changing either count', async t => {
  const { store } = createStore(t)
  for (const choice of ['', 'yes', 'SUPPORT', 'other']) {
    const response = await handleVoteRequest(
      request('POST', firstId, { headers: { 'x-vote-choice': choice } }),
      store,
      [origin]
    )
    assert.equal(response.status, 400)
  }
  const missing = request('POST')
  missing.headers.delete('x-vote-choice')
  assert.equal((await handleVoteRequest(missing, store, [origin])).status, 400)
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
})

test('preflight allows only the vote methods and headers for configured origins', async t => {
  const { store } = createStore(t)
  const response = await handleVoteRequest(request('OPTIONS'), store, [origin])
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS')
  assert.equal(response.headers.get('access-control-allow-headers'), 'X-Voter-ID, X-Vote-Choice')
  assert.equal(response.headers.get('vary'), 'Origin')
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
})

test('unknown paths, methods and request bodies cannot cast votes', async t => {
  const { store } = createStore(t)
  const missing = new Request('https://www.zknoir.com/api/frost-votes/other', {
    method: 'POST',
    headers: { origin, 'x-voter-id': firstId }
  })
  assert.equal((await handleVoteRequest(missing, store, [origin])).status, 404)
  assert.equal((await handleVoteRequest(request('DELETE'), store, [origin])).status, 405)
  assert.equal(
    (await handleVoteRequest(request('POST', firstId, { body: '{}' }), store, [origin])).status,
    400
  )
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
})

test('empty POST streams from the Worker HTTP runtime are accepted and still deduplicated', async t => {
  const { store } = createStore(t)
  for (let attempt = 0; attempt < 2; attempt++) {
    const empty = new Request('https://www.zknoir.com/api/frost-votes', {
      method: 'POST',
      headers: { origin, 'x-voter-id': firstId, 'x-vote-choice': 'oppose' },
      body: new ReadableStream({
        start(controller) {
          controller.close()
        }
      }),
      duplex: 'half'
    })
    const response = await handleVoteRequest(empty, store, [origin])
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { total: 1, support: 0, oppose: 1, choice: 'oppose' })
  }
})

test('a stream containing bytes is rejected even after empty chunks', async t => {
  const { store } = createStore(t)
  const nonempty = new Request('https://www.zknoir.com/api/frost-votes', {
    method: 'POST',
    headers: { origin, 'x-voter-id': firstId, 'x-vote-choice': 'support' },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array())
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      }
    }),
    duplex: 'half'
  })
  assert.equal((await handleVoteRequest(nonempty, store, [origin])).status, 400)
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
})

test('unfinished request bodies time out without casting a vote', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { store } = createStore(t)
  const stalled = new Request('https://www.zknoir.com/api/frost-votes', {
    method: 'POST',
    headers: { origin, 'x-voter-id': firstId, 'x-vote-choice': 'support' },
    body: new ReadableStream(),
    duplex: 'half'
  })
  const response = handleVoteRequest(stalled, store, [origin])
  t.mock.timers.tick(2_000)
  assert.equal((await response).status, 503)
  assert.deepEqual(store.read(), { total: 0, support: 0, oppose: 0, choice: null })
})

test('a failed count update rolls back the identity so a retry can succeed', t => {
  const { store, database } = createStore(t)
  database.exec(
    "CREATE TRIGGER fail_count BEFORE UPDATE ON poll BEGIN SELECT RAISE(ABORT, 'failed'); END"
  )
  assert.throws(() => store.cast('a'.repeat(64), 'oppose'))
  assert.deepEqual(store.read('a'.repeat(64)), { total: 0, support: 0, oppose: 0, choice: null })
  database.exec('DROP TRIGGER fail_count')
  assert.deepEqual(store.cast('a'.repeat(64), 'oppose'), {
    total: 1,
    support: 0,
    oppose: 1,
    choice: 'oppose'
  })
})

test('storage failures return an actionable retry response without exposing internals', async () => {
  const failing = {
    read() {
      throw new Error('private database details')
    },
    cast() {
      throw new Error('private database details')
    }
  }
  for (const method of ['GET', 'POST']) {
    const response = await handleVoteRequest(request(method), failing, [origin])
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('retry-after'), '5')
    assert.equal(JSON.stringify(await response.json()).includes('private database'), false)
  }
})
