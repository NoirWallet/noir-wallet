import type { CreateSessionEvent } from '@/core/multisig/create-session'
import type { SessionDriver } from '@/core/multisig/driver'
import {
  createEnvelopeFactory,
  deviceId,
  type MultisigEnvelope,
  type MultisigMessageType
} from '@/core/multisig/messages'
import type { DeviceSlot } from '@/core/multisig/types'
import {
  MockPhone,
  createStepWatchdog,
  isGuardianSlot,
  realTimeHooks,
  type MockSessionIds
} from './mock-phone'

type Dispatch = (event: CreateSessionEvent) => void

/** A code the extension shows; `slots` are the phones that scan it. */
export interface MockQrDisplay {
  slots: readonly DeviceSlot[]
  messageType: MultisigMessageType
  envelope: MultisigEnvelope
}

/** The extension waits to scan this phone's reply code. */
export interface MockQrScanRequest {
  slot: DeviceSlot
  messageType: MultisigMessageType
}

export interface MockQrDriverOptions {
  session: MockSessionIds
  onDisplay: (display: MockQrDisplay) => void
  onAwaitScan: (scan: MockQrScanRequest) => void
}

export interface MockQrDriver extends SessionDriver {
  /** Dev panel: the slot's phone shows its reply and the extension reads it at once. */
  simulateScan(slot: DeviceSlot): void
  /** The user reports that this phone has scanned the code on screen. */
  phoneScanned(slot: DeviceSlot): void
  /**
   * A reply read by the camera. It must come through here rather than be dispatched directly, so
   * the scan's step watchdog stops; otherwise STEP_TIMEOUT would abort a finished session.
   */
  deliverScan(slot: DeviceSlot, envelope: MultisigEnvelope): void
}

// Mirrors the reducer: the 2-of-2 final code carries the round-2 batch and the final result
// together, so either name answers a DKG_FINAL scan.
function answersScan(awaited: MultisigMessageType | undefined, received: MultisigMessageType) {
  return received === awaited || (awaited === 'DKG_FINAL' && received === 'DKG_R2_BATCH')
}

/**
 * QR stand-in. With no live channel the driver can only tell the store what to show and what to
 * scan; the pages or the dev panel complete each exchange through phoneScanned, simulateScan and
 * deliverScan.
 */
export function createMockQrDriver(options: MockQrDriverOptions): MockQrDriver {
  const hooks = realTimeHooks
  const session: MockSessionIds = {
    groupId: options.session.groupId,
    sessionId: options.session.sessionId
  }
  const envelopeTo = createEnvelopeFactory({ ...session, senderId: deviceId(1) })
  const phones = new Map<2 | 3, MockPhone>()
  const awaited = new Map<DeviceSlot, MultisigMessageType>()
  const watchdog = createStepWatchdog(hooks)
  let displayed: MockQrDisplay | null = null
  // Scans arrive from the store outside execute, so they report through the dispatch it last
  // handed in; the store passes the same one every time.
  let lastDispatch: Dispatch | null = null
  let disposed = false

  function phoneFor(slot: 2 | 3): MockPhone {
    const existing = phones.get(slot)
    if (existing) return existing
    const phone = new MockPhone(slot, session, hooks)
    phones.set(slot, phone)
    return phone
  }

  function display(slots: readonly DeviceSlot[], messageType: MultisigMessageType): void {
    if (slots.length === 0) return
    // A QR code has no per-reader recipient, so one envelope serves every phone that scans it.
    const envelope = envelopeTo(messageType, deviceId(slots[0]))
    displayed = { slots, messageType, envelope }
    options.onDisplay(displayed)
  }

  function awaitScan(slot: DeviceSlot, messageType: MultisigMessageType, dispatch: Dispatch) {
    awaited.set(slot, messageType)
    watchdog.arm(slot, messageType, () => dispatch({ type: 'STEP_TIMEOUT' }))
    options.onAwaitScan({ slot, messageType })
  }

  function teardown(slot: DeviceSlot): void {
    if (isGuardianSlot(slot)) {
      phones.get(slot)?.dispose()
      phones.delete(slot)
    }
    awaited.delete(slot)
    watchdog.disarm(slot)
    if (displayed?.slots.includes(slot)) displayed = null
  }

  function deliverScan(slot: DeviceSlot, envelope: MultisigEnvelope): void {
    if (disposed || !lastDispatch) return
    const fromThisPhone =
      envelope.group_id === session.groupId &&
      envelope.session_id === session.sessionId &&
      envelope.sender_id === deviceId(slot)
    // A code left over from another session must not stop this session's clock.
    if (fromThisPhone && answersScan(awaited.get(slot), envelope.message_type)) {
      awaited.delete(slot)
      watchdog.disarm(slot)
    }
    // Forwarded either way: the reducer decides, and a SESSION_ABORT is never awaited.
    lastDispatch({ type: 'MESSAGE_RECEIVED', slot, envelope, at: hooks.now() })
  }

  return {
    kind: 'qr',
    execute(effect, dispatch) {
      if (disposed) return
      lastDispatch = dispatch
      switch (effect.type) {
        case 'display':
          display(effect.slots, effect.messageType)
          break
        case 'awaitScan':
          awaitScan(effect.slot, effect.messageType, dispatch)
          break
        case 'disconnect':
          teardown(effect.slot)
          break
        // Bluetooth effects never reach a QR session, and the store persists the group itself.
        case 'requestDevice':
        case 'issueCode':
        case 'sendTo':
        case 'awaitFrom':
        case 'persistGroup':
          break
      }
    },
    phoneScanned(slot) {
      if (disposed || !isGuardianSlot(slot) || !displayed?.slots.includes(slot)) return
      // The phone reads the code here. Its mock replies do not depend on what it read, so first
      // contact is all that has to happen: nothing is emitted, and the slot's dev-panel response
      // is left for the reply scan.
      phoneFor(slot)
    },
    simulateScan(slot) {
      if (disposed || !isGuardianSlot(slot)) return
      const messageType = awaited.get(slot)
      if (!messageType) return
      deliverScan(slot, phoneFor(slot).produce(messageType))
    },
    deliverScan,
    dispose() {
      if (disposed) return
      disposed = true
      for (const phone of phones.values()) phone.dispose()
      phones.clear()
      awaited.clear()
      watchdog.disarmAll()
      displayed = null
      lastDispatch = null
    }
  }
}
