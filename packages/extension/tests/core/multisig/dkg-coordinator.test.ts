import { before, test } from 'node:test'
import { expect } from '@playwright/test'
import {
  DkgCoordinatorSession,
  type AcceptOutcome,
  type Round1Outcome,
  type Round2Outcome
} from '../../../src/core/multisig/dkg-coordinator'
import { SecretBin, round1Hash, type VaultWasm } from '../../../src/core/multisig/dkg-protocol'
import { bytesToHex } from '../../../src/lib/bytes'
import { loadVaultWasm } from './helpers/vault-wasm'

type Shape = { participants: 2 | 3; threshold: 2 | 3 }

const SHAPES: readonly Shape[] = [
  { participants: 2, threshold: 2 },
  { participants: 3, threshold: 2 },
  { participants: 3, threshold: 3 }
]

let wasm: VaultWasm

before(async () => {
  wasm = await loadVaultWasm()
})

/**
 * One phone, driven through the raw WASM API only, the way the real app will drive it. Nothing
 * here reaches into the coordinator: every exchange is a Uint8Array.
 */
type Dkg = InstanceType<VaultWasm['Dkg']>

class TestPhone {
  private readonly dkg: Dkg
  private dkg1: ReturnType<Dkg['part1']> | null = null
  private dkg2: ReturnType<Dkg['part2']> | null = null
  private broadcasts: InstanceType<VaultWasm['MessageSet']> | null = null

  constructor(
    shape: Shape,
    readonly slot: number,
    private readonly sessionId: Uint8Array
  ) {
    this.dkg = new wasm.Dkg(shape.participants, shape.threshold, slot)
  }

  round1(): Uint8Array {
    this.dkg1 = this.dkg.part1()
    return this.round1Envelope(1)
  }

  /** The same round-1 contribution wrapped again, with another sequence number. */
  round1Envelope(sequence: number): Uint8Array {
    if (!this.dkg1) throw new Error('round1() first')
    return this.dkg1.broadcast_envelope(this.sessionId, sequence, this.slot)
  }

  echo(bundleEnvelope: Uint8Array): Promise<string> {
    const payload = wasm.EnvelopeCodec.decode(bundleEnvelope)[6] as Uint8Array
    return round1Hash(wasm.MessageSet.from_bytes(payload).to_bytes())
  }

  round2(bundleEnvelope: Uint8Array): Uint8Array {
    if (!this.dkg1) throw new Error('round1() first')
    const payload = wasm.EnvelopeCodec.decode(bundleEnvelope)[6] as Uint8Array
    this.broadcasts = wasm.MessageSet.from_bytes(payload)
    this.dkg2 = this.dkg.part2(this.dkg1.secret(), this.broadcasts)
    return this.dkg2.outgoing_envelope(this.sessionId, 2, this.slot)
  }

  finish(inboxEnvelope: Uint8Array, sealedQsk: Uint8Array, mainnet: boolean): string {
    if (!this.dkg2 || !this.broadcasts) throw new Error('round2() first')
    const payload = wasm.EnvelopeCodec.decode(inboxEnvelope)[6] as Uint8Array
    const incoming = wasm.MessageSet.from_bytes(payload)
    const dkg3 = this.dkg.part3(this.dkg2.secret(), this.broadcasts, incoming)
    const statics = dkg3.statics()
    const coordinatorKey = statics.get(0)
    if (!coordinatorKey) throw new Error('no coordinator static key')
    const qsk = wasm.Sealed.open(
      dkg3.static_secret(),
      coordinatorKey,
      wasm.Sealed.prologue(statics),
      sealedQsk
    )
    return bytesToHex(wasm.Keyset.derive(dkg3.group_verifying_key(), qsk, mainnet, 0)[4])
  }
}

function phonesFor(shape: Shape, sessionId: Uint8Array): TestPhone[] {
  const phones: TestPhone[] = []
  for (let slot = 1; slot < shape.participants; slot += 1) {
    phones.push(new TestPhone(shape, slot, sessionId))
  }
  return phones
}

function complete<T>(outcome: AcceptOutcome<T>): T {
  if (!outcome.complete) throw new Error('expected a complete round')
  return outcome
}

async function runRound1(session: DkgCoordinatorSession, phones: TestPhone[]) {
  let outcome: AcceptOutcome<Round1Outcome> = { complete: false }
  for (const phone of phones) outcome = await session.acceptRound1(phone.slot, phone.round1())
  return complete(outcome)
}

async function runRound2(
  session: DkgCoordinatorSession,
  phones: TestPhone[],
  round1: Round1Outcome
) {
  let outcome: AcceptOutcome<Round2Outcome> = { complete: false }
  for (const phone of phones) {
    const bundle = round1.bundles.get(phone.slot)
    if (!bundle) throw new Error(`no bundle for slot ${phone.slot}`)
    outcome = await session.acceptRound2(phone.slot, phone.round2(bundle))
  }
  return complete(outcome)
}

