import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getResponseErrorMessage } from '../src/lib/errors.ts'

test('response errors preserve strings and use caller fallbacks for malformed values', () => {
  assert.equal(getResponseErrorMessage({ error: 'Request failed' }), 'Request failed')
  assert.equal(getResponseErrorMessage({ error: '' }) ?? 'fallback', '')
  assert.equal(getResponseErrorMessage({ error: '' }) || 'fallback', 'fallback')
  for (const response of [
    null,
    undefined,
    false,
    1,
    'failure',
    [],
    {},
    { error: 500 },
    { error: { message: 'failure' } }
  ]) {
    assert.equal(getResponseErrorMessage(response) ?? 'fallback', 'fallback')
  }
})
