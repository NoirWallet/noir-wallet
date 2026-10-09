import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import {
  useTransactionResultStore,
  resolveZcashResultView
} from '../src/store/transaction-result-store.ts'

const pendingResult = {
  type: 'zcash',
  step: 'pending',
  amount: '1',
  accountKey: 'mainnet_wallet_account',
  transactionId: 'tx_current'
}

beforeEach(() => useTransactionResultStore.getState().clear())

test('a broadcast stays neutral until the matching record confirms', () => {
  const store = useTransactionResultStore.getState()
  store.setResult(pendingResult)
  store.updateStep(
    'submitted',
    { txHash: 'hash' },
    pendingResult.accountKey,
    pendingResult.transactionId
  )

  assert.strictEqual(useTransactionResultStore.getState().data.step, 'submitted')

  store.updateStep('success', {}, 'mainnet_other_account', pendingResult.transactionId)
  store.updateStep('failed', {}, pendingResult.accountKey, 'tx_old')
  store.updateStep('submitted', { txHash: 'old-hash' }, pendingResult.accountKey, 'tx_old')
  store.updateStep('pending')
  assert.strictEqual(useTransactionResultStore.getState().data.step, 'submitted')
  assert.strictEqual(useTransactionResultStore.getState().data.txHash, 'hash')

  store.updateStep('success', {}, pendingResult.accountKey, pendingResult.transactionId)
  store.updateStep('failed', {}, pendingResult.accountKey, pendingResult.transactionId)
  assert.strictEqual(useTransactionResultStore.getState().data.step, 'success')
})

test('reopening a result uses the persisted record', () => {
  const result = { step: 'pending', txHash: 'stale-hash', timestamp: 1000 }
  const record = { status: 'pending', txHash: 'persisted-hash', timestamp: 2000 }
  assert.deepStrictEqual(resolveZcashResultView(result, record), {
    step: 'submitted',
    txHash: 'persisted-hash',
    timestamp: 2000
  })
  assert.strictEqual(
    resolveZcashResultView(result, { ...record, status: 'confirming' }).step,
    'confirming'
  )
  assert.strictEqual(
    resolveZcashResultView(result, { ...record, status: 'success' }).step,
    'success'
  )
  assert.strictEqual(resolveZcashResultView(result, { ...record, status: 'failed' }).step, 'failed')
  assert.strictEqual(
    resolveZcashResultView({ ...result, step: 'confirming' }, record).step,
    'confirming'
  )
  assert.strictEqual(resolveZcashResultView({ ...result, step: 'success' }, record).step, 'success')
})

test('an unknown completion stays pending and accepts its later broadcast result', () => {
  const store = useTransactionResultStore.getState()
  store.setResult(pendingResult)
  store.updateStep(
    'pending',
    { error: 'Transaction status is not available yet.' },
    pendingResult.accountKey,
    pendingResult.transactionId
  )
  assert.strictEqual(useTransactionResultStore.getState().data.step, 'pending')
  assert.strictEqual(
    resolveZcashResultView(useTransactionResultStore.getState().data).step,
    'pending'
  )
  store.updateStep(
    'submitted',
    { txHash: 'later-hash' },
    pendingResult.accountKey,
    pendingResult.transactionId
  )
  assert.strictEqual(useTransactionResultStore.getState().data.step, 'submitted')
  assert.strictEqual(useTransactionResultStore.getState().data.txHash, 'later-hash')
})
