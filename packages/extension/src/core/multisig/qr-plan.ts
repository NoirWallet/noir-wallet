import type { MultisigMessageType } from './messages'
import type { DeviceSlot, MultisigThreshold } from './types'

export type QrStepKind = 'show' | 'scan' | 'verify'

export interface QrStep {
  kind: QrStepKind
  /**
   * 'show': the phones that scan this code. 'scan': the one phone whose code is scanned.
   * 'verify': empty.
   */
  slots: readonly DeviceSlot[]
  /** Null for 'verify' steps, which carry no message. */
  messageType: MultisigMessageType | null
  /** Set only on 'verify' steps: which stage the user checks by eye. */
  stage: 'r1' | null
  title: string
}

// Pairing is always one invite and one reply per phone, regardless of threshold.
const PAIRING_STEP_COUNT = 2

export function buildQrPairingSteps(slot: DeviceSlot): readonly [QrStep, QrStep] {
  return [
    { kind: 'show', slots: [slot], messageType: 'PAIR_INVITE', stage: null, title: 'Invite' },
    { kind: 'scan', slots: [slot], messageType: 'PAIR_RESPONSE', stage: null, title: 'Reply' }
  ]
}

export function buildQrCeremonySteps(threshold: MultisigThreshold): readonly QrStep[] {
  if (threshold === '2-of-2') {
    return [
      { kind: 'show', slots: [2], messageType: 'DKG_R2_INBOX', stage: null, title: 'Shares' },
      {
        kind: 'scan',
        slots: [2],
        messageType: 'DKG_FINAL',
        stage: null,
        title: 'Final Verification'
      }
    ]
  }
  // With three devices over QR there is no live channel to cross-check round-1 commitments, so
  // the user verifies them by eye before any round-2 shares are scanned.
  return [
    {
      kind: 'show',
      slots: [2, 3],
      messageType: 'DKG_R1_BUNDLE',
      stage: null,
      title: 'Group setup'
    },
    { kind: 'verify', slots: [], messageType: null, stage: 'r1', title: 'Verify setup' },
    { kind: 'scan', slots: [2], messageType: 'DKG_R2_BATCH', stage: null, title: 'Collect shares' },
    { kind: 'scan', slots: [3], messageType: 'DKG_R2_BATCH', stage: null, title: 'Collect shares' },
    {
      kind: 'show',
      slots: [2],
      messageType: 'DKG_R2_INBOX',
      stage: null,
      title: 'Encrypted shares'
    },
    {
      kind: 'show',
      slots: [3],
      messageType: 'DKG_R2_INBOX',
      stage: null,
      title: 'Encrypted shares'
    }
  ]
}

export function qrStepCounter(
  threshold: MultisigThreshold,
  phase: 'pairing' | 'ceremony',
  index: number
): { current: number; total: number } {
  const ceremonyCount = buildQrCeremonySteps(threshold).length
  const phaseCount = phase === 'pairing' ? PAIRING_STEP_COUNT : ceremonyCount
  // An out-of-range index means the caller's step state is wrong; fail loudly instead of
  // showing a made-up "7/6" to the user.
  if (!Number.isInteger(index) || index < 0 || index >= phaseCount) {
    throw new RangeError(`QR ${phase} step index ${index} is outside 0..${phaseCount - 1}`)
  }
  if (threshold === '2-of-2') {
    // The 2-of-2 mockups number pairing and ceremony as one continuous sequence (1/4 to 4/4).
    const offset = phase === 'ceremony' ? PAIRING_STEP_COUNT : 0
    return { current: offset + index + 1, total: PAIRING_STEP_COUNT + ceremonyCount }
  }
  // With three devices each phone's pairing is numbered on its own (1/2, 2/2), and the ceremony
  // is a separate six-step sequence.
  return { current: index + 1, total: phaseCount }
}
