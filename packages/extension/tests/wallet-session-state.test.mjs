import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import {
  SESSION_PASSWORD_STORAGE_KEY,
  didWalletSessionEnd
} from '../src/core/wallet/session-state.ts'

describe('Wallet session lifecycle', () => {
  test('detects only removal of an existing session password', () => {
    assert.strictEqual(
      didWalletSessionEnd(
        { [SESSION_PASSWORD_STORAGE_KEY]: { oldValue: { encrypted: 'value' } } },
        'session'
      ),
      true
    )
    assert.strictEqual(
      didWalletSessionEnd(
        { [SESSION_PASSWORD_STORAGE_KEY]: { newValue: { encrypted: 'value' } } },
        'session'
      ),
      false
    )
    assert.strictEqual(
      didWalletSessionEnd(
        { [SESSION_PASSWORD_STORAGE_KEY]: { oldValue: { encrypted: 'value' } } },
        'local'
      ),
      false
    )
  })
})
