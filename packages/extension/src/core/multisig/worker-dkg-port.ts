/** The real DkgPort: every call travels Background → Offscreen → Zcash Worker as a vault RPC. */
import { requestVaultDkg } from '@/core/worker/client'
import type { DkgPort } from './dkg-port'

export function createWorkerDkgPort(): DkgPort {
  return {
    open: request => requestVaultDkg('vault.dkg.open', request),
    acceptRound1: request => requestVaultDkg('vault.dkg.acceptRound1', request),
    acceptRound2: request => requestVaultDkg('vault.dkg.acceptRound2', request),
    close: async request => {
      await requestVaultDkg('vault.dkg.close', request)
    }
  }
}
