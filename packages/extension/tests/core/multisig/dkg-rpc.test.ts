import { before, test } from 'node:test'
import { expect } from '@playwright/test'
import {
  createVaultDkgRpcHandler,
  isVaultDkgMethod,
  type VaultDkgMethod,
  type VaultDkgRpcHandler,
  type VaultDkgSchema
} from '../../../src/core/multisig/dkg-rpc'
import { round1Hash, type VaultWasm } from '../../../src/core/multisig/dkg-protocol'
import { base64ToBytes, bytesToBase64, bytesToHex } from '../../../src/lib/bytes'
import { loadVaultWasm } from './helpers/vault-wasm'

type Shape = { participants: 2 | 3; threshold: 2 | 3 }
type Dkg = InstanceType<VaultWasm['Dkg']>

let wasm: VaultWasm

before(async () => {
  wasm = await loadVaultWasm()
})

// Every request and response crosses a JSON boundary, as chrome.runtime messages do.
async function call<M extends VaultDkgMethod>(
  handler: VaultDkgRpcHandler,
  method: M,
  payload: unknown
): Promise<VaultDkgSchema[M]['response']> {
  const result = await handler.handle(method, JSON.parse(JSON.stringify(payload)))
  return JSON.parse(JSON.stringify(result))
}

/** A phone that only ever sees base64 strings, like the extension's transport shell. */
class Phone {
  private readonly dkg: Dkg
  private readonly sessionId: Uint8Array
  private dkg1: ReturnType<Dkg['part1']> | null = null
  private dkg2: ReturnType<Dkg['part2']> | null = null
  private broadcasts: InstanceType<VaultWasm['MessageSet']> | null = null

  constructor(
    shape: Shape,
    readonly slot: number,
    sessionId: string
  ) {
    this.sessionId = base64ToBytes(sessionId)
    this.dkg = new wasm.Dkg(shape.participants, shape.threshold, slot)
  }

  round1(): string {
    this.dkg1 = this.dkg.part1()
    return bytesToBase64(this.dkg1.broadcast_envelope(this.sessionId, 1, this.slot))
  }

  echo(bundle: string): Promise<string> {
    const payload = wasm.EnvelopeCodec.decode(base64ToBytes(bundle))[6] as Uint8Array
    return round1Hash(wasm.MessageSet.from_bytes(payload).to_bytes())
  }

  round2(bundle: string): string {
    if (!this.dkg1) throw new Error('round1() first')
    const payload = wasm.EnvelopeCodec.decode(base64ToBytes(bundle))[6] as Uint8Array
    this.broadcasts = wasm.MessageSet.from_bytes(payload)
    this.dkg2 = this.dkg.part2(this.dkg1.secret(), this.broadcasts)
    return bytesToBase64(this.dkg2.outgoing_envelope(this.sessionId, 2, this.slot))
  }

  finish(inbox: string, sealedQsk: string, mainnet: boolean): string {
    if (!this.dkg2 || !this.broadcasts) throw new Error('round2() first')
    const payload = wasm.EnvelopeCodec.decode(base64ToBytes(inbox))[6] as Uint8Array
    const dkg3 = this.dkg.part3(
      this.dkg2.secret(),
      this.broadcasts,
      wasm.MessageSet.from_bytes(payload)
    )
    const statics = dkg3.statics()
    const coordinatorKey = statics.get(0)
    if (!coordinatorKey) throw new Error('no coordinator static key')
    const qsk = wasm.Sealed.open(
      dkg3.static_secret(),
      coordinatorKey,
      wasm.Sealed.prologue(statics),
      base64ToBytes(sealedQsk)
    )
    return bytesToHex(wasm.Keyset.derive(dkg3.group_verifying_key(), qsk, mainnet, 0)[4])
  }
}

const OPEN_2_OF_3 = { participants: 3, threshold: 2, mainnet: true } as const

