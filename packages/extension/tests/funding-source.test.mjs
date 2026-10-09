import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getFundingSourceUnavailableReason } from '../src/lib/funding-source.ts'

test('allows Ledger transparent funding while keeping Keystone disabled', () => {
  assert.ok(getFundingSourceUnavailableReason('keystone', 'transparent'))
  assert.strictEqual(getFundingSourceUnavailableReason('keystone', 'shielded'), undefined)
  assert.strictEqual(getFundingSourceUnavailableReason('ledger', 'transparent'), undefined)
  assert.strictEqual(getFundingSourceUnavailableReason('software', 'transparent'), undefined)
})
