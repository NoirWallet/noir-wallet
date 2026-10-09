import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTransferEstimate,
  parseTransferResult,
  requireSuccessfulTransfer
} from '../src/core/zcash/transfer-result.ts'

describe('unified transfer results', () => {
  it('accepts a multi-step estimate and returns its total fee', () => {
    const estimate = parseTransferEstimate({
      amountZats: '50000',
      feeZats: '25000',
      transactionCount: 2,
      stepFeesZats: ['15000', '10000']
    })

    assert.equal(estimate.feeZats, '25000')
    assert.throws(
      () =>
        parseTransferEstimate({
          amountZats: '50000',
          feeZats: '15000',
          transactionCount: 2,
          stepFeesZats: ['15000', '10000']
        }),
      /fee total/
    )
  })

  it('uses the final transaction while retaining all submitted hashes', () => {
    const result = parseTransferResult({
      status: 'success',
      txIds: ['shield-tx', 'payment-tx'],
      finalTxId: 'payment-tx',
      transactions: [
        { txId: 'shield-tx', status: 'submitted' },
        { txId: 'payment-tx', status: 'submitted' }
      ]
    })

    const successful = requireSuccessfulTransfer(result)
    assert.equal(successful.txHash, 'payment-tx')
    assert.deepEqual(Array.from(successful.txHashes), ['shield-tx', 'payment-tx'])
  })

  it('rejects partial submission without inviting an immediate retry', () => {
    const result = parseTransferResult({
      status: 'partial',
      txIds: ['shield-tx', 'payment-tx'],
      finalTxId: 'payment-tx',
      transactions: [
        { txId: 'shield-tx', status: 'submitted' },
        {
          txId: 'payment-tx',
          status: 'rejected',
          errorCode: -26,
          errorMessage: 'payment rejected'
        }
      ]
    })

    assert.throws(
      () => requireSuccessfulTransfer(result),
      /Wait for wallet sync before retrying.*shield-tx/
    )
  })
})
