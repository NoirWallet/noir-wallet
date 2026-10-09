import { test as it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSyncTrigger, SYNC_TRIGGERS } from '../src/types/wallet.ts'

describe('sync trigger diagnostics', () => {
  it('preserves known trigger categories', () => {
    for (const trigger of SYNC_TRIGGERS) {
      assert.equal(normalizeSyncTrigger(trigger), trigger)
    }
  })

  it('maps untrusted values to a stable fallback', () => {
    assert.equal(normalizeSyncTrigger('unexpected-trigger'), 'requested')
    assert.equal(normalizeSyncTrigger(null), 'requested')
    assert.equal(normalizeSyncTrigger({ trigger: 'periodic' }), 'requested')
  })
})