test.describe('multisig dkg rpc handler', () => {
  test('names its four methods', () => {
    for (const method of [
      'vault.dkg.open',
      'vault.dkg.acceptRound1',
      'vault.dkg.acceptRound2',
      'vault.dkg.close'
    ]) {
      expect(isVaultDkgMethod(method)).toBe(true)
    }
    expect(isVaultDkgMethod('vault.dkg.nope')).toBe(false)
    expect(isVaultDkgMethod('mnemonic.validate')).toBe(false)
  })

  test('runs a 2-of-3 ceremony through JSON-shaped calls', async () => {
    const handler = createVaultDkgRpcHandler(wasm)
    const { sessionId } = await call(handler, 'vault.dkg.open', OPEN_2_OF_3)
    expect(base64ToBytes(sessionId)).toHaveLength(16)
    expect(handler.sessionCount).toBe(1)
    const phones = [1, 2].map(slot => new Phone(OPEN_2_OF_3, slot, sessionId))

    const [first, second] = phones
    expect(
      await call(handler, 'vault.dkg.acceptRound1', {
        sessionId,
        senderSlot: first.slot,
        envelope: first.round1()
      })
    ).toEqual({ complete: false })
    const r1 = await call(handler, 'vault.dkg.acceptRound1', {
      sessionId,
      senderSlot: second.slot,
      envelope: second.round1()
    })
    if (!r1.complete) throw new Error('round 1 should be complete')
    expect(Object.keys(r1.bundles).sort()).toEqual(['1', '2'])
    for (const phone of phones) {
      expect(r1.round1Hash).toBe(await phone.echo(r1.bundles[String(phone.slot)]))
    }

    let r2: VaultDkgSchema['vault.dkg.acceptRound2']['response'] = { complete: false }
    for (const phone of phones) {
      r2 = await call(handler, 'vault.dkg.acceptRound2', {
        sessionId,
        senderSlot: phone.slot,
        envelope: phone.round2(r1.bundles[String(phone.slot)])
      })
    }
    if (!r2.complete) throw new Error('round 2 should be complete')
    expect(r2.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    for (const phone of phones) {
      const slot = String(phone.slot)
      expect(phone.finish(r2.inboxes[slot], r2.sealedQsk[slot], true)).toBe(r2.fingerprint)
    }

    expect(await call(handler, 'vault.dkg.close', { sessionId })).toBe(true)
    expect(handler.sessionCount).toBe(0)
  })

  test('refuses malformed requests', async () => {
    const handler = createVaultDkgRpcHandler(wasm)
    const { sessionId } = await call(handler, 'vault.dkg.open', OPEN_2_OF_3)
    const badOpens = [
      { participants: 4, threshold: 2, mainnet: true },
      { participants: 3, threshold: '2', mainnet: true },
      { participants: 3, threshold: 2, mainnet: 'yes' },
      { participants: 3, threshold: 2, mainnet: true, extra: 1 }
    ]
    for (const payload of badOpens) {
      await expect(call(handler, 'vault.dkg.open', payload)).rejects.toThrow(
        'Invalid vault DKG request'
      )
    }
    const badAccepts = [
      { sessionId, senderSlot: 1, envelope: 'not base64!' },
      { sessionId, senderSlot: 1.5, envelope: 'AAEC' },
      { sessionId, senderSlot: 1 }
    ]
    for (const payload of badAccepts) {
      await expect(call(handler, 'vault.dkg.acceptRound1', payload)).rejects.toThrow(
        'Invalid vault DKG request'
      )
    }
    await expect(
      call(handler, 'vault.dkg.acceptRound1', {
        sessionId: bytesToBase64(new Uint8Array(16)),
        senderSlot: 1,
        envelope: 'AAEC'
      })
    ).rejects.toThrow('Unknown vault DKG session')
    await expect(handler.handle('vault.dkg.nope' as VaultDkgMethod, {})).rejects.toThrow(
      'Invalid vault DKG request'
    )
    expect(handler.sessionCount).toBe(1)
  })

  test('drops a session after a failed call', async () => {
    const handler = createVaultDkgRpcHandler(wasm)
    const shape = { participants: 2, threshold: 2 } as const
    const { sessionId } = await call(handler, 'vault.dkg.open', { ...shape, mainnet: true })
    const phone = new Phone(shape, 1, sessionId)
    const r1 = await call(handler, 'vault.dkg.acceptRound1', {
      sessionId,
      senderSlot: 1,
      envelope: phone.round1()
    })
    if (!r1.complete) throw new Error('round 1 should be complete')
    const tampered = base64ToBytes(phone.round2(r1.bundles['1']))
    tampered[tampered.length - 1] ^= 1
    await expect(
      call(handler, 'vault.dkg.acceptRound2', {
        sessionId,
        senderSlot: 1,
        envelope: bytesToBase64(tampered)
      })
    ).rejects.toThrow()
    expect(handler.sessionCount).toBe(0)
    await expect(
      call(handler, 'vault.dkg.acceptRound1', { sessionId, senderSlot: 1, envelope: 'AAEC' })
    ).rejects.toThrow('Unknown vault DKG session')
  })

  test('expires idle sessions and evicts the oldest beyond the cap', async () => {
    let now = 0
    const handler = createVaultDkgRpcHandler(wasm, {
      now: () => now,
      maxSessions: 2,
      idleMs: 1_000
    })
    const open = () => call(handler, 'vault.dkg.open', OPEN_2_OF_3)
    const a = (await open()).sessionId
    now = 10
    const b = (await open()).sessionId
    now = 20
    const c = (await open()).sessionId
    expect(handler.sessionCount).toBe(2)
    const probe = (sessionId: string) =>
      call(handler, 'vault.dkg.acceptRound1', { sessionId, senderSlot: 1, envelope: 'AAEC' })
    await expect(probe(a)).rejects.toThrow('Unknown vault DKG session')
    expect(handler.sessionCount).toBe(2)

    now = 2_000
    await expect(probe(b)).rejects.toThrow('Unknown vault DKG session')
    expect(handler.sessionCount).toBe(0)
    await expect(probe(c)).rejects.toThrow('Unknown vault DKG session')
  })

  test('closes an abandoned session when its idle timer fires', async () => {
    // A tab closed mid-ceremony never sends another vault call, so the Worker has to notice on
    // its own: every open or use arms a timer, and the timer alone closes the session.
    const timers: { fn: () => void; delayMs: number }[] = []
    const handler = createVaultDkgRpcHandler(wasm, {
      idleMs: 1_000,
      schedule: (fn, delayMs) => {
        // Like a real timer, one that has fired or been cancelled is gone.
        const timer = {
          delayMs,
          fn: () => {
            remove()
            fn()
          }
        }
        const remove = () => {
          const index = timers.indexOf(timer)
          if (index !== -1) timers.splice(index, 1)
        }
        timers.push(timer)
        return remove
      }
    })
    const { sessionId } = await call(handler, 'vault.dkg.open', OPEN_2_OF_3)
    expect(timers.map(timer => timer.delayMs)).toEqual([1_000])

    // A real use re-arms the timer instead of adding a second one.
    const phone = new Phone(OPEN_2_OF_3, 1, sessionId)
    await call(handler, 'vault.dkg.acceptRound1', {
      sessionId,
      senderSlot: 1,
      envelope: phone.round1()
    })
    expect(timers).toHaveLength(1)
    expect(handler.sessionCount).toBe(1)

    timers[0].fn()
    expect(handler.sessionCount).toBe(0)
    expect(timers).toHaveLength(0)

    // Closing explicitly disarms the timer.
    const second = await call(handler, 'vault.dkg.open', OPEN_2_OF_3)
    expect(timers).toHaveLength(1)
    await call(handler, 'vault.dkg.close', { sessionId: second.sessionId })
    expect(timers).toHaveLength(0)
  })

  test('close is idempotent', async () => {
    const handler = createVaultDkgRpcHandler(wasm)
    const { sessionId } = await call(handler, 'vault.dkg.open', OPEN_2_OF_3)
    expect(await call(handler, 'vault.dkg.close', { sessionId })).toBe(true)
    expect(await call(handler, 'vault.dkg.close', { sessionId })).toBe(true)
    expect(handler.sessionCount).toBe(0)
  })
})
