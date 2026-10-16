import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyError, formatErrorMessage, withRetry } from '../src/lib/errors.ts'

test('mapped errors keep the original reason visible after the user guidance', () => {
  for (const [raw, message, retryable] of [
    [
      'gRPC UNAVAILABLE: failed to connect to service',
      'Network connection failed. Please check your internet and try again.',
      true
    ],
    [
      'insufficient balance: selected notes cannot cover transaction fees',
      'Insufficient balance for this transaction.',
      false
    ],
    [
      'Worker crashed during wallet initialization',
      'Wallet engine error. Please restart the extension.',
      false
    ],
    [
      'IncorrectDataError: ZcashAppCommandError/6a80',
      'Ledger rejected the transaction data (0x6a80). Rebuild the transaction and try again.',
      true
    ]
  ]) {
    const classified = classifyError(new Error(raw))
    assert.equal(classified.userMessage, `${message}\n\nOriginal error: ${raw}`)
    assert.equal(classified.technicalMessage, raw)
    assert.equal(classified.retryable, retryable)
    assert.deepEqual(classifyError(classified.userMessage), classified)
    assert.deepEqual(classifyError(new Error(classified.userMessage)), classified)
    assert.equal(classifyError(message).userMessage, message)
  }
})

test('unmapped and identical errors are shown once without an empty detail suffix', () => {
  const raw = 'Selected note is no longer spendable'
  assert.equal(classifyError(raw).userMessage, raw)
  assert.equal(classifyError('').userMessage, 'Unknown error')
  assert.equal(formatErrorMessage(raw, raw), raw)
  assert.equal(formatErrorMessage(raw, ''), raw)
})

test('error details redact credentials and recovery phrases before appearing in screenshots', () => {
  const phrase = 'abandon '.repeat(11) + 'about'
  const raw = `Invalid params: password="synthetic password"; mnemonic=${phrase}; private key=synthetic-key`
  const classified = classifyError(raw)
  assert.equal(classified.technicalMessage, raw)
  assert.equal(
    classified.userMessage,
    'Invalid request parameters from the dApp.\n\nOriginal error: Invalid params: password=[Redacted]; mnemonic=[Redacted]; private key=[Redacted]'
  )
  assert.equal(classifyError(classified.userMessage).userMessage, classified.userMessage)
  assert.equal(
    classifyError(`Cannot import ${phrase}`).userMessage,
    'Cannot import [Recovery phrase redacted]'
  )
  const payload = JSON.stringify({
    password: 'synthetic-escaped-"password',
    recoveryPhrase: 'synthetic-invalid-phrase',
    authorization: 'Bearer synthetic-token',
    sessionKey: 'synthetic-session-key'
  })
  assert.doesNotMatch(classifyError(`Invalid params: ${payload}`).userMessage, /synthetic/)
})

test('retry exhaustion and non-retryable failures retain one copy of the original reason', async () => {
  for (const [reason, expectedAttempts] of [
    ['gRPC UNAVAILABLE: connection refused', 2],
    ['Worker crashed during wallet initialization', 1]
  ]) {
    let attempts = 0
    await assert.rejects(
      withRetry(
        async () => {
          attempts += 1
          throw new Error(reason)
        },
        { maxAttempts: 2, baseDelayMs: 0 }
      ),
      error => {
        assert.equal(error.message, classifyError(reason).userMessage)
        assert.equal(classifyError(error).technicalMessage, reason)
        assert.equal(error.message.split('Original error: ').length, 2)
        return true
      }
    )
    assert.equal(attempts, expectedAttempts)
  }
})
