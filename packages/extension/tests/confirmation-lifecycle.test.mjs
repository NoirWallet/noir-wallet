import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTxHash, localTxHashSet, isDuplicateWasmRow } from '../src/lib/tx-history-dedup.ts'
import {
  decideMonitorSignal,
  shouldRefreshSpendability
} from '../src/background/tx-monitor-policy.ts'
import {
  getCrossChainCompletionStatus,
  isIntentsSettledTransaction,
  needsRelayStatusRecovery
} from '../src/lib/cross-chain-transaction.ts'
import {
  getRequiredConfirmations,
  mergeTransactionUpdate,
  resolveMinedTransactionStatus
} from '../src/lib/transaction-status.ts'
import { isWalletSettlementComplete } from '../src/lib/wallet-settlement.ts'

function tx(overrides) {
  return {
    id: 'tx_1',
    txHash: 'abc123',
    status: 'pending',
    type: 'send',
    amount: '1',
    to: 't1',
    from: 't1',
    fromType: 'shielded',
    fee: '0',
    timestamp: 0,
    network: 'mainnet',
    ...overrides
  }
}

describe('Confirmation policy', () => {
  test('Received in first block is still confirming (1/10)', () => {
    const signal = decideMonitorSignal({
      lookup: { status: 'confirmed', confirmations: 1 },
      minConfirmations: 10,
      expired: false,
      elapsedMs: 1000,
      timeoutMs: 30 * 60 * 1000,
      hasNode: true,
      confirmedInDb: false
    })
    assert.equal(signal, 'wait')
  })

  test('9 confirmations has not reached incoming Activity finality', () => {
    const signal = decideMonitorSignal({
      lookup: { status: 'confirmed', confirmations: 9 },
      minConfirmations: 10,
      expired: false,
      elapsedMs: 1000,
      timeoutMs: 30 * 60 * 1000,
      hasNode: true,
      confirmedInDb: false
    })
    assert.equal(signal, 'wait')
  })

  test('10 confirmations reaches confirmed', () => {
    const signal = decideMonitorSignal({
      lookup: { status: 'confirmed', confirmations: 10 },
      minConfirmations: 10,
      expired: false,
      elapsedMs: 1000,
      timeoutMs: 30 * 60 * 1000,
      hasNode: true,
      confirmedInDb: false
    })
    assert.equal(signal, 'confirm')
  })

  test('external receives require 10 confirmations while sends require 3', () => {
    assert.equal(getRequiredConfirmations('receive'), 10)
    assert.equal(getRequiredConfirmations('receive', 'trusted'), 3)
    assert.equal(getRequiredConfirmations('withdraw'), 10)
    assert.equal(getRequiredConfirmations('send'), 3)
    assert.equal(resolveMinedTransactionStatus('mined', 100, 102, 'send').status, 'success')
    assert.deepEqual(resolveMinedTransactionStatus('mined', 100, 102, 'receive', 'trusted'), {
      status: 'success',
      confirmations: 3,
      requiredConfirmations: 3
    })
    assert.deepEqual(resolveMinedTransactionStatus('mined', 100, 102, 'receive'), {
      status: 'confirming',
      confirmations: 3,
      requiredConfirmations: 10
    })
  })

  test('spendability threshold requests one refresh without changing finality', () => {
    assert.equal(shouldRefreshSpendability(1, 3, undefined), false)
    assert.equal(shouldRefreshSpendability(2, 3, undefined), false)
    assert.equal(shouldRefreshSpendability(3, 3, undefined), true)
    assert.equal(shouldRefreshSpendability(4, 3, true), false)
    assert.equal(getRequiredConfirmations('send'), 3)
    assert.equal(getRequiredConfirmations('receive'), 10)
  })

  test('mined but under 10 confirmations is not timed out even past timeout', () => {
    const signal = decideMonitorSignal({
      lookup: { status: 'confirmed', confirmations: 5 },
      minConfirmations: 10,
      expired: false,
      elapsedMs: 60 * 60 * 1000,
      timeoutMs: 30 * 60 * 1000,
      hasNode: true,
      confirmedInDb: false
    })
    assert.equal(signal, 'wait')
  })
})
describe('Transaction status monotonicity', () => {
  test('a matching chain confirmation recovers failed sends and shields', () => {
    for (const type of ['send', 'shield', 'receive']) {
      const failed = tx({ type, status: 'failed', failureReason: 'timeout', notified: true })
      const confirmations = getRequiredConfirmations(type)
      const recovered = mergeTransactionUpdate(
        failed,
        { status: 'success' },
        { txHash: ' ABC123 ', confirmations }
      )
      assert.equal(recovered.status, 'success')
      assert.equal(recovered.confirmations, confirmations)
      assert.equal(recovered.requiredConfirmations, confirmations)
      assert.equal(recovered.failureReason, undefined)
      assert.equal(recovered.notified, false)
      assert.equal(recovered.id, failed.id)
    }
  })

  test('cached confirmation counts alone cannot reverse a failed transaction', () => {
    const failed = tx({ status: 'failed', confirmations: 10, failureReason: 'expired' })
    assert.equal(
      mergeTransactionUpdate(failed, { status: 'success', confirmations: 10 }).status,
      'failed'
    )
  })

  test('a different hash or insufficient confirmation never recovers a failure', () => {
    const failed = tx({ status: 'failed' })
    for (const confirmation of [
      { txHash: 'another-transaction', confirmations: 10 },
      { txHash: '', confirmations: 10 },
      { txHash: 'abc123', confirmations: 2 },
      { txHash: 'abc123', confirmations: NaN },
      { txHash: 'abc123', confirmations: Infinity },
      { txHash: 'abc123', confirmations: 3.5 }
    ]) {
      assert.equal(
        mergeTransactionUpdate(failed, { status: 'success' }, confirmation).status,
        'failed'
      )
    }
    assert.equal(
      mergeTransactionUpdate(
        failed,
        { status: 'success', txHash: 'another-transaction' },
        { txHash: failed.txHash, confirmations: 10 }
      ).status,
      'failed'
    )
  })

  test('a confirmation can restore a hash bound by the monitor before local bookkeeping', () => {
    const failed = tx({ status: 'failed', txHash: '' })
    assert.equal(
      mergeTransactionUpdate(
        failed,
        { status: 'success' },
        {
          txHash: 'abc123',
          confirmations: 10
        }
      ).status,
      'failed'
    )
    const recovered = mergeTransactionUpdate(
      failed,
      { status: 'success', txHash: 'abc123' },
      { txHash: 'abc123', confirmations: 10 }
    )
    assert.equal(recovered.status, 'success')
    assert.equal(recovered.txHash, 'abc123')
  })

  test('origin confirmations cannot reverse failed cross-chain operations', () => {
    for (const type of ['supply', 'swap', 'withdraw', 'claim']) {
      assert.equal(
        mergeTransactionUpdate(
          tx({ type, status: 'failed' }),
          { status: 'success' },
          { txHash: 'abc123', confirmations: 100 }
        ).status,
        'failed'
      )
    }
  })

  test('recovered success is stable against stale failures and repeated confirmation', () => {
    const confirmation = { txHash: 'abc123', confirmations: 10 }
    const recovered = mergeTransactionUpdate(
      tx({ status: 'failed', failureReason: 'expired', notified: true }),
      { status: 'success' },
      confirmation
    )
    const notified = { ...recovered, notified: true }
    assert.deepEqual(
      mergeTransactionUpdate(notified, { status: 'success' }, confirmation),
      notified
    )
    assert.deepEqual(
      mergeTransactionUpdate(notified, {
        status: 'failed',
        failureReason: 'timeout',
        notified: false
      }),
      notified
    )
  })

  test('stale relay updates cannot downgrade a successful transaction', () => {
    const successful = tx({ status: 'success', notified: true })
    assert.deepEqual(
      mergeTransactionUpdate(successful, {
        status: 'relay_confirmed',
        notified: false,
        failureReason: 'timeout',
        memo: 'Refunded',
        destinationTxHash: 'destination'
      }),
      {
        ...successful,
        destinationTxHash: 'destination'
      }
    )
  })

  test('non-terminal transactions still advance to confirming', () => {
    const pending = tx({ status: 'pending' })
    assert.equal(
      mergeTransactionUpdate(pending, {
        status: 'confirming',
        confirmations: 2,
        requiredConfirmations: 10
      }).status,
      'confirming'
    )
  })
})

