import assert from 'node:assert/strict'
import { test } from 'node:test'
import { submitSignup, parseSignupReceipt, parseSignupHealth } from '../src/lib/frost-signup.ts'

test('signups submit only the trimmed email and repeat submissions are accepted', async () => {
  const submitted = []
  const accepted = async (url, options) => {
    assert.equal(url, '/api/frost-signups')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    submitted.push(JSON.parse(options.body))
    return Response.json({ ok: true })
  }
  await submitSignup(' alice@example.com ', undefined, accepted)
  await submitSignup('alice@example.com', undefined, accepted)
  await submitSignup('bob@example.com', undefined, accepted)
  assert.deepEqual(submitted, [
    { email: 'alice@example.com' },
    { email: 'alice@example.com' },
    { email: 'bob@example.com' }
  ])
})

test('empty or oversized email input cannot be submitted', async () => {
  for (const email of ['', '   ', 'x'.repeat(255)]) {
    await assert.rejects(() =>
      submitSignup(email, undefined, async () => Response.json({ ok: true }))
    )
  }
})

test('success is confirmed from the API rather than assumed from HTTP status', () => {
  assert.deepEqual(parseSignupReceipt({ ok: true }), { ok: true })
  for (const response of [null, {}, { ok: false }, { ok: 'true' }]) {
    assert.throws(() => parseSignupReceipt(response))
  }
  assert.deepEqual(parseSignupHealth({ status: 'ok' }), { status: 'ok' })
  assert.throws(() => parseSignupHealth({ total: 1 }))
})

test('HTTP errors and malformed acknowledgments remain retriable failures', async () => {
  for (const response of [
    Response.json({ error: 'INVALID_EMAIL' }, { status: 400 }),
    Response.json({}, { status: 503 }),
    Response.json({ ok: false }),
    new Response('not-json')
  ]) {
    await assert.rejects(() => submitSignup('alice@example.com', undefined, async () => response))
  }
  await assert.rejects(
    () =>
      submitSignup('alice@example.com', undefined, async () => {
        throw new TypeError('network')
      }),
    { message: 'Signup is temporarily unavailable. Please try again.' }
  )
  await submitSignup('alice@example.com', undefined, async () => Response.json({ ok: true }))
})

test('request cancellation aborts an in-flight signup', async () => {
  const controller = new AbortController()
  const pending = submitSignup(
    'alice@example.com',
    controller.signal,
    async (_url, options) =>
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true }
        )
      })
  )
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})
