import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceMonitorState,
  createEmptySnapshot,
  markNotificationSent,
  REMINDER_INTERVAL_MS,
  type MonitorSnapshot
} from '../src/alert-state'
import type { CheckName, ProbeResult } from '../src/types'

test('opens after two failed runs, reminds after one hour, and recovers after two successes', () => {
  let snapshot = createEmptySnapshot()

  const firstFailure = advanceMonitorState(snapshot, [failure('deltarpc')], 1_000)
  assert.deepEqual(firstFailure.notifications, [])

  const opened = advanceMonitorState(firstFailure.snapshot, [failure('deltarpc')], 3_000)
  assert.equal(opened.notifications.length, 1)
  assert.equal(opened.notifications[0].kind, 'opened')
  snapshot = markNotificationSent(opened.snapshot, opened.notifications[0], 3_000)

  const beforeReminder = advanceMonitorState(
    snapshot,
    [failure('deltarpc')],
    3_000 + REMINDER_INTERVAL_MS - 1
  )
  assert.deepEqual(beforeReminder.notifications, [])

  const reminder = advanceMonitorState(
    beforeReminder.snapshot,
    [failure('deltarpc')],
    3_000 + REMINDER_INTERVAL_MS
  )
  assert.equal(reminder.notifications[0].kind, 'reminder')
  snapshot = markNotificationSent(
    reminder.snapshot,
    reminder.notifications[0],
    3_000 + REMINDER_INTERVAL_MS
  )

  const firstSuccess = advanceMonitorState(snapshot, [success('deltarpc')], 2_000_000)
  assert.deepEqual(firstSuccess.notifications, [])
  const recovered = advanceMonitorState(firstSuccess.snapshot, [success('deltarpc')], 2_001_000)
  assert.equal(recovered.notifications[0].kind, 'recovery')
})

test('retries an unsent opening notification on the next run', () => {
  const firstFailure = advanceMonitorState(createEmptySnapshot(), [failure('deltarpc')], 1)
  const snapshot = advanceMonitorState(firstFailure.snapshot, [failure('deltarpc')], 2).snapshot

  const retry = advanceMonitorState(snapshot, [failure('deltarpc')], 3)
  assert.equal(retry.notifications.length, 1)
  assert.equal(retry.notifications[0].kind, 'opened')
})

test('suppresses an isolated failed run and resets the failure streak after recovery', () => {
  const firstFailure = advanceMonitorState(createEmptySnapshot(), [failure('deltarpc')], 1)
  assert.deepEqual(firstFailure.notifications, [])

  const recovered = advanceMonitorState(firstFailure.snapshot, [success('deltarpc')], 2)
  assert.deepEqual(recovered.notifications, [])

  const nextFailure = advanceMonitorState(recovered.snapshot, [failure('deltarpc')], 3)
  assert.deepEqual(nextFailure.notifications, [])
  assert.deepEqual(
    Object.fromEntries(
      Object.keys({
        consecutiveFailures: 1,
        incidentOpen: false
      }).map(key => [
        key,
        nextFailure.snapshot.checks['zcash-mainnet:deltarpc:GetLatestBlock'][key]
      ])
    ),
    {
      consecutiveFailures: 1,
      incidentOpen: false
    }
  )
})

test('aggregates checks from multiple providers into one notification', () => {
  const snapshot: MonitorSnapshot = createEmptySnapshot()
  const firstFailure = advanceMonitorState(
    snapshot,
    [failure('deltarpc', 'GetSubtreeRoots'), failure('chainsafe', 'GetSubtreeRoots')],
    1
  )
  const { notifications } = advanceMonitorState(
    firstFailure.snapshot,
    [failure('deltarpc', 'GetSubtreeRoots'), failure('chainsafe', 'GetSubtreeRoots')],
    2
  )

  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].kind, 'opened')
  assert.deepEqual(
    notifications[0].items.map(item => item.targetId),
    ['chainsafe', 'deltarpc']
  )
})

test('removes alert state for checks that are no longer monitored', () => {
  const firstFailure = advanceMonitorState(createEmptySnapshot(), [failure('retired-provider')], 1)
  const opened = advanceMonitorState(firstFailure.snapshot, [failure('retired-provider')], 2)
  const snapshot = markNotificationSent(opened.snapshot, opened.notifications[0], 2)

  const nextRun = advanceMonitorState(snapshot, [success('deltarpc')], 2 + REMINDER_INTERVAL_MS)

  assert.deepEqual(nextRun.notifications, [])
  assert.equal(
    Object.hasOwn(nextRun.snapshot.checks, 'zcash-mainnet:retired-provider:GetLatestBlock'),
    false
  )
})

function failure(targetId: string, check: CheckName = 'GetLatestBlock'): ProbeResult {
  return {
    chainId: 'zcash-mainnet',
    chain: 'zcash',
    network: 'mainnet',
    targetId,
    targetLabel: targetId === 'deltarpc' ? 'DeltaRPC' : 'ChainSafe',
    check,
    outcome: 'failure',
    attempts: 3,
    elapsedMs: 8_000,
    error: 'Timed out',
    observedHeight: 3_100_000
  }
}

function success(targetId: string, check: CheckName = 'GetLatestBlock'): ProbeResult {
  return {
    chainId: 'zcash-mainnet',
    chain: 'zcash',
    network: 'mainnet',
    targetId,
    targetLabel: targetId === 'deltarpc' ? 'DeltaRPC' : 'ChainSafe',
    check,
    outcome: 'success',
    attempts: 1,
    elapsedMs: 120,
    observedHeight: 3_100_001
  }
}
