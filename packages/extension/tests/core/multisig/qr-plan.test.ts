import { test } from 'node:test'
import { expect } from '@playwright/test'
import {
  buildQrCeremonySteps,
  buildQrPairingSteps,
  qrStepCounter
} from '../../../src/core/multisig/qr-plan'

test.describe('multisig qr-plan', () => {
  test('pairing is always invite then reply', () => {
    const [a, b] = buildQrPairingSteps(2)
    expect([a.kind, a.messageType, a.slots]).toEqual(['show', 'PAIR_INVITE', [2]])
    expect([b.kind, b.messageType, b.slots]).toEqual(['scan', 'PAIR_RESPONSE', [2]])
  })

  test('2-of-2 ceremony is two steps and never asks for a manual r1 check', () => {
    const steps = buildQrCeremonySteps('2-of-2')
    expect(steps.map(s => s.kind)).toEqual(['show', 'scan'])
    expect(steps.some(s => s.kind === 'verify')).toBe(false)
  })

  test('x-of-3 ceremony is six steps with the r1 check before any scan', () => {
    for (const t of ['2-of-3', '3-of-3'] as const) {
      const kinds = buildQrCeremonySteps(t).map(s => s.kind)
      expect(kinds).toEqual(['show', 'verify', 'scan', 'scan', 'show', 'show'])
    }
  })

  test('2-of-2 ceremony carries its messages, slots and titles', () => {
    const steps = buildQrCeremonySteps('2-of-2')
    expect(steps.map(s => [s.kind, s.messageType, s.slots, s.title, s.stage])).toEqual([
      ['show', 'DKG_R2_INBOX', [2], 'Shares', null],
      ['scan', 'DKG_FINAL', [2], 'Final Verification', null]
    ])
  })

  test('x-of-3 ceremony carries its messages, slots and titles', () => {
    for (const t of ['2-of-3', '3-of-3'] as const) {
      expect(
        buildQrCeremonySteps(t).map(s => [s.kind, s.messageType, s.slots, s.title, s.stage])
      ).toEqual([
        ['show', 'DKG_R1_BUNDLE', [2, 3], 'Group setup', null],
        ['verify', null, [], 'Verify setup', 'r1'],
        ['scan', 'DKG_R2_BATCH', [2], 'Collect shares', null],
        ['scan', 'DKG_R2_BATCH', [3], 'Collect shares', null],
        ['show', 'DKG_R2_INBOX', [2], 'Encrypted shares', null],
        ['show', 'DKG_R2_INBOX', [3], 'Encrypted shares', null]
      ])
    }
  })

  test('2-of-2 counter continues 3/4 and 4/4 after pairing', () => {
    expect(qrStepCounter('2-of-2', 'pairing', 0)).toEqual({ current: 1, total: 4 })
    expect(qrStepCounter('2-of-2', 'pairing', 1)).toEqual({ current: 2, total: 4 })
    expect(qrStepCounter('2-of-2', 'ceremony', 0)).toEqual({ current: 3, total: 4 })
    expect(qrStepCounter('2-of-2', 'ceremony', 1)).toEqual({ current: 4, total: 4 })
  })

  test('x-of-3 pairing counts per phone and the ceremony counts six steps', () => {
    expect(qrStepCounter('2-of-3', 'pairing', 0)).toEqual({ current: 1, total: 2 })
    expect(qrStepCounter('3-of-3', 'pairing', 1)).toEqual({ current: 2, total: 2 })
    expect(qrStepCounter('2-of-3', 'ceremony', 0)).toEqual({ current: 1, total: 6 })
    expect(qrStepCounter('2-of-3', 'ceremony', 5)).toEqual({ current: 6, total: 6 })
  })

  test('qrStepCounter rejects indexes outside the phase', () => {
    expect(() => qrStepCounter('2-of-2', 'pairing', 2)).toThrow(RangeError)
    expect(() => qrStepCounter('2-of-2', 'ceremony', 2)).toThrow(RangeError)
    expect(() => qrStepCounter('3-of-3', 'ceremony', 6)).toThrow(RangeError)
    expect(() => qrStepCounter('3-of-3', 'ceremony', -1)).toThrow(RangeError)
  })
})
