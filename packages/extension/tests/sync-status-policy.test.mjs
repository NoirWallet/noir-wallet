import { test as it, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  getVisibleSyncReason,
  isSyncOccupyingWallet,
  shouldShowSyncPreflight
} from '../src/background/sync-status-policy.ts'

describe('sync status policy', () => {
  it('does not make owned preflight wait on itself while preserving scan and cross-context guards', () => {
    assert.equal(isSyncOccupyingWallet(false, true, true), false)
    assert.equal(isSyncOccupyingWallet(true, true, true), true)
    assert.equal(isSyncOccupyingWallet(true, false, true), true)
    assert.equal(isSyncOccupyingWallet(false, true, false), true)
    assert.equal(isSyncOccupyingWallet(false, false, false), false)
  })
  it('keeps explicit preflight visible without making passive catch-up noisy', () => {
    assert.equal(shouldShowSyncPreflight('requested', false), true)
    assert.equal(shouldShowSyncPreflight('wallet-change', true), true)
    assert.equal(shouldShowSyncPreflight('wallet-change', false), true)
    assert.equal(shouldShowSyncPreflight('periodic', true), false)
    assert.equal(shouldShowSyncPreflight('transaction', true), false)
  })
  it('hides a previous error while a new sync attempt is active', () => {
    assert.equal(getVisibleSyncReason(true, 'network_error'), null)
    assert.equal(getVisibleSyncReason(true, 'wallet_state_error'), null)
  })

  it('preserves the latest error when no sync attempt is active', () => {
    assert.equal(getVisibleSyncReason(false, 'network_error'), 'network_error')
    assert.equal(getVisibleSyncReason(false, 'wallet_state_error'), 'wallet_state_error')
    assert.equal(getVisibleSyncReason(false, undefined), null)
  })
})
