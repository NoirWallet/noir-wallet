import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { detectZcashAddressType, sanitizeMemoForRecipient } from '../src/lib/zcash-memo'

describe('ZIP-321 memo rules', () => {
  test('removes memos from mainnet and testnet transparent recipients', () => {
    assert.equal(sanitizeMemoForRecipient('t1transparent', 'Lending Supply'), undefined)
    assert.equal(sanitizeMemoForRecipient('t2transparent', 'Lending Supply'), undefined)
    assert.equal(sanitizeMemoForRecipient('t3transparent', 'Swap ZEC → NEAR'), undefined)
    assert.equal(sanitizeMemoForRecipient('tmtransparent', 'Lending Supply'), undefined)
    assert.equal(sanitizeMemoForRecipient('tex1transparent', 'Private memo'), undefined)
    assert.equal(sanitizeMemoForRecipient('textest1transparent', 'Private memo'), undefined)
  })

  test('preserves memos for shielded and unified recipients', () => {
    assert.equal(sanitizeMemoForRecipient('u1shielded', 'Private memo'), 'Private memo')
    assert.equal(sanitizeMemoForRecipient('utest1shielded', 'Private memo'), 'Private memo')
    assert.equal(sanitizeMemoForRecipient('zs1shielded', 'Private memo'), 'Private memo')
    assert.equal(sanitizeMemoForRecipient('ztestsaplingshielded', 'Private memo'), 'Private memo')
  })

  test('classifies mainnet and testnet shielded address prefixes', () => {
    assert.equal(detectZcashAddressType('u1shielded'), 'shielded')
    assert.equal(detectZcashAddressType('utest1shielded'), 'shielded')
    assert.equal(detectZcashAddressType('zs1shielded'), 'shielded')
    assert.equal(detectZcashAddressType('ztestsaplingshielded'), 'shielded')
    assert.equal(detectZcashAddressType('tmtransparent'), 'transparent')
    assert.equal(detectZcashAddressType('tex1transparent'), 'transparent')
    assert.equal(detectZcashAddressType('textest1transparent'), 'transparent')
  })
})
