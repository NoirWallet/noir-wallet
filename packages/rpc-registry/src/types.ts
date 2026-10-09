export const CHECK_NAMES = ['GetLatestBlock', 'GetBlockRange', 'GetSubtreeRoots'] as const

export type CheckName = (typeof CHECK_NAMES)[number]
export type ProbeOutcome = 'success' | 'failure' | 'skipped'

export interface RpcTarget {
  chainId: string
  chain: string
  network: string
  probe: 'zcash-lightwalletd-grpc-web'
  id: string
  label: string
  url: string
}

export interface ProbeResult {
  chainId: string
  chain: string
  network: string
  targetId: string
  targetLabel: string
  check: CheckName
  outcome: ProbeOutcome
  attempts: number
  elapsedMs: number
  error?: string
  observedHeight?: number
}

export function resultKey(result: Pick<ProbeResult, 'chainId' | 'targetId' | 'check'>): string {
  return `${result.chainId}:${result.targetId}:${result.check}`
}
