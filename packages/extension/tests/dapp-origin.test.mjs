import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoConnectDApp } from '../src/config/dapp-matches.ts'

test('auto-connects only the exact trusted first-party origin', () => {
  assert.equal(shouldAutoConnectDApp('https://app.zknoir.com'), true)
  for (const origin of [
    'http://app.zknoir.com',
    'https://evil.app.zknoir.com',
    'https://app.zknoir.com.evil.example',
    'https://app.zknoir.com/lending',
    'null'
  ]) {
    assert.equal(shouldAutoConnectDApp(origin), false)
  }
})
