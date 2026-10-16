import assert from 'node:assert/strict'
import test from 'node:test'
import { mapZcashV1TransactionToActivityItem } from '../src/infrastructure/activity/zcash-v1-activity-source.ts'
import {
  getActivityMissingRecipientLabel,
  getActivityTransferRecipient
} from '../src/popup/components/transaction/multichain-activity-presentation.ts'
import {
  getMissingZcashTransactionSource,
  getZcashTransactionRecipient
} from '../src/popup/services/zcash-transaction-parties.ts'

const send = {
  id: 'restored-send',
  type: 'send',
  status: 'success',
  amount: '0.01',
  fee: '0.00015',
  from: '',
  to: '',
  fromType: 'shielded',
  timestamp: 1,
  network: 'mainnet',
  txHash: 'ab'.repeat(32)
}
const scope = { keyDomainId: 'wallet:history', accountId: 'account:history' }

test('missing send recipients stay unknown regardless of the funding pool', () => {
  for (const fromType of ['shielded', 'transparent']) {
    const transaction = { ...send, fromType }
    assert.deepEqual(getZcashTransactionRecipient(transaction), {
      label: 'Unavailable',
      type: null
    })
    const activity = mapZcashV1TransactionToActivityItem(transaction, scope)
    assert.equal(getActivityTransferRecipient(activity), undefined)
    assert.equal(getActivityMissingRecipientLabel(activity), 'Unavailable')
  }
  assert.deepEqual(getMissingZcashTransactionSource('send', 'shielded'), {
    label: 'Shielded Pool',
    type: 'shielded'
  })
})

test('a recovered transparent destination reaches both detail presentations', () => {
  const transaction = { ...send, to: 't1RecipientPublicAddress' }
  assert.equal(getZcashTransactionRecipient(transaction).type, 'transparent')
  const activity = mapZcashV1TransactionToActivityItem(transaction, scope)
  assert.equal(getActivityTransferRecipient(activity), transaction.to)
  assert.equal(getActivityMissingRecipientLabel(activity), null)
  assert.equal(activity.snapshot.sender, undefined)
})

test('incoming shielded history and other chain records retain their existing meaning', () => {
  const receive = { ...send, type: 'receive' }
  assert.deepEqual(getZcashTransactionRecipient(receive), {
    label: 'Shielded Pool',
    type: 'shielded'
  })
  assert.equal(
    getActivityMissingRecipientLabel(mapZcashV1TransactionToActivityItem(receive, scope)),
    null
  )
  const outgoing = mapZcashV1TransactionToActivityItem(send, scope)
  for (const source of ['wallet-v2', 'rpc']) {
    assert.equal(getActivityMissingRecipientLabel({ ...outgoing, source }), null)
  }
})
