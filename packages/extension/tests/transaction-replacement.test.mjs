import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import {
  applyTransactionBroadcast,
  canSpeedUp,
  getTransactionRecoveryAction,
  resolveSpeedUpAmount
} from '../src/lib/transaction-replacement.ts'
import { isTransactionStatusUpdatedMessage } from '../src/types/transaction-messages.ts'

function transaction(overrides = {}) {
  return {
    id: 'tx_original',
    txHash: 'expired-hash',
    status: 'failed',
    type: 'send',
    amount: '0.05',
    to: 'tmRecipient',
    from: 'utestSender',
    fromType: 'shielded',
    fee: '0.0001',
    timestamp: 1,
    network: 'testnet',
    notified: true,
    failureReason: 'expired',
    ...overrides
  }
}

describe('Speed Up replacement lifecycle', () => {
  test('marks the expired transaction as replaced after the retry broadcasts', () => {
    const original = transaction()
    const replacement = transaction({
      id: 'tx_replacement',
      txHash: '',
      status: 'pending',
      failureReason: undefined,
      replacesTransactionId: original.id
    })

    assert.strictEqual(canSpeedUp(original), true)

    const updated = applyTransactionBroadcast(
      [original, replacement],
      replacement.id,
      'replacement-hash',
      3_771_800
    )

    const updatedReplacement = updated.find(tx => tx.id === replacement.id)
    const updatedOriginal = updated.find(tx => tx.id === original.id)
    assert.strictEqual(updatedReplacement.txHash, 'replacement-hash')
    assert.strictEqual(updatedReplacement.status, 'pending')
    assert.strictEqual(updatedReplacement.notified, false)
    assert.strictEqual(updatedReplacement.expiryHeight, 3_771_800)
    assert.strictEqual(updatedReplacement.replacesTransactionId, original.id)
    assert.strictEqual(updatedOriginal.status, 'failed')
    assert.strictEqual(updatedOriginal.failureReason, 'expired')
    assert.strictEqual(updatedOriginal.replacedByTransactionId, replacement.id)
    assert.strictEqual(updatedOriginal.replacedByTxHash, 'replacement-hash')
    assert.strictEqual(canSpeedUp(updated.find(tx => tx.id === original.id)), false)
  })

  test('keeps Speed Up available when the replacement never broadcasts', () => {
    const original = transaction()
    const replacement = transaction({
      id: 'tx_replacement',
      txHash: '',
      status: 'failed',
      failureReason: undefined,
      replacesTransactionId: original.id
    })

    assert.strictEqual(canSpeedUp(original), true)
    assert.strictEqual(canSpeedUp(replacement), false)
  })

  test('reduces a Max retry when the higher fee lowers its spendable amount', () => {
    assert.strictEqual(resolveSpeedUpAmount('0.9897', '0.9888'), '0.9888')
    assert.strictEqual(resolveSpeedUpAmount('0.5', '0.9888'), '0.5')
    assert.strictEqual(resolveSpeedUpAmount('0.5', null), '0.5')
  })

  test('derives one recovery action for every transaction surface', () => {
    assert.strictEqual(getTransactionRecoveryAction(transaction()), 'speed_up')
    assert.strictEqual(
      getTransactionRecoveryAction(transaction({ failureReason: 'timeout' })),
      'retry'
    )
    assert.strictEqual(getTransactionRecoveryAction(transaction({ status: 'pending' })), 'none')
  })

  test('validates transaction status update messages at runtime', () => {
    assert.strictEqual(
      isTransactionStatusUpdatedMessage({
        type: 'TRANSACTION_STATUS_UPDATED',
        accountKey: 'testnet_wallet_account',
        transactionId: 'tx_original',
        status: 'failed',
        failureReason: 'expired'
      }),
      true
    )
    assert.strictEqual(
      isTransactionStatusUpdatedMessage({
        type: 'TRANSACTION_STATUS_UPDATED',
        accountKey: 'testnet_wallet_account',
        transactionId: 'tx_original',
        status: 'failed',
        failureReason: 'unknown'
      }),
      false
    )
    assert.strictEqual(
      isTransactionStatusUpdatedMessage({
        type: 'TRANSACTION_STATUS_UPDATED',
        accountKey: 'testnet_wallet_account',
        transactionId: 'tx_original',
        status: 'success',
        failureReason: 'expired'
      }),
      false
    )
  })
})
