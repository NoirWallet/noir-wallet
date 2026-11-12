import type { CreateSessionState } from '@/core/multisig/create-session'
import { buildQrCeremonySteps } from '@/core/multisig/qr-plan'
import { MULTISIG_ROUTE_PREFIX } from '@/lib/multisig-tab'

export type VerifyStage = 'r1' | 'final'

const CREATE_ROUTE = `${MULTISIG_ROUTE_PREFIX}/create`
const CONNECT_ROUTE = `${CREATE_ROUTE}/connect`

export const CEREMONY_ROUTE = `${CREATE_ROUTE}/ceremony`

export function qrStepRoute(index: number | string): string {
  return `${CREATE_ROUTE}/qr/${index}`
}

export function verifyRoute(stage: VerifyStage): string {
  return `${CREATE_ROUTE}/verify?stage=${stage}`
}

/** A missing or unknown stage is the final check, the one every setup ends with. */
export function parseVerifyStage(value: string | null): VerifyStage {
  return value === 'r1' ? 'r1' : 'final'
}

/**
 * The create-flow page that shows the session's current step once the roster is locked. The
 * ceremony, QR step and verify pages each compare it with their own route and move there when
 * they differ, so the session, never the URL, decides which step is on screen. Null for an
 * aborted session (the route guard owns that) and for a QR step index outside the plan.
 */
export function createFlowRoute(session: CreateSessionState): string | null {
  switch (session.phase) {
    case 'ABORTED':
      return null
    case 'CREATED':
    case 'PAIRING':
    case 'ROSTER_LOCKED':
      return CONNECT_ROUTE
    // Activation only happens on the verify page, which then forwards to the team page.
    case 'KEYSET_VERIFIED':
    case 'ACTIVATED':
      return verifyRoute('final')
    case 'DKG_R1':
    case 'R1_VERIFIED':
    case 'DKG_R2':
    case 'FINALIZED': {
      if (session.transportKind === 'ble') return CEREMONY_ROUTE
      const index = session.qrCeremonyIndex
      const step = buildQrCeremonySteps(session.threshold)[index]
      if (!step) return null
      return step.kind === 'verify' ? verifyRoute('r1') : qrStepRoute(index)
    }
  }
}
