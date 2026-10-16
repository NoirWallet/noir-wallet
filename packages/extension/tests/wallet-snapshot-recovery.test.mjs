import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyError,
  isWalletSnapshotRecoveryError,
  WALLET_SNAPSHOT_RECOVERY_MESSAGE
} from '../src/lib/errors.ts'
import { resolveWalletSnapshotRecoveryTarget } from '../src/lib/transaction-replacement.ts'

const wallets = [
  { id: 'wallet_a', accounts: [{ id: 'account_b', birthdayHeight: 100 }] },
  { id: 'wallet_a_account', accounts: [{ id: 'b', birthdayHeight: 200 }] }
]

const failedTransaction = {
  id: 'tx-1',
  status: 'failed',
  txHash: '',
  network: 'mainnet'
}

test('snapshot integrity failures require recovery instead of a blind retry', () => {
  for (const raw of [
    'Missing chunk 0/6 for key: mainnet_wallet_a',
    'Invalid wallet database snapshot: inconsistent chunk manifest',
    'Invalid wallet database snapshot: invalid chunk 0/6',
    'Invalid wallet database snapshot: chunk 0/6 size mismatch',
    'Invalid wallet database snapshot: invalid snapshot bytes'
  ]) {
    const classified = classifyError(raw)
    assert.equal(
      classified.userMessage,
      `${WALLET_SNAPSHOT_RECOVERY_MESSAGE}\n\nOriginal error: ${raw}`
    )
    assert.equal(classified.technicalMessage, raw)
    assert.equal(classified.retryable, false)
    assert.equal(isWalletSnapshotRecoveryError(raw), true)
    assert.deepEqual(classifyError(classified.userMessage), classified)
  }
})

test('transient or write-side errors do not recommend deleting scan state', () => {
  for (const raw of [
    'Failed to serialize wallet database snapshot: empty snapshot',
    'Failed to serialize wallet database snapshot: invalid or empty chunk',
    'Invalid wallet database snapshot: empty snapshot',
    'Invalid wallet database snapshot: unknown failure',
    'QuotaExceededError: Storage full',
    'DataCloneError: Cannot clone snapshot',
    'persist timeout',
    'Network connection failed',
    'WALLET_DIRTY',
    WALLET_SNAPSHOT_RECOVERY_MESSAGE
  ]) {
    assert.equal(isWalletSnapshotRecoveryError(raw), false, raw)
    const classified = classifyError(raw)
    assert.equal(classified.retryable, true, raw)
    assert.equal(isWalletSnapshotRecoveryError(classified.userMessage), false, raw)
  }
  assert.match(
    classifyError('Failed to serialize wallet database snapshot: empty snapshot').userMessage,
    /^Failed to save wallet data\. Please try again\./
  )
})

test('resync target must be uniquely identified by the failed transaction and active network', () => {
  const uniqueWallets = [wallets[0]]
  const target = resolveWalletSnapshotRecoveryTarget(
    'mainnet_wallet_a_account_b',
    'tx-1',
    failedTransaction,
    uniqueWallets,
    'mainnet'
  )
  assert.deepEqual(target, {
    walletId: 'wallet_a',
    accountId: 'account_b',
    network: 'mainnet',
    birthdayHeight: 100
  })

  assert.deepEqual(
    resolveWalletSnapshotRecoveryTarget(
      'mainnet_wallet_a_account_b',
      'tx-1',
      { ...failedTransaction, status: 'pending' },
      uniqueWallets,
      'mainnet'
    ),
    target
  )
  assert.equal(
    resolveWalletSnapshotRecoveryTarget(
      'mainnet_wallet_a_account_b',
      'tx-1',
      { ...failedTransaction, status: 'pending', txHash: 'already-broadcast' },
      uniqueWallets,
      'mainnet'
    ),
    null
  )

  assert.equal(
    resolveWalletSnapshotRecoveryTarget(
      'mainnet_wallet_a_account_b',
      'tx-1',
      failedTransaction,
      wallets,
      'mainnet'
    ),
    null
  )
  assert.equal(
    resolveWalletSnapshotRecoveryTarget(
      'mainnet_wallet_a_account_b',
      'tx-2',
      failedTransaction,
      uniqueWallets,
      'mainnet'
    ),
    null
  )
  assert.equal(
    resolveWalletSnapshotRecoveryTarget(
      'mainnet_wallet_a_account_b',
      'tx-1',
      failedTransaction,
      uniqueWallets,
      'testnet'
    ),
    null
  )
  assert.equal(
    resolveWalletSnapshotRecoveryTarget(
      'mainnet_wallet_a_account_b',
      'tx-1',
      undefined,
      uniqueWallets,
      'mainnet'
    ),
    null
  )
})
