import type {
  VotingActionResult,
  VotingDiscovery,
  VotingEligibility,
  VotingRoundPhase,
  VotingRoundSummary,
  VotingRoundStatus
} from '@/core/worker/types'
import type { KeySource } from '@/types'

export type VotingDisplayStatus = 'active' | 'voted' | 'closed'

const VOTING_DISPLAY_STATUS_ORDER: VotingDisplayStatus[] = ['active', 'voted', 'closed']

const VOTED_PHASES = new Set<VotingRoundPhase>(['shares_confirmed'])
const CONTINUABLE_PHASES = new Set<VotingRoundPhase>([
  'round_prepared',
  'delegation_pending',
  'delegation_confirmed',
  'vote_pending',
  'vote_confirmed'
])

export function parseVotingDate(value: string): Date {
  const numeric = Number(value)
  const normalized =
    /^\d+$/.test(value) && Number.isSafeInteger(numeric)
      ? numeric < 1_000_000_000_000
        ? numeric * 1000
        : numeric
      : value
  return new Date(normalized)
}

export function supportsVotingKeySource(keySource: KeySource | undefined): boolean {
  return keySource !== 'keystone'
}

export function getVotingDisplayStatus(
  round: VotingRoundSummary,
  status: VotingRoundStatus | null,
  now = Date.now()
): VotingDisplayStatus {
  if (status && VOTED_PHASES.has(status.phase)) return 'voted'
  if (status?.phase === 'expired' || parseVotingDate(round.endsAt).getTime() <= now) return 'closed'
  return 'active'
}

export function getPopulatedVotingStatuses(
  rounds: ReadonlyArray<{
    round: VotingRoundSummary
    status: VotingRoundStatus | null
  }>,
  now = Date.now()
): VotingDisplayStatus[] {
  const populated = new Set(
    rounds.map(item => getVotingDisplayStatus(item.round, item.status, now))
  )
  return VOTING_DISPLAY_STATUS_ORDER.filter(status => populated.has(status))
}

export function canResumeVoting(status: VotingRoundStatus | null): boolean {
  return status ? CONTINUABLE_PHASES.has(status.phase) : false
}

export function formatVotingPower(value: string | undefined): string {
  if (!value) return '—'
  if (/^\d+$/.test(value)) return BigInt(value).toLocaleString('en-US')
  const parsed = Number(value)
  return Number.isFinite(parsed) ? new Intl.NumberFormat('en-US').format(parsed) : value
}

export function formatVotingZec(valueZats: string | undefined): string {
  if (!valueZats || !/^\d+$/.test(valueZats)) return '—'
  const zats = BigInt(valueZats)
  const whole = zats / 100_000_000n
  const fraction = (zats % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole.toLocaleString('en-US')}.${fraction}` : whole.toLocaleString('en-US')
}

export function formatEligibilityVotingPower(
  eligibility: Pick<VotingEligibility, 'eligible' | 'votingPower'> | null
): string {
  if (!eligibility) return '—'
  return eligibility.eligible ? formatVotingPower(eligibility.votingPower) : 'Not eligible'
}

export function votingProgress(result: VotingActionResult): number {
  if (result.totalBundles <= 0) return result.phase === 'shares_confirmed' ? 100 : 0
  return Math.min(100, Math.round((result.completedBundles / result.totalBundles) * 100))
}

export function votingErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const code = raw.split(':', 1)[0]
  const messages: Record<string, string> = {
    WALLET_NOT_SYNCED: 'Keep Noir Wallet open until syncing finishes, then try again.',
    NOT_ELIGIBLE: 'This account is not eligible for this voting round.',
    ROUND_EXPIRED: 'This voting round has ended.',
    NETWORK_MISMATCH: 'This voting round is for a different Zcash network.',
    CONFIG_FETCH_FAILED: 'Voting information could not be loaded. Try again later.',
    CONFIG_UNTRUSTED: 'Voting information failed its authenticity check.',
    ROUND_UNAUTHENTICATED: 'This voting round failed its authenticity check.',
    OPERATION_IN_PROGRESS: 'A voting operation is already in progress.',
    SUBMISSION_UNKNOWN: 'Submission status is unknown. Resume instead of voting again.',
    PERSISTENCE_FAILED:
      'Voting recovery state could not be saved. Reload the wallet before retrying.'
  }
  return messages[code] ?? raw
}

export function getVotingDiscoveryErrorMessage(
  discovery: Pick<VotingDiscovery, 'accepted' | 'rejected'>
): string | null {
  if (discovery.accepted.length > 0 || discovery.rejected.length === 0) return null
  return votingErrorMessage(new Error(discovery.rejected[0].code))
}
