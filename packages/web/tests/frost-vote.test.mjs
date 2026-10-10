import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getVoterId, parseVoteSnapshot, fetchVoteSnapshot } from '../src/lib/frost-vote.ts'

const id = '946f2853-a8d7-49ae-a34a-9b44dc9e773d'

test('the browser identity survives reloads and is reused for retries', () => {
  const data = new Map()
  const storage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value)
  }
  assert.equal(
    getVoterId(storage, () => id),
    id
  )
  assert.equal(
    getVoterId(storage, () => {
      throw new Error('must reuse stored identity')
    }),
    id
  )
})

test('unavailable storage fails closed instead of generating a new identity for each vote', () => {
  const storage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {}
  }
  assert.throws(() => getVoterId(storage, () => id))
  const unwritable = {
    getItem: () => null,
    setItem() {
      throw new Error('quota')
    }
  }
  assert.throws(() => getVoterId(unwritable, () => id))
})

test('malformed cached identities are replaced with a persisted valid identity', () => {
  let saved = 'corrupt'
  const storage = {
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value
    }
  }
  assert.equal(
    getVoterId(storage, () => id),
    id
  )
  assert.equal(saved, id)
})

test('both vote counts and the recorded choice must be validated before display', () => {
  assert.deepEqual(parseVoteSnapshot({ total: 123, support: 100, oppose: 23, choice: 'oppose' }), {
    total: 123,
    support: 100,
    oppose: 23,
    choice: 'oppose'
  })
  for (const value of [
    null,
    {},
    { total: -1, support: 0, oppose: -1, choice: null },
    { total: 1.5, support: 1, oppose: 0.5, choice: 'support' },
    { total: '10', support: 10, oppose: 0, choice: null },
    { total: 0, support: 0, oppose: 0, choice: 'other' },
    { total: Infinity, support: Infinity, oppose: 0, choice: null },
    { total: 5, support: 4, oppose: 2, choice: null },
    { total: 0, support: 0, oppose: 0, choice: 'support' }
  ]) {
    assert.throws(() => parseVoteSnapshot(value))
  }
})

test('HTTP failure and malformed responses do not become successful votes', async () => {
  await assert.rejects(() =>
    fetchVoteSnapshot('POST', id, 'support', undefined, async () =>
      Response.json({ total: 1, support: 1, oppose: 0, choice: 'support' }, { status: 503 })
    )
  )
  await assert.rejects(() =>
    fetchVoteSnapshot('POST', id, 'support', undefined, async () =>
      Response.json({ total: '1', support: 1, oppose: 0, choice: 'support' })
    )
  )
  await assert.rejects(() =>
    fetchVoteSnapshot('POST', id, 'support', undefined, async () =>
      Response.json({ total: 1, support: 1, oppose: 0, choice: null })
    )
  )
  assert.deepEqual(
    await fetchVoteSnapshot('POST', id, 'oppose', undefined, async () =>
      Response.json({ total: 1, support: 0, oppose: 1, choice: 'oppose' })
    ),
    { total: 1, support: 0, oppose: 1, choice: 'oppose' }
  )
})

test('unmount cancellation aborts the in-flight voting request', async () => {
  const controller = new AbortController()
  const result = fetchVoteSnapshot('GET', id, null, controller.signal, async (_url, options) => {
    return await new Promise((_resolve, reject) => {
      options.signal.addEventListener(
        'abort',
        () => reject(new DOMException('Cancelled', 'AbortError')),
        { once: true }
      )
    })
  })
  controller.abort()
  await assert.rejects(result, { name: 'AbortError' })
})

test('requests submit the selected option and keep the original vote on an opposite retry', async () => {
  await assert.rejects(() => fetchVoteSnapshot('POST', id, null))
  const result = await fetchVoteSnapshot('POST', id, 'oppose', undefined, async (_url, options) => {
    if (new Headers(options.headers).get('X-Vote-Choice') !== 'oppose') {
      return Response.json({ error: 'choice missing' }, { status: 400 })
    }
    return Response.json({ total: 2, support: 1, oppose: 1, choice: 'support' })
  })
  assert.deepEqual(result, { total: 2, support: 1, oppose: 1, choice: 'support' })
})
