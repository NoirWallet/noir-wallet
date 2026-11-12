/**
 * The coordinator's side of one DKG ceremony, at the byte level: the extension's own share (roster
 * slot 0) plus the relay that validates and forwards what the phones send. Runs wherever the WASM
 * is injected (the Zcash Worker in the extension, plain Node in tests) and never touches the
 * transport or `chrome.*`.
 *
 * Key material (round secrets, the static secret, the qsk) stays inside this object and is wiped
 * on close; nothing the methods return can reconstruct a share.
 */
import { bytesToHex } from '@/lib/bytes'
import { SecretBin, round1Hash, type DkgShape, type VaultWasm } from './dkg-protocol'

export type DkgCoordinatorConfig = DkgShape & { mainnet: boolean }

export type Round1Outcome = { round1Hash: string; bundles: ReadonlyMap<number, Uint8Array> }

export type Round2Outcome = {
  fingerprint: string
  inboxes: ReadonlyMap<number, Uint8Array>
  sealedQsk: ReadonlyMap<number, Uint8Array>
}

export type AcceptOutcome<T> = { complete: false } | ({ complete: true } & T)

type Dkg = InstanceType<VaultWasm['Dkg']>
// Dkg1/2/3 have private constructors, so their types come from the calls that produce them.
type Dkg1 = ReturnType<Dkg['part1']>
type DkgRelay = InstanceType<VaultWasm['DkgRelay']>
type MessageSet = InstanceType<VaultWasm['MessageSet']>

const CLOSED = 'DKG session is closed'

interface OpenedState {
  relay: DkgRelay
  dkg: Dkg
  dkg1: Dkg1
  round1Secret: Uint8Array
  broadcasts: MessageSet
  /** One inbox per roster slot, the coordinator's own at 0. */
  inboxes: Map<number, MessageSet>
}

export class DkgCoordinatorSession {
  readonly sessionId: Uint8Array
  private state: OpenedState | null
  private readonly accepted1 = new Set<number>()
  private readonly accepted2 = new Set<number>()
  private round1Complete = false

  private constructor(
    private readonly wasm: VaultWasm,
    private readonly config: DkgCoordinatorConfig,
    private readonly bin: SecretBin,
    sessionId: Uint8Array,
    state: OpenedState
  ) {
    this.sessionId = sessionId
    this.state = state
  }

  static open(
    wasm: VaultWasm,
    config: DkgCoordinatorConfig,
    bin: SecretBin = new SecretBin()
  ): DkgCoordinatorSession {
    const sessionId = wasm.EnvelopeCodec.new_session_id()
    const relay = new wasm.DkgRelay(sessionId, config.participants)
    const dkg = new wasm.Dkg(config.participants, config.threshold, 0)
    const dkg1 = dkg.part1()
    const broadcasts = new wasm.MessageSet()
    broadcasts.set(0, dkg1.broadcast())
    const inboxes = new Map<number, MessageSet>()
    for (let slot = 0; slot < config.participants; slot += 1) {
      inboxes.set(slot, new wasm.MessageSet())
    }
    return new DkgCoordinatorSession(wasm, config, bin, sessionId, {
      relay,
      dkg,
      dkg1,
      round1Secret: bin.keep(dkg1.secret()),
      broadcasts,
      inboxes
    })
  }

  get closed(): boolean {
    return this.state === null
  }

  async acceptRound1(
    senderSlot: number,
    envelope: Uint8Array
  ): Promise<AcceptOutcome<Round1Outcome>> {
    const state = this.open()
    try {
      if (this.round1Complete) throw new Error('round 1 is already complete')
      const [sender, payload] = this.accept(state.relay, envelope, 'dkgR1', senderSlot)
      if (this.accepted1.has(sender)) throw new Error('duplicate round-1 envelope')
      this.accepted1.add(sender)
      state.broadcasts.set(sender, payload)
      if (this.accepted1.size < this.peerCount) return { complete: false }

      this.round1Complete = true
      const hash = await round1Hash(state.broadcasts.to_bytes())
      const bundles = new Map<number, Uint8Array>()
      for (const slot of this.peerSlots()) {
        bundles.set(slot, state.relay.bundle(1, slot, state.broadcasts))
      }
      return { complete: true, round1Hash: hash, bundles }
    } catch (error) {
      this.close()
      throw error
    }
  }

  async acceptRound2(
    senderSlot: number,
    envelope: Uint8Array
  ): Promise<AcceptOutcome<Round2Outcome>> {
    const state = this.open()
    try {
      if (!this.round1Complete) throw new Error('round 1 is not complete')
      const [sender, batchBytes] = this.accept(state.relay, envelope, 'dkgR2Batch', senderSlot)
      if (this.accepted2.has(sender)) throw new Error('duplicate round-2 envelope')
      this.accepted2.add(sender)
      this.sortIntoInboxes(state, sender, batchBytes)
      if (this.accepted2.size < this.peerCount) return { complete: false }
      return { complete: true, ...this.finish(state) }
    } catch (error) {
      this.close()
      throw error
    }
  }

