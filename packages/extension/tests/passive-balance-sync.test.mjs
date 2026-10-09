import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computePassiveSyncDelayMinutes,
  shouldRequestPeriodicSync,
  shouldResumeInterruptedSync,
  shouldSchedulePassiveSync
} from '../src/background/passive-sync-policy.ts'

describe('passive balance sync', () => {
  it('runs only when cached wallet state is stale and no sync is active', () => {
    const base = {
      now: 100_000,
      maxAgeMs: 30_000,
      isSchedulerRunning: false
    }

    assert.equal(shouldSchedulePassiveSync({ ...base, lastSyncTime: null }), true)
    assert.equal(shouldSchedulePassiveSync({ ...base, lastSyncTime: 60_000 }), true)
    assert.equal(shouldSchedulePassiveSync({ ...base, lastSyncTime: 80_000 }), false)
    assert.equal(
      shouldSchedulePassiveSync({ ...base, lastSyncTime: 60_000, isSchedulerRunning: true }),
      false
    )
  })

  it('uses activity as a fast path and otherwise waits for a meaningful block gap', () => {
    const idleAtTip = {
      isSchedulerRunning: false,
      isWalletUiOpen: false,
      hasPendingTransactions: false,
      isWalletLocked: false,
      hasPersistedSnapshot: true,
      currentHeight: 2_000_000,
      networkHeight: 2_000_005,
      lastSyncTime: 90_000,
      now: 100_000,
      minBlockGap: 10,
      maxStaleMs: 60_000
    }

    assert.equal(shouldRequestPeriodicSync(idleAtTip), false)
    assert.equal(shouldRequestPeriodicSync({ ...idleAtTip, isWalletUiOpen: true }), true)
    assert.equal(shouldRequestPeriodicSync({ ...idleAtTip, hasPendingTransactions: true }), true)
    assert.equal(shouldRequestPeriodicSync({ ...idleAtTip, networkHeight: 2_000_010 }), true)
    assert.equal(shouldRequestPeriodicSync({ ...idleAtTip, lastSyncTime: 30_000 }), true)
    assert.equal(
      shouldRequestPeriodicSync({
        ...idleAtTip,
        isSchedulerRunning: true,
        isWalletUiOpen: true
      }),
      false
    )
  })

  it('requires a persisted snapshot before syncing a locked wallet', () => {
    const locked = {
      isSchedulerRunning: false,
      isWalletUiOpen: false,
      hasPendingTransactions: false,
      isWalletLocked: true,
      hasPersistedSnapshot: false,
      currentHeight: 0,
      networkHeight: 2_000_000,
      lastSyncTime: null,
      now: 100_000,
      minBlockGap: 10,
      maxStaleMs: 60_000
    }

    assert.equal(shouldRequestPeriodicSync(locked), false)
    assert.equal(shouldRequestPeriodicSync({ ...locked, hasPersistedSnapshot: true }), true)
  })

  it('adds jitter and exponential backoff to one-shot background probes', () => {
    const base = {
      baseMinutes: 30,
      jitterMinutes: 5,
      maxMinutes: 120
    }

    assert.equal(computePassiveSyncDelayMinutes({ ...base, failureCount: 0, randomUnit: 0 }), 25)
    assert.equal(computePassiveSyncDelayMinutes({ ...base, failureCount: 0, randomUnit: 1 }), 35)
    assert.equal(computePassiveSyncDelayMinutes({ ...base, failureCount: 1, randomUnit: 0.5 }), 60)
    assert.equal(computePassiveSyncDelayMinutes({ ...base, failureCount: 8, randomUnit: 1 }), 120)
  })

  it('does not force-resume intentionally budgeted background work on startup', () => {
    const recentJob = {
      now: 100_000,
      updatedAt: 90_000,
      maxAgeMs: 60_000
    }

    assert.equal(shouldResumeInterruptedSync(recentJob), true)
    assert.equal(shouldResumeInterruptedSync({ ...recentJob, resumeOnStartup: false }), false)
    assert.equal(shouldResumeInterruptedSync({ ...recentJob, updatedAt: 30_000 }), false)
  })
})
