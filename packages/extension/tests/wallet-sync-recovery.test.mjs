import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldMarkSyncJobInterrupted } from '../src/lib/sync-job-store.ts'

describe('Wallet sync recovery', () => {
  it('does not reload a durable snapshot just because balance settlement is pending', () => {
    assert.equal(
      shouldMarkSyncJobInterrupted({
        snapshotFailed: false,
        flushFailed: false,
        finalPersistFailed: false,
        skippedFinalPersist: false,
        hasPendingJournal: false,
        hasPendingBalanceSettlement: true
      }),
      false
    )
  })

  it('keeps the sync job interrupted when durable progress is uncertain', () => {
    const base = {
      snapshotFailed: false,
      flushFailed: false,
      finalPersistFailed: false,
      skippedFinalPersist: false,
      hasPendingJournal: false,
      hasPendingBalanceSettlement: false
    }

    assert.equal(shouldMarkSyncJobInterrupted({ ...base, snapshotFailed: true }), true)
    assert.equal(shouldMarkSyncJobInterrupted({ ...base, flushFailed: true }), true)
    assert.equal(shouldMarkSyncJobInterrupted({ ...base, finalPersistFailed: true }), true)
    assert.equal(
      shouldMarkSyncJobInterrupted({
        ...base,
        skippedFinalPersist: true,
        hasPendingJournal: true
      }),
      true
    )
  })
})
