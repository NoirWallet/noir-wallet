import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SPENDABILITY_MANUAL_RESYNC_REQUIRED_MESSAGE,
  SPENDABILITY_REPAIR_STARTED_MESSAGE,
  SPENDABILITY_SYNC_IN_PROGRESS_MESSAGE,
  runSpendabilitySnapshotRefresh,
  runWithSpendabilityRecovery
} from '../src/core/wallet/spendability-recovery.ts'

describe('spendability metadata recovery', () => {
  const inconsistent = () => new Error('WALLET_SPENDABILITY_INCONSISTENT')
  const isMetadataError = error => String(error).includes('WALLET_SPENDABILITY_INCONSISTENT')

  it('waits for an active sync and returns the successful retry without resyncing', async () => {
    let syncing = true
    let operationCalls = 0
    let recoveryCalls = 0

    const result = await runWithSpendabilityRecovery({
      operation: async () => {
        operationCalls += 1
        if (operationCalls === 1) throw inconsistent()
        return 'ok'
      },
      isMetadataError,
      isSyncing: async () => syncing,
      waitForSyncIdle: async () => {
        syncing = false
        return true
      },
      recover: async () => {
        recoveryCalls += 1
      }
    })

    assert.equal(result, 'ok')
    assert.equal(operationCalls, 2)
    assert.equal(recoveryCalls, 0)
  })

  it('requires two consecutive idle failures before starting metadata repair', async () => {
    let operationCalls = 0
    let recoveryCalls = 0

    await assert.rejects(
      runWithSpendabilityRecovery({
        operation: async () => {
          operationCalls += 1
          throw inconsistent()
        },
        isMetadataError,
        isSyncing: async () => false,
        waitForSyncIdle: async () => true,
        recover: async () => {
          recoveryCalls += 1
        }
      }),
      new RegExp(SPENDABILITY_REPAIR_STARTED_MESSAGE)
    )

    assert.equal(operationCalls, 2)
    assert.equal(recoveryCalls, 1)
  })

  it('does not count the sync-time failure toward the two idle confirmations', async () => {
    let syncing = true
    let operationCalls = 0
    let recoveryCalls = 0

    await assert.rejects(
      runWithSpendabilityRecovery({
        operation: async () => {
          operationCalls += 1
          throw inconsistent()
        },
        isMetadataError,
        isSyncing: async () => syncing,
        waitForSyncIdle: async () => {
          syncing = false
          return true
        },
        recover: async () => {
          recoveryCalls += 1
        }
      }),
      new RegExp(SPENDABILITY_REPAIR_STARTED_MESSAGE)
    )

    assert.equal(operationCalls, 3)
    assert.equal(recoveryCalls, 1)
  })

  it('never starts metadata repair when the active sync does not become idle in time', async () => {
    let recoveryCalls = 0

    await assert.rejects(
      runWithSpendabilityRecovery({
        operation: async () => {
          throw inconsistent()
        },
        isMetadataError,
        isSyncing: async () => true,
        waitForSyncIdle: async () => false,
        recover: async () => {
          recoveryCalls += 1
        }
      }),
      new RegExp(SPENDABILITY_SYNC_IN_PROGRESS_MESSAGE)
    )

    assert.equal(recoveryCalls, 0)
  })

  it('refreshes the persisted snapshot once without requesting another automatic repair', async () => {
    let attempted = false
    let reloadCalls = 0
    let catchUpCalls = 0
    const options = {
      hasAttempted: () => attempted,
      markAttempted: () => {
        attempted = true
      },
      clearAttempt: () => {
        attempted = false
      },
      reloadPersistedSnapshot: async () => {
        reloadCalls += 1
      },
      startCatchUpSync: () => {
        catchUpCalls += 1
      }
    }

    await runSpendabilitySnapshotRefresh(options)
    await assert.rejects(
      runSpendabilitySnapshotRefresh(options),
      new RegExp(SPENDABILITY_MANUAL_RESYNC_REQUIRED_MESSAGE)
    )

    assert.equal(reloadCalls, 1)
    assert.equal(catchUpCalls, 1)
  })

  it('allows the snapshot refresh to retry after a transient reload failure', async () => {
    let attempted = false
    let reloadCalls = 0
    const options = {
      hasAttempted: () => attempted,
      markAttempted: () => {
        attempted = true
      },
      clearAttempt: () => {
        attempted = false
      },
      reloadPersistedSnapshot: async () => {
        reloadCalls += 1
        if (reloadCalls === 1) throw new Error('reload failed')
      },
      startCatchUpSync: () => {}
    }

    await assert.rejects(runSpendabilitySnapshotRefresh(options), /reload failed/)
    await runSpendabilitySnapshotRefresh(options)

    assert.equal(reloadCalls, 2)
    assert.equal(attempted, true)
  })
})
