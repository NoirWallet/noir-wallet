import test from 'node:test'
import assert from 'node:assert/strict'
import { getRheaSwapProgressStatus, mergeSwapProgressStatus } from '../src/lib/swap-progress.ts'
import { getOnchainResultAction } from '../src/popup/services/onchain-transaction-result.ts'

const hash = (role, value, status = 'broadcast') => ({
  role,
  status,
  evidence: { transactionHash: value }
})

test('RHEA completion recovers both explorer hashes before origin confirmation', () => {
  const result = getRheaSwapProgressStatus(
    [
      hash('origin', 'source'),
      hash('origin', 'source'),
      hash('origin', 'source-2'),
      { role: 'relay', status: 'final' },
      hash('destination', 'destination', 'final')
    ],
    { status: 'PROCESSING', destinationAsset: 'eip155:1/slip44:60' }
  )
  assert.equal(result.status, 'SUCCESS')
  assert.deepEqual(result.swapDetails.originChainTxHashes, [
    { hash: 'source' },
    { hash: 'source-2' }
  ])
  assert.deepEqual(result.swapDetails.destinationChainTxHashes, [{ hash: 'destination' }])
  assert.equal(result.destinationAsset, 'eip155:1/slip44:60')
})

test('partial and stale notifications retain hashes and terminal progress', () => {
  const current = {
    status: 'SUCCESS',
    swapDetails: {
      amountOutFormatted: '1',
      originChainTxHashes: [{ hash: 'source' }],
      destinationChainTxHashes: [{ hash: 'destination' }]
    }
  }
  assert.strictEqual(mergeSwapProgressStatus(current, { status: 'PROCESSING' }), current)
  const updated = mergeSwapProgressStatus(current, {
    status: 'PROCESSING',
    swapDetails: {
      originChainTxHashes: [],
      destinationChainTxHashes: [{ hash: 'destination-2' }]
    }
  })
  assert.equal(updated.status, 'SUCCESS')
  assert.equal(updated.swapDetails.amountOutFormatted, '1')
  assert.deepEqual(updated.swapDetails.originChainTxHashes, [{ hash: 'source' }])
  assert.deepEqual(updated.swapDetails.destinationChainTxHashes, [
    { hash: 'destination' },
    { hash: 'destination-2' }
  ])
  assert.strictEqual(mergeSwapProgressStatus(updated, updated), updated)
})

test('persisted processing, failure and refund evidence recover result progress', () => {
  const base = { status: 'PENDING_DEPOSIT' }
  assert.equal(
    getRheaSwapProgressStatus([{ role: 'relay', status: 'confirming' }], base).status,
    'PROCESSING'
  )
  assert.equal(
    getRheaSwapProgressStatus([{ role: 'relay', status: 'failed' }], base).status,
    'FAILED'
  )
  assert.equal(
    getRheaSwapProgressStatus(
      [
        { role: 'relay', status: 'failed' },
        { role: 'refund', status: 'final' }
      ],
      base
    ).status,
    'REFUNDED'
  )
  assert.equal(
    getRheaSwapProgressStatus([hash('destination', 'destination')], base).status,
    'PENDING_DEPOSIT'
  )
})

test('pending public transfer opens explorer while interruption and completion retain their actions', () => {
  for (const status of ['broadcast', 'confirming']) {
    assert.equal(getOnchainResultAction(status, 'https://etherscan.io/tx/hash'), 'explorer')
    assert.equal(getOnchainResultAction(status, null), 'activity')
  }
  assert.equal(getOnchainResultAction('signed', 'https://etherscan.io/tx/hash'), 'retry')
  assert.equal(getOnchainResultAction('final', 'https://etherscan.io/tx/hash'), 'done')
  assert.equal(getOnchainResultAction('failed', 'https://etherscan.io/tx/hash'), 'done')
})
