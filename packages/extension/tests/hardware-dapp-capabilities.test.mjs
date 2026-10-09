import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { getHardwareDAppMethodUnavailableReason } from '../src/lib/hardware-capabilities.ts'

describe('hardware dApp capabilities', () => {
  test('keeps the connection active while rejecting unsupported identity methods', () => {
    assert.ok(getHardwareDAppMethodUnavailableReason('ledger', 'zcash_signMessage'))
    assert.ok(getHardwareDAppMethodUnavailableReason('keystone', 'zcash_getPublicKey'))
    assert.ok(getHardwareDAppMethodUnavailableReason('ledger', 'zcash_checkLendingMcaAccount'))
  })

  test('allows connection and supported requests for hardware and software wallets', () => {
    assert.strictEqual(
      getHardwareDAppMethodUnavailableReason('ledger', 'zcash_requestAccounts'),
      undefined
    )
    assert.strictEqual(
      getHardwareDAppMethodUnavailableReason('keystone', 'zcash_sendTransaction'),
      undefined
    )
    assert.strictEqual(
      getHardwareDAppMethodUnavailableReason('software', 'zcash_signMessage'),
      undefined
    )
  })
})
