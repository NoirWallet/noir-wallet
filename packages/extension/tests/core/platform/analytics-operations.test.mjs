import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isZcashOperationAnalyticsContext,
  projectConfidentialPlanResult,
  projectExternalDepositResult,
  projectZcashOperationEvent,
  resolveZcashAnalyticsOperation
} from '../../../src/lib/analytics/operations.ts'
import { ANALYTICS_EVENTS } from '../../../src/lib/analytics/constants.ts'
import { ZCASH_CHAIN_IDS } from '../../../src/core/chains/registry/chain-ids.ts'

test('the execution outcome selects Send, Shield and Swap events independently of UI metadata', () => {
  const operations = [
    ['send', ANALYTICS_EVENTS.SEND_SUCCEEDED, ANALYTICS_EVENTS.SEND_FAILED],
    ['unshield', ANALYTICS_EVENTS.SEND_SUCCEEDED, ANALYTICS_EVENTS.SEND_FAILED],
    ['transfer', ANALYTICS_EVENTS.SEND_SUCCEEDED, ANALYTICS_EVENTS.SEND_FAILED],
    ['shield', ANALYTICS_EVENTS.SHIELD_SUCCEEDED, ANALYTICS_EVENTS.SHIELD_FAILED],
    ['swap', ANALYTICS_EVENTS.SWAP_DEPOSIT_SENT, ANALYTICS_EVENTS.SWAP_FAILED]
  ]
  for (const [operation, success, failure] of operations) {
    const event = projectZcashOperationEvent(operation, 'broadcast', {
      name: 'unreviewed_event',
      inputAmount: '987654321',
      walletAddress: 'private-address'
    })
    assert.equal(event.name, success)
    assert.equal(event.options.chain, 'zcash')
    assert.equal(event.options.hasTransaction, 1)
    const failed = projectZcashOperationEvent(operation, 'failed')
    assert.equal(failed.name, failure)
    assert.equal(failed.options.hasTransaction, 0)
    assert.ok(!JSON.stringify(event).includes('987654321'))
    assert.ok(!JSON.stringify(event).includes('private-address'))
  }
})

test('Shield results follow persisted, settled confidential transitions', () => {
  const plan = {
    planId: 'private-plan-id',
    phase: 'processing',
    operation: 'swap',
    source: { chainId: 'eip155:1' },
    requiresDeposit: false
  }
  const ready = { ...plan, phase: 'ready' }
  const result = projectConfidentialPlanResult(plan, ready)
  assert.equal(result?.name, ANALYTICS_EVENTS.SHIELD_OPERATION_RESULT)
  assert.deepEqual(result?.options.extra, { operation: 'swap', status: 'success' })
  assert.equal(result?.options.hasTransaction, 1)
  assert.equal(result?.options.chain, 'evm')
  assert.equal(
    projectConfidentialPlanResult(plan, {
      ...ready,
      source: { chainId: ZCASH_CHAIN_IDS.mainnet }
    })?.options.chain,
    'zcash'
  )
  assert.equal(projectConfidentialPlanResult(ready, ready), null)
  assert.equal(projectConfidentialPlanResult(plan, { ...plan, phase: 'partial' }), null)
  for (const phase of ['refunded', 'failed', 'expired', 'cancelled']) {
    const terminal = projectConfidentialPlanResult(plan, { ...plan, phase })
    assert.deepEqual(terminal?.options.extra, { operation: 'swap', status: phase })
    assert.equal(terminal?.options.hasTransaction, phase === 'refunded' ? 1 : 0)
  }
  assert.equal(
    projectConfidentialPlanResult(plan, {
      ...plan,
      phase: 'failed',
      errorStatus: 'LOCAL_PROCESSING_FAILED',
      requiresDeposit: true,
      preparedDeposit: { transactionHash: 'private-hash' }
    }),
    null
  )
  assert.deepEqual(
    projectConfidentialPlanResult(
      { ...plan, operation: undefined },
      { ...ready, operation: undefined }
    )?.options.extra,
    { operation: 'cluster', status: 'success' }
  )

  const deposit = {
    depositId: 'private-deposit-id',
    phase: 'awaiting-payment',
    source: { chainId: 'eip155:1' }
  }
  assert.equal(projectExternalDepositResult(deposit, { ...deposit, phase: 'failed' }), null)
  assert.equal(projectExternalDepositResult(deposit, { ...deposit, phase: 'ready' }), null)
  assert.equal(
    projectExternalDepositResult(deposit, { ...deposit, phase: 'ready', settledOutputRaw: '0' }),
    null
  )
  const settled = { ...deposit, phase: 'ready', settledOutputRaw: '1200' }
  assert.deepEqual(projectExternalDepositResult(deposit, settled)?.options.extra, {
    operation: 'deposit',
    status: 'success'
  })
  assert.equal(projectExternalDepositResult(deposit, settled)?.options.hasTransaction, 1)
  assert.equal(projectExternalDepositResult(settled, settled), null)
  assert.deepEqual(
    projectExternalDepositResult({ ...deposit, phase: 'failed' }, { ...deposit, phase: 'refunded' })
      ?.options.extra,
    { operation: 'deposit', status: 'refunded' }
  )
})

test('a persisted transfer binding classifies a Zcash quote as Send', () => {
  const operation = resolveZcashAnalyticsOperation('swap', 'transfer')
  const broadcast = projectZcashOperationEvent(operation, 'broadcast')
  const failed = projectZcashOperationEvent(operation, 'failed')
  assert.equal(broadcast.name, ANALYTICS_EVENTS.SEND_SUCCEEDED)
  assert.deepEqual(broadcast.options.extra, { funding_source: undefined, kind: 'transfer' })
  assert.equal(failed.name, ANALYTICS_EVENTS.SEND_FAILED)
  assert.equal(resolveZcashAnalyticsOperation('swap'), 'swap')
  assert.equal(resolveZcashAnalyticsOperation('unshield'), 'unshield')
})

test('Zcash outcomes preserve controlled hardware, funding and Swap asset context', () => {
  const sent = projectZcashOperationEvent(
    'unshield',
    'broadcast',
    { hardware: true, fundingSource: 'shielded', pageId: 'noir_hardware_sign' },
    'local-receipt'
  )
  assert.deepEqual(sent.options.params, { hardware: true })
  assert.deepEqual(sent.options.extra, { funding_source: 'shielded', kind: 'send' })
  assert.equal(sent.options.idempotencyKey, 'local-receipt')
  const swapped = projectZcashOperationEvent('swap', 'broadcast', {
    direction: 'zec_to_other',
    outputSymbol: 'USDC'
  })
  assert.deepEqual(swapped.options.params, { from_token: 'ZEC', to_token: 'USDC' })
  assert.deepEqual(swapped.options.extra, { direction: 'zec_to_other', sourceFamily: 'zcash' })
})

test('the runtime context contract rejects event overrides and private transaction fields', () => {
  assert.equal(
    isZcashOperationAnalyticsContext({ fundingSource: 'transparent', hardware: true }),
    true
  )
  for (const context of [
    { onSuccess: { name: 'transaction_sent' } },
    { inputAmount: '1' },
    { recipient: 'private-address' },
    { fundingSource: 'unknown' },
    { direction: 'unknown' },
    { hardware: 'ledger' },
    null,
    []
  ])
    assert.equal(isZcashOperationAnalyticsContext(context), false)
})
