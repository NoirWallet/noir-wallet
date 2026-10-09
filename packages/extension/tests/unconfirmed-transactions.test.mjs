import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { summarizeUnconfirmedTransactions } from '../src/lib/unconfirmed-transactions.ts'

function transaction(overrides = {}) {
  return {
    id: 'tx-1',
    txHash: 'hash',
    status: 'pending',
    type: 'send',
    amount: '1',
    to: 'to',
    from: 'from',
    fromType: 'shielded',
    fee: '0',
    timestamp: 0,
    network: 'mainnet',
    ...overrides
  }
}

describe('unconfirmed transaction warnings', () => {
  test('keeps outgoing warning after the first block and clears at three', () => {
    assert.strictEqual(
      summarizeUnconfirmedTransactions(
        [transaction({ status: 'confirming', confirmations: 1, requiredConfirmations: 3 })],
        true
      ).kind,
      'outgoing'
    )

    assert.strictEqual(
      summarizeUnconfirmedTransactions(
        [transaction({ status: 'success', confirmations: 3, requiredConfirmations: 3 })],
        false
      ).kind,
      'none'
    )
  })

  test('keeps external incoming warning until ten confirmations', () => {
    assert.strictEqual(
      summarizeUnconfirmedTransactions(
        [
          transaction({
            type: 'receive',
            status: 'confirming',
            confirmations: 1,
            requiredConfirmations: 10
          })
        ],
        true
      ).kind,
      'incoming'
    )
  })

  test('warns about spendable untrusted incoming funds from three through nine confirmations', () => {
    const atThree = summarizeUnconfirmedTransactions(
      [
        transaction({
          type: 'receive',
          status: 'confirming',
          confirmations: 3,
          requiredConfirmations: 10
        })
      ],
      false
    )
    assert.strictEqual(atThree.kind, 'untrusted')
    assert.strictEqual(atThree.hasSpendableUntrustedIncoming, true)

    assert.strictEqual(
      summarizeUnconfirmedTransactions(
        [
          transaction({
            type: 'receive',
            status: 'confirming',
            confirmations: 9,
            requiredConfirmations: 10
          })
        ],
        false
      ).kind,
      'untrusted'
    )

    assert.strictEqual(
      summarizeUnconfirmedTransactions(
        [
          transaction({
            type: 'receive',
            status: 'success',
            confirmations: 10,
            requiredConfirmations: 10
          })
        ],
        false
      ).kind,
      'none'
    )
  })

  test('scopes spendable incoming warnings to the selected funding source', () => {
    const shieldedIncoming = transaction({
      type: 'receive',
      fromType: 'shielded',
      status: 'confirming',
      confirmations: 4,
      requiredConfirmations: 10
    })

    assert.strictEqual(
      summarizeUnconfirmedTransactions([shieldedIncoming], false, 'transparent').kind,
      'none'
    )
    assert.strictEqual(
      summarizeUnconfirmedTransactions([shieldedIncoming], false, 'shielded').kind,
      'untrusted'
    )
  })

  test('does not confuse a settled Zcash origin with a pending cross-chain relay', () => {
    assert.strictEqual(
      summarizeUnconfirmedTransactions(
        [
          transaction({
            type: 'swap',
            status: 'pending',
            confirmations: 3,
            requiredConfirmations: 3
          })
        ],
        false
      ).kind,
      'none'
    )
  })

  test('falls back to a generic warning when only WASM pending balance is known', () => {
    assert.strictEqual(summarizeUnconfirmedTransactions([], true).kind, 'generic')
  })
})
