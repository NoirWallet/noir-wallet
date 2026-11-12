import { test } from 'node:test'
import { expect } from '@playwright/test'
import {
  SecretBin,
  deviceSlotOf,
  dkgShape,
  isDkgShape,
  parseDkgEnvelopePayload,
  parseDkgFinalPayload,
  parseKeysetSetupPayload,
  parseRosterLockPayload,
  parseRound1EchoPayload,
  rosterSlotOf,
  round1Hash
} from '../../../src/core/multisig/dkg-protocol'
import type { DeviceSlot } from '../../../src/core/multisig/types'
import { loadVaultWasm } from './helpers/vault-wasm'

test.describe('multisig dkg protocol', () => {
  test('maps thresholds to the shapes the wasm supports', () => {
    expect(dkgShape('2-of-2')).toEqual({ participants: 2, threshold: 2 })
    expect(dkgShape('2-of-3')).toEqual({ participants: 3, threshold: 2 })
    expect(dkgShape('3-of-3')).toEqual({ participants: 3, threshold: 3 })
    expect(isDkgShape({ participants: 2, threshold: 3 })).toBe(false)
    expect(isDkgShape({ participants: '3', threshold: 2 })).toBe(false)
  })

  test('converts between device slots and roster slots', () => {
    expect([1, 2, 3].map(s => rosterSlotOf(s as DeviceSlot))).toEqual([0, 1, 2])
    expect([0, 1, 2, 3, -1, 1.5].map(deviceSlotOf)).toEqual([1, 2, 3, null, null, null])
  })

  test('parses roster locks and refuses malformed ones', () => {
    const lock = {
      dkgSessionId: btoa('0123456789abcdef'),
      participants: 3,
      threshold: 2,
      rosterSlot: 2,
      mainnet: false
    }
    expect(parseRosterLockPayload({ ...lock, extra: 1 })).toEqual(lock)
    for (const bad of [
      { ...lock, dkgSessionId: btoa('short') },
      { ...lock, rosterSlot: 0 },
      { ...lock, rosterSlot: 3 },
      { ...lock, threshold: 3, participants: 2 },
      { ...lock, mainnet: 'no' }
    ])
      expect(parseRosterLockPayload(bad)).toBeNull()
  })

  test('parses envelopes, echoes, sealed qsks and fingerprints', () => {
    const hex = 'ab'.repeat(32)
    expect(parseDkgEnvelopePayload({ envelope: 'AAEC' })).toEqual({ envelope: 'AAEC' })
    expect(parseDkgEnvelopePayload({ envelope: 'not base64!' })).toBeNull()
    expect(parseRound1EchoPayload({ round1Hash: hex })).toEqual({ round1Hash: hex })
    expect(parseRound1EchoPayload({ round1Hash: hex.toUpperCase() })).toBeNull()
    expect(parseKeysetSetupPayload({ sealedQsk: 'AAEC' })).toEqual({ sealedQsk: 'AAEC' })
    expect(parseDkgFinalPayload({ fingerprint: hex.slice(2) })).toBeNull()
  })

  test('hashes the round-1 set with SHA-256', async () => {
    expect(await round1Hash(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  test('a secret bin wipes everything it kept', () => {
    const bin = new SecretBin()
    const a = bin.keep(new Uint8Array([1, 2]))
    const b = bin.keep(new Uint8Array([3]))
    expect(bin.size).toBe(2)
    expect(bin.isWiped()).toBe(false)
    bin.wipe()
    expect([...a, ...b]).toEqual([0, 0, 0])
    expect(bin.isWiped()).toBe(true)
  })

  test('the test loader brings up the real wasm in Node', async () => {
    const wasm = await loadVaultWasm()
    expect(wasm.EnvelopeCodec.new_session_id()).toHaveLength(16)
  })
})