test.describe('multisig dkg coordinator', () => {
  test('completes every supported mode and agrees with every phone', async () => {
    for (const shape of SHAPES) {
      const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
      const phones = phonesFor(shape, session.sessionId)

      const r1 = await runRound1(session, phones)
      expect([...r1.bundles.keys()]).toEqual(phones.map(phone => phone.slot))
      for (const phone of phones) {
        expect(r1.round1Hash).toBe(await phone.echo(r1.bundles.get(phone.slot)!))
      }

      const r2 = await runRound2(session, phones, r1)
      expect(r2.fingerprint).toMatch(/^[0-9a-f]{64}$/)
      for (const phone of phones) {
        const inbox = r2.inboxes.get(phone.slot)!
        const sealed = r2.sealedQsk.get(phone.slot)!
        expect(phone.finish(inbox, sealed, true)).toBe(r2.fingerprint)
      }
      session.close()
    }
  })

  test('reports incomplete until every phone has sent', async () => {
    const shape = SHAPES[1]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
    const [first] = phonesFor(shape, session.sessionId)
    expect(await session.acceptRound1(first.slot, first.round1())).toEqual({ complete: false })
    session.close()
  })

  test('refuses an envelope from another session', async () => {
    const shape = SHAPES[0]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
    const stranger = new TestPhone(shape, 1, wasm.EnvelopeCodec.new_session_id())
    await expect(session.acceptRound1(1, stranger.round1())).rejects.toThrow()
    expect(session.closed).toBe(true)
    const [phone] = phonesFor(shape, session.sessionId)
    await expect(session.acceptRound1(1, phone.round1())).rejects.toThrow('DKG session is closed')
  })

  test('refuses a second round-1 envelope from the same phone', async () => {
    const shape = SHAPES[1]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
    const [phone] = phonesFor(shape, session.sessionId)
    await session.acceptRound1(phone.slot, phone.round1())
    await expect(session.acceptRound1(phone.slot, phone.round1Envelope(5))).rejects.toThrow()
    expect(session.closed).toBe(true)
  })

  test('refuses an envelope whose sender is not the transport slot', async () => {
    const shape = SHAPES[1]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
    const [phone] = phonesFor(shape, session.sessionId)
    await expect(session.acceptRound1(2, phone.round1())).rejects.toThrow()
    expect(session.closed).toBe(true)
  })

  test('refuses round 2 before round 1 is complete', async () => {
    const shape = SHAPES[1]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
    const [phone] = phonesFor(shape, session.sessionId)
    await session.acceptRound1(phone.slot, phone.round1())
    await expect(session.acceptRound2(phone.slot, phone.round1Envelope(2))).rejects.toThrow(
      /round 1/
    )
    expect(session.closed).toBe(true)
  })

  test('refuses a tampered round-2 package', async () => {
    const shape = SHAPES[0]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true })
    const phones = phonesFor(shape, session.sessionId)
    const r1 = await runRound1(session, phones)
    const envelope = phones[0].round2(r1.bundles.get(1)!)
    envelope[envelope.length - 1] ^= 1
    await expect(session.acceptRound2(1, envelope)).rejects.toThrow()
    expect(session.closed).toBe(true)
  })

  test('returns no key material', async () => {
    const shape = SHAPES[0]
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: false })
    const phones = phonesFor(shape, session.sessionId)
    const r1 = await runRound1(session, phones)
    expect(Object.keys(r1).sort()).toEqual(['bundles', 'complete', 'round1Hash'])
    const r2 = await runRound2(session, phones, r1)
    expect(Object.keys(r2).sort()).toEqual(['complete', 'fingerprint', 'inboxes', 'sealedQsk'])
    session.close()
  })

  test('wipes every retained secret on close', async () => {
    const shape = SHAPES[1]
    const bin = new SecretBin()
    const session = DkgCoordinatorSession.open(wasm, { ...shape, mainnet: true }, bin)
    const phones = phonesFor(shape, session.sessionId)
    const r1 = await runRound1(session, phones)
    await runRound2(session, phones, r1)
    expect(bin.size).toBeGreaterThanOrEqual(4)
    expect(bin.isWiped()).toBe(false)
    expect(session.closed).toBe(false)
    session.close()
    expect(bin.isWiped()).toBe(true)
    expect(session.closed).toBe(true)
    session.close()
    await expect(session.acceptRound1(1, phones[0].round1Envelope(9))).rejects.toThrow(
      'DKG session is closed'
    )
  })
})