describe('Confirmed transaction wallet settlement', () => {
  test('keeps monitoring until catch-up succeeds and reaches the confirming node height', () => {
    assert.equal(isWalletSettlementComplete(false, 100, 100), false)
    assert.equal(isWalletSettlementComplete(true, 99, 100), false)
    assert.equal(isWalletSettlementComplete(true, 100, 100), true)
    assert.equal(isWalletSettlementComplete(true, 100), true)
  })
})

describe('Withdraw and Received merge via destinationTxHash', () => {
  test('localTxHashSet includes destinationTxHash from withdraw records', () => {
    const withdrawTx = tx({
      id: 'tx_withdraw_1',
      txHash: 'origin_hash',
      type: 'withdraw',
      destinationTxHash: 'dest_zcash_hash'
    })
    const hashes = localTxHashSet([withdrawTx])
    assert.equal(hashes.has(normalizeTxHash('origin_hash')), true)
    assert.equal(hashes.has(normalizeTxHash('dest_zcash_hash')), true)
  })

  test('WASM receive matching withdraw destinationTxHash is deduplicated', () => {
    const withdrawTx = tx({
      id: 'tx_withdraw_1',
      txHash: 'near_hash',
      type: 'withdraw',
      destinationTxHash: 'DEST_ZCASH_HASH'
    })
    const wasmReceive = tx({
      id: 'wasm_dest_zcash_hash',
      txHash: 'dest_zcash_hash',
      type: 'receive',
      fromType: 'shielded'
    })
    const hashes = localTxHashSet([withdrawTx])
    assert.equal(isDuplicateWasmRow(wasmReceive, hashes), true)
  })

  test('unrelated WASM receive with same amount is NOT deduplicated (no fuzzy match)', () => {
    const withdrawTx = tx({
      id: 'tx_withdraw_1',
      txHash: 'near_hash',
      type: 'withdraw',
      amount: '1.5',
      destinationTxHash: 'dest_hash_a'
    })
    const unrelatedReceive = tx({
      id: 'wasm_unrelated',
      txHash: 'different_hash',
      type: 'receive',
      amount: '1.5',
      fromType: 'shielded'
    })
    const hashes = localTxHashSet([withdrawTx])
    assert.equal(isDuplicateWasmRow(unrelatedReceive, hashes), false)
  })

  test('withdraw without destinationTxHash does not suppress any receive', () => {
    const withdrawTx = tx({
      id: 'tx_withdraw_1',
      txHash: 'near_hash',
      type: 'withdraw'
    })
    const wasmReceive = tx({
      id: 'wasm_some_hash',
      txHash: 'some_hash',
      type: 'receive',
      fromType: 'shielded'
    })
    const hashes = localTxHashSet([withdrawTx])
    assert.equal(isDuplicateWasmRow(wasmReceive, hashes), false)
  })
})

