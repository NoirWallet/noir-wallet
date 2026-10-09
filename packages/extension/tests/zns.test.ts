import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { isZnsName, normalizeZnsName } from '../src/lib/zns'
describe('ZNS name input', () => {
  test('detects bare names and supported suffixes', () => {
    assert.equal(isZnsName('alice'), true)
    assert.equal(isZnsName('ALICE'), true)
    assert.equal(isZnsName('alice.zec'), true)
    assert.equal(isZnsName('ALICE.ZEC'), true)
    assert.equal(isZnsName('alice.zcash'), true)
    assert.equal(isZnsName('ALICE.ZCASH'), true)
    assert.equal(isZnsName('my-name_123.zcash'), true)
    assert.equal(isZnsName('  alice.zcash  '), true)
  })

  test('does not match regular addresses', () => {
    assert.equal(isZnsName('u1qqlzrf9abc...'), false)
    assert.equal(isZnsName('t1Rv4eNkJ...'), false)
    assert.equal(isZnsName('utest1abc...'), false)
    assert.equal(isZnsName(`t1${'a'.repeat(33)}`), false)
    assert.equal(isZnsName(`tm${'a'.repeat(33)}`), false)
    assert.equal(isZnsName(''), false)
  })

  test('does not match partial suffixes or invalid bare names', () => {
    assert.equal(isZnsName('alice.zc'), false)
    assert.equal(isZnsName('alice-name'), false)
  })

  test('normalizes all supported forms to the same name', () => {
    assert.equal(normalizeZnsName('ZECHARIAH'), 'zechariah')
    assert.equal(normalizeZnsName('ZECHARIAH.ZEC'), 'zechariah')
    assert.equal(normalizeZnsName('ZECHARIAH.ZCASH'), 'zechariah')
  })
})
