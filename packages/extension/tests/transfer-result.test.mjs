import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isTransactionSubmissionUnknown,
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

  it('keeps an uncertain submission pending even when no step was confirmed', () => {
    const result = parseTransferResult({
      status: 'unknown',
      txIds: ['possible-tx'],
      finalTxId: 'possible-tx',
      transactions: [{ txId: 'possible-tx', status: 'unknown' }]
    })

    assert.throws(
      () => requireSuccessfulTransfer(result),
      error =>
        error.name === 'TransactionSubmissionUnknown' &&
        error.txId === 'possible-tx' &&
        /Check Activity before trying again/.test(error.message)
    )
    assert.throws(
      () =>
        parseTransferResult({
          ...result,
          status: 'failed'
        }),
      /status does not match/
    )
  })

  it('retains earlier submitted hashes when a later step is uncertain', () => {
    const result = parseTransferResult({
      status: 'unknown',
      txIds: ['submitted-tx', 'possible-tx'],
      finalTxId: 'possible-tx',
      transactions: [
        { txId: 'submitted-tx', status: 'submitted' },
        { txId: 'possible-tx', status: 'unknown' }
      ]
    })
    assert.throws(
      () => requireSuccessfulTransfer(result),
      error =>
        error.name === 'TransactionSubmissionUnknown' &&
        error.txId === 'possible-tx' &&
        error.txIds.join(',') === 'submitted-tx,possible-tx'
    )
  })

  it('preserves the submission cause and accepts a raw WASM error without txIds', () => {
    const result = parseTransferResult({
      status: 'unknown',
      txIds: ['possible-tx'],
      finalTxId: 'possible-tx',
      transactions: [
        {
          txId: 'possible-tx',
          status: 'unknown',
          errorMessage: 'privacy broadcast timed out'
        }
      ]
    })
    assert.throws(
      () => requireSuccessfulTransfer(result),
      error =>
        isTransactionSubmissionUnknown(error) && error.message === 'privacy broadcast timed out'
    )

    const rawWasmError = new Error('privacy broadcast timed out')
    rawWasmError.name = 'TransactionSubmissionUnknown'
    rawWasmError.txId = 'possible-tx'
    assert.equal(isTransactionSubmissionUnknown(rawWasmError), true)
    assert.equal(rawWasmError.txIds, undefined)
    assert.equal(
      isTransactionSubmissionUnknown(
        Object.assign(new Error('missing hash'), {
          name: 'TransactionSubmissionUnknown'
        })
      ),
      false
    )
  })
})
