import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isValidAddTransactionResponse } from '../src/lib/transaction-record-response.ts'

test('accepts only a successful transaction record with a usable id and timestamp', () => {
  const valid = { success: true, transaction: { id: 'tx_1', timestamp: 1234 } }
  assert.strictEqual(isValidAddTransactionResponse(valid), true)
  for (const response of [
    undefined,
    { ...valid, success: 'true' },
    { ...valid, success: false },
    { ...valid, transaction: undefined },
    { ...valid, transaction: { id: 123, timestamp: 1234 } },
    { ...valid, transaction: { id: '  ', timestamp: 1234 } },
    { ...valid, transaction: { id: 'tx_1', timestamp: '1234' } },
    { ...valid, transaction: { id: 'tx_1', timestamp: Infinity } },
    { ...valid, transaction: { id: 'tx_1', timestamp: NaN } }
  ]) {
    assert.strictEqual(isValidAddTransactionResponse(response), false)
  }
})
