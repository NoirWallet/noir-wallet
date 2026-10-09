import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LatestAttempt } from '../src/lib/async-utils'
import { classifyError } from '../src/lib/errors'

test('ignores an obsolete import error after the recovery phrase changes', async () => {
  const attempts = new LatestAttempt()
  const obsoleteAttempt = attempts.begin()
  let error: string | null = null

  attempts.invalidate()

  if (attempts.isCurrent(obsoleteAttempt)) {
    error = 'Invalid recovery phrase. Please check and try again.'
  }

  assert.equal(error, null)
})

test('preserves an already classified recovery phrase error', () => {
  assert.equal(
    classifyError(new Error('Invalid recovery phrase. Please check and try again.')).userMessage,
    'Invalid recovery phrase. Please check and try again.'
  )
})

test('shows the original message for an unmapped error', () => {
  const message = 'Transaction rejected because the selected note is no longer spendable'

  assert.equal(classifyError(new Error(message)).userMessage, message)
  assert.equal(classifyError(message).userMessage, message)
})