  close(): void {
    const state = this.state
    if (!state) return
    this.state = null
    this.bin.wipe()
    // Each WASM object is freed exactly once; a second free of a wasm-bindgen handle aborts.
    for (const inbox of state.inboxes.values()) inbox.free()
    state.broadcasts.free()
    state.dkg1.free()
    state.dkg.free()
    state.relay.free()
  }

  private open(): OpenedState {
    if (!this.state) throw new Error(CLOSED)
    return this.state
  }

  private get peerCount(): number {
    return this.config.participants - 1
  }

  private peerSlots(): number[] {
    const slots: number[] = []
    for (let slot = 1; slot < this.config.participants; slot += 1) slots.push(slot)
    return slots
  }

  /**
   * The relay checks session, recipient, type, roster and sequence. The transport's own idea of
   * who sent the envelope is checked here, so a phone cannot speak for another slot.
   */
  private accept(
    relay: DkgRelay,
    envelope: Uint8Array,
    expected: 'dkgR1' | 'dkgR2Batch',
    senderSlot: number
  ): [number, Uint8Array] {
    if (!this.peerSlots().includes(senderSlot)) throw new Error('sender slot is not a phone')
    const accepted: unknown[] = relay.accept(envelope, expected)
    const [sender, payload] = accepted
    if (typeof sender !== 'number' || !(payload instanceof Uint8Array)) {
      throw new Error('unexpected relay output')
    }
    if (sender !== senderSlot) throw new Error('envelope sender does not match the transport slot')
    return [sender, payload]
  }

  private sortIntoInboxes(state: OpenedState, sender: number, batchBytes: Uint8Array): void {
    const batch = this.wasm.MessageSet.from_bytes(batchBytes)
    try {
      for (const recipient of batch.slots()) {
        const inbox = state.inboxes.get(recipient)
        const pkg = batch.get(recipient)
        if (!inbox || !pkg) throw new Error('round-2 package addressed outside the roster')
        inbox.set(sender, pkg)
      }
    } finally {
      batch.free()
    }
  }

  /** Spec §5.2: own round 2 and 3, a fresh qsk, then one inbox and one sealed qsk per phone. */
  private finish(state: OpenedState): Round2Outcome {
    const { wasm, bin } = this
    const temporaries: { free(): void }[] = []
    try {
      const dkg2 = state.dkg.part2(state.round1Secret, state.broadcasts)
      temporaries.push(dkg2)
      const round2Secret = bin.keep(dkg2.secret())
      const outgoing = dkg2.outgoing()
      temporaries.push(outgoing)
      for (const recipient of outgoing.slots()) {
        const inbox = state.inboxes.get(recipient)
        const pkg = outgoing.get(recipient)
        if (!inbox || !pkg) throw new Error('own round-2 package addressed outside the roster')
        inbox.set(0, pkg)
      }

      const ownInbox = state.inboxes.get(0)
      if (!ownInbox) throw new Error('missing own inbox')
      const dkg3 = state.dkg.part3(round2Secret, state.broadcasts, ownInbox)
      temporaries.push(dkg3)
      const staticSecret = bin.keep(dkg3.static_secret())
      const statics = dkg3.statics()
      temporaries.push(statics)
      const prologue = wasm.Sealed.prologue(statics)
      const qsk = bin.keep(wasm.Keyset.generate_qsk())
      const groupKey = dkg3.group_verifying_key()

      const inboxes = new Map<number, Uint8Array>()
      const sealedQsk = new Map<number, Uint8Array>()
      for (const slot of this.peerSlots()) {
        const inbox = state.inboxes.get(slot)
        const peerKey = statics.get(slot)
        if (!inbox || !peerKey) throw new Error(`no round-2 material for slot ${slot}`)
        inboxes.set(slot, state.relay.bundle(2, slot, inbox))
        sealedQsk.set(slot, wasm.Sealed.seal(staticSecret, peerKey, prologue, qsk))
      }

      const keyset: unknown[] = wasm.Keyset.derive(groupKey, qsk, this.config.mainnet, 0)
      const fingerprint = keyset[4]
      if (!(fingerprint instanceof Uint8Array)) throw new Error('unexpected keyset output')
      return { fingerprint: bytesToHex(fingerprint), inboxes, sealedQsk }
    } finally {
      for (const temporary of temporaries) temporary.free()
    }
  }
}