describe('Withdraw monitor continuation', () => {
  test('withdraw and claim use relay_confirmed as intermediate status', () => {
    assert.equal(getCrossChainCompletionStatus('withdraw'), 'relay_confirmed')
    assert.equal(getCrossChainCompletionStatus('claim'), 'relay_confirmed')
  })

  test('supply and swap are final on relay success', () => {
    assert.equal(getCrossChainCompletionStatus('supply'), 'success')
    assert.equal(getCrossChainCompletionStatus('swap', { destinationChain: 'near' }), 'success')
    assert.equal(
      getCrossChainCompletionStatus('swap', { destinationChain: 'zec' }),
      'relay_confirmed'
    )
  })

  test('Intents owns the final status of supply and swap origin transactions', () => {
    assert.equal(isIntentsSettledTransaction('supply'), true)
    assert.equal(isIntentsSettledTransaction('swap'), true)
    assert.equal(isIntentsSettledTransaction('send'), false)
    assert.equal(isIntentsSettledTransaction('withdraw'), false)
  })

  test('pending withdraw and claim records recover their relay monitor', () => {
    assert.equal(
      needsRelayStatusRecovery(
        tx({ type: 'withdraw', status: 'pending', depositAddress: 'deposit-1' })
      ),
      true
    )
    assert.equal(
      needsRelayStatusRecovery(
        tx({ type: 'claim', status: 'relay_confirmed', depositAddress: 'deposit-2' })
      ),
      true
    )
  })

  test('terminal or destination-bound records do not recover a relay monitor', () => {
    assert.equal(
      needsRelayStatusRecovery(
        tx({ type: 'withdraw', status: 'success', depositAddress: 'deposit-1' })
      ),
      false
    )
    assert.equal(
      needsRelayStatusRecovery(
        tx({
          type: 'withdraw',
          status: 'relay_confirmed',
          depositAddress: 'deposit-1',
          destinationTxHash: 'destination'
        })
      ),
      false
    )
    assert.equal(
      needsRelayStatusRecovery(
        tx({ type: 'send', status: 'pending', depositAddress: 'deposit-1' })
      ),
      false
    )
  })
})
