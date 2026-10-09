import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { useLocation, useNavigate } from '../../provider/Router'
import { accountManager } from '@/core/wallet/account-manager'
import type {
  BallotDecision,
  VotingEligibility,
  VotingProposal,
  VotingRoundStatus,
  VotingRoundSummary
} from '@/core/worker/types'
import {
  canResumeVoting,
  formatEligibilityVotingPower,
  formatVotingPower,
  formatVotingZec,
  getVotingDisplayStatus,
  parseVotingDate,
  votingErrorMessage,
  votingProgress
} from '@/lib/voting'
import { useWalletStore } from '@/store/wallet-store'

type View = 'details' | 'questions' | 'review' | 'risk' | 'progress' | 'success'
type Answer = number | 'skip'

interface VotingRouteState {
  round?: VotingRoundSummary
  status?: VotingRoundStatus | null
}

function formatDateTime(value: string): string {
  const date = parseVotingDate(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
}

function formatDate(value: string): string {
  const date = parseVotingDate(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function stageLabel(status: VotingRoundStatus | null): string {
  if (!status) return 'Preparing private voting data'
  const labels: Partial<Record<VotingRoundStatus['phase'], string>> = {
    round_prepared: 'Preparing delegation',
    delegation_pending: 'Submitting delegation proofs',
    delegation_confirmed: 'Submitting private ballot',
    vote_pending: 'Confirming ballot shares',
    vote_confirmed: 'Finalizing ballot shares',
    shares_confirmed: 'Vote submitted'
  }
  return labels[status.phase] ?? 'Preparing private voting data'
}

export function VotingRound() {
  const { goBack } = useNavigate()
  const routeState = (useLocation().state ?? {}) as VotingRouteState
  const round = routeState.round
  const wallet = useWalletStore(state => state.getCurrentWallet())
  const accountId = useWalletStore(state => state.currentAccountId)
  const [view, setView] = useState<View>('details')
  const [eligibility, setEligibility] = useState<VotingEligibility | null>(null)
  const [status, setStatus] = useState<VotingRoundStatus | null>(routeState.status ?? null)
  const [proposals, setProposals] = useState<VotingProposal[]>([])
  const [answers, setAnswers] = useState<Record<number, Answer>>({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [eligibilityNoticeOpen, setEligibilityNoticeOpen] = useState(false)

  const loadRound = useCallback(async () => {
    if (!round || !wallet || !accountId || wallet.keySource === 'keystone') return
    setLoading(true)
    setError(null)
    try {
      const core = await accountManager.getWalletCore(wallet.id, accountId)
      const trustedProposals = await core.getVotingRoundProposals(round.roundId)
      setProposals(trustedProposals)
      const [eligibilityResult, statusResult] = await Promise.allSettled([
        core.checkVotingEligibility(round.roundId),
        core.getVotingRoundStatus(round.roundId)
      ])
      if (eligibilityResult.status === 'fulfilled') {
        setEligibility(eligibilityResult.value)
        const nextStatus = statusResult.status === 'fulfilled' ? statusResult.value : null
        if (
          !eligibilityResult.value.eligible &&
          getVotingDisplayStatus(round, nextStatus) === 'active'
        ) {
          setEligibilityNoticeOpen(true)
        }
      }
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value)

      if (eligibilityResult.status === 'rejected') {
        setError(votingErrorMessage(eligibilityResult.reason))
      }
    } catch (cause) {
      setError(votingErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [accountId, round, wallet])

  useEffect(() => {
    loadRound().catch(() => {})
  }, [loadRound])

  const decisions = useMemo<BallotDecision[]>(
    () =>
      proposals.map(proposal => {
        const answer = answers[proposal.proposalId]
        return answer === 'skip'
          ? { kind: 'skip', proposalId: proposal.proposalId }
          : { kind: 'choice', proposalId: proposal.proposalId, option: answer as number }
      }),
    [answers, proposals]
  )

  const refreshStatus = useCallback(async () => {
    if (!round || !wallet || !accountId) return null
    const core = await accountManager.getWalletCore(wallet.id, accountId)
    const nextStatus = await core.getVotingRoundStatus(round.roundId)
    setStatus(nextStatus)
    return nextStatus
  }, [accountId, round, wallet])

  const runSubmission = useCallback(
    async (includeBallot: boolean) => {
      if (!round || !wallet || !accountId) return
      setView('progress')
      setError(null)
      try {
        const core = await accountManager.getWalletCore(wallet.id, accountId)
        let current = await core.getVotingRoundStatus(round.roundId).catch(() => null)

        for (let step = 0; step < 8; step += 1) {
          setStatus(current)
          const phase = current?.phase
          if (phase === 'shares_confirmed') {
            setView('success')
            return
          }
          if (phase === 'not_eligible') throw new Error('NOT_ELIGIBLE')
          if (phase === 'expired' || phase === 'round_rejected') throw new Error('ROUND_EXPIRED')

          if (
            !current ||
            phase === 'uninitialized' ||
            phase === 'config_authenticated' ||
            phase === 'eligible'
          ) {
            await core.prepareVotingRound(round.roundId)
          } else if (phase === 'round_prepared') {
            await core.submitVotingDelegation(round.roundId)
          } else if (
            phase === 'delegation_pending' ||
            phase === 'vote_pending' ||
            phase === 'vote_confirmed'
          ) {
            await core.resumeVotingRound(round.roundId)
          } else if (phase === 'delegation_confirmed') {
            if (!includeBallot) {
              setView('questions')
              return
            }
            await core.submitVotingBallot(round.roundId, decisions)
          } else {
            throw new Error(`Voting cannot continue from ${phase}`)
          }
          current = await core.getVotingRoundStatus(round.roundId)
        }
        throw new Error('Voting needs another resume attempt')
      } catch (cause) {
        setError(votingErrorMessage(cause))
        await refreshStatus().catch(() => null)
      }
    },
    [accountId, decisions, refreshStatus, round, wallet]
  )

  if (!round) {
    return (
      <div className="page-container">
        <PageHeader title="Voting" showBack />
        <div className="page-content flex items-center justify-center text-center text-sm text-muted">
          Select a voting round from the list.
        </div>
      </div>
    )
  }

  if (wallet?.keySource === 'keystone') {
    return (
      <div className="page-container">
        <PageHeader title="Voting" showBack />
        <div className="page-content flex items-center justify-center text-center text-sm text-muted">
          Voting is available only for software wallets.
        </div>
      </div>
    )
  }

  if (view === 'success') {
    return (
      <div className="page-container">
        <PageHeader title="Vote submitted" backDisabled />
        <div className="page-content flex flex-col items-center justify-center text-center px-6">
          <div className="w-16 h-16 rounded-full bg-primary/15 text-primary flex items-center justify-center">
            <Icon icon="lucide:check" width={34} height={34} />
          </div>
          <h1 className="mt-5 text-xl font-semibold">Your vote is complete</h1>
          <p className="mt-3 text-sm text-muted leading-6">
            Your private ballot shares were submitted successfully for {round.name}.
          </p>
        </div>
        <div className="page-footer">
          <Button className="w-full h-11" onClick={goBack}>
            Back to voting
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'progress') {
    const progress = status ? votingProgress(status) : 0
    return (
      <div className="page-container">
        <PageHeader title="Submitting vote" backDisabled />
        <div className="page-content flex flex-col items-center justify-center text-center px-6">
          <Icon
            icon="lucide:loader-2"
            width={44}
            height={44}
            className="text-primary animate-spin"
          />
          <h1 className="mt-5 text-lg font-semibold">{stageLabel(status)}</h1>
          <p className="mt-2 text-sm text-muted">
            Keep Noir Wallet open. This private operation may require several submissions.
          </p>
          <div className="w-full mt-7 h-2 rounded-full bg-content2 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          {status && status.totalBundles > 0 && (
            <p className="mt-2 text-xs text-muted">
              Bundle {status.completedBundles} of {status.totalBundles}
            </p>
          )}
          {error && (
            <div role="alert" className="mt-6 w-full p-3 rounded-xl bg-danger/10 text-sm text-left">
              {error}
            </div>
          )}
        </div>
        {error && (
          <div className="page-footer">
            <Button className="w-full h-11" onClick={() => runSubmission(false)}>
              Resume safely
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (view === 'risk') {
    return (
      <div className="page-container">
        <PageHeader title="Before you submit" showBack onBack={() => setView('review')} />
        <div className="page-content">
          <div className="p-4 rounded-xl bg-warning/10 border border-warning/30">
            <div className="flex gap-3">
              <Icon
                icon="lucide:triangle-alert"
                width={22}
                height={22}
                className="text-warning shrink-0"
              />
              <div>
                <h2 className="text-sm font-semibold">Voting creates private transactions</h2>
                <p className="mt-2 text-xs text-muted leading-5">
                  Keep the wallet open until all steps finish. If the network is interrupted, use
                  Resume—do not start a second vote.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 p-4 rounded-xl bg-card space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted">Round</span>
              <span className="text-right">{round.name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Selections</span>
              <span>{proposals.length}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted">Voting power</span>
              <span>{formatVotingPower(eligibility?.votingPower)}</span>
            </div>
          </div>
        </div>
        <div className="page-footer">
          <Button className="w-full h-11" onClick={() => runSubmission(true)}>
            Confirm and submit
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'review') {
    return (
      <div className="page-container">
        <PageHeader title="Review vote" showBack onBack={() => setView('questions')} />
        <div className="page-content space-y-3">
          {proposals.map(proposal => {
            const answer = answers[proposal.proposalId]
            const answerText = answer === 'skip' ? 'Skip' : proposal.options[answer as number]
            return (
              <div key={proposal.proposalId} className="p-4 rounded-xl bg-card">
                <p className="text-xs text-muted">Proposal {proposal.proposalId}</p>
                <h2 className="mt-1 text-sm font-medium">{proposal.title}</h2>
                <p className="mt-3 text-sm text-primary">{answerText}</p>
              </div>
            )
          })}
        </div>
        <div className="page-footer">
          <Button className="w-full h-11" onClick={() => setView('risk')}>
            Continue
          </Button>
        </div>
      </div>
    )
  }

  if (view === 'questions' && proposals.length > 0) {
    const proposal = proposals[questionIndex]
    const isLast = questionIndex === proposals.length - 1
    const answer = answers[proposal.proposalId]
    return (
      <div className="page-container">
        <PageHeader
          title={`Proposal ${questionIndex + 1} of ${proposals.length}`}
          showBack
          onBack={() =>
            questionIndex > 0 ? setQuestionIndex(questionIndex - 1) : setView('details')
          }
        />
        <div className="page-content">
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="flex-1 h-1 rounded-full bg-content2 overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${((questionIndex + 1) / proposals.length) * 100}%` }}
              />
            </div>
            <span>
              {questionIndex + 1}/{proposals.length}
            </span>
          </div>
          <h1 className="mt-6 text-lg font-semibold leading-7">{proposal.title}</h1>
          <div className="mt-5 space-y-3">
            {proposal.options.map((option, optionIndex) => (
              <button
                key={`${optionIndex}-${option}`}
                onClick={() =>
                  setAnswers(current => ({ ...current, [proposal.proposalId]: optionIndex }))
                }
                className={`w-full p-4 rounded-xl border text-left text-sm ${
                  answer === optionIndex
                    ? 'border-primary bg-primary/10'
                    : 'border-white/10 bg-card'
                }`}
              >
                {option}
              </button>
            ))}
            <button
              onClick={() => setAnswers(current => ({ ...current, [proposal.proposalId]: 'skip' }))}
              className={`w-full p-4 rounded-xl border text-left text-sm ${
                answer === 'skip' ? 'border-primary bg-primary/10' : 'border-white/10 bg-card'
              }`}
            >
              Skip this proposal
            </button>
          </div>
        </div>
        <div className="page-footer">
          <Button
            className="w-full h-11"
            disabled={answer === undefined}
            onClick={() => (isLast ? setView('review') : setQuestionIndex(questionIndex + 1))}
          >
            {isLast ? 'Review vote' : 'Next proposal'}
          </Button>
        </div>
      </div>
    )
  }

  const displayStatus = getVotingDisplayStatus(round, status)
  const votingPowerLabel = formatEligibilityVotingPower(eligibility)
  const insufficientSnapshotValue = eligibility?.reasonCode === 'INSUFFICIENT_SNAPSHOT_VALUE'
  const snapshotVotingValue = formatVotingZec(eligibility?.snapshotVotingValueZats)
  const minimumRequired = formatVotingZec(eligibility?.minimumRequiredZats)
  return (
    <>
      <div className="page-container">
        <PageHeader title="Coinholder voting" showBack />
        <div className="page-content">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium capitalize text-primary">
              <Icon icon="lucide:clock-3" width={13} height={13} />
              {displayStatus}
            </span>
            <span className="text-sm text-[#a6adb5]">
              {displayStatus === 'closed' ? 'Closed' : 'Closes'} {formatDate(round.endsAt)}
            </span>
          </div>

          <h1 className="mt-4 text-[22px] font-semibold leading-7">{round.name}</h1>
          <p className="mt-2 text-sm leading-5 text-muted">
            {round.proposalCount} governance proposal{round.proposalCount === 1 ? '' : 's'} in this
            private voting round.
          </p>

          <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-white/10 bg-white/10">
            {[
              ['Snapshot block', `#${round.snapshotHeight.toLocaleString('en-US')}`],
              ['Eligible voting power', votingPowerLabel],
              ['Opens', formatDateTime(round.startsAt)],
              ['Closes', formatDateTime(round.endsAt)]
            ].map(([label, value], index) => (
              <div
                key={label}
                className={`min-h-[72px] bg-card p-3 ${index % 2 === 0 ? 'border-r border-white/10' : ''} ${index < 2 ? 'border-b border-white/10' : ''}`}
              >
                <p className="text-[11px] text-muted">{label}</p>
                <p className="mt-1.5 text-sm font-medium leading-5 text-white">{value}</p>
              </div>
            ))}
          </div>

          {loading && (
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-card p-4 text-sm text-muted">
              <Icon icon="lucide:loader-2" width={16} height={16} className="animate-spin" />
              Checking eligibility and proposals…
            </div>
          )}

          {!loading && error && (
            <div role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger/10 p-4">
              <div className="flex gap-3">
                <Icon
                  icon="lucide:circle-alert"
                  width={20}
                  height={20}
                  className="shrink-0 text-danger"
                />
                <div>
                  <p className="text-sm font-semibold">Couldn’t check eligibility</p>
                  <p className="mt-1 text-xs leading-5 text-[#a6adb5]">{error}</p>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && eligibility?.eligible && (
            <div className="mt-5 rounded-lg border border-primary/25 bg-primary/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Icon icon="lucide:badge-check" width={19} height={19} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white">Eligible to vote</h2>
                  <p className="mt-1 text-xs leading-5 text-[#a6adb5]">
                    Answer {proposals.length} proposal{proposals.length === 1 ? '' : 's'}, review
                    your choices, then keep Noir Wallet open while the private vote is submitted.
                  </p>
                </div>
              </div>
            </div>
          )}

          {canResumeVoting(status) && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-[#d9d9df]">
              <Icon
                icon="lucide:rotate-ccw"
                width={16}
                height={16}
                className="mt-0.5 text-warning"
              />
              <p>Your previous submission was interrupted. Resume from the saved checkpoint.</p>
            </div>
          )}

          {displayStatus === 'closed' && (
            <div className="mt-5 flex items-start gap-2 text-xs leading-5 text-muted">
              <Icon icon="lucide:lock" width={15} height={15} className="mt-0.5 shrink-0" />
              <p>This round is closed. Official tally data is not available in the wallet yet.</p>
            </div>
          )}
        </div>

        {!loading && error && (
          <div className="page-footer">
            <Button className="h-11 w-full" onClick={loadRound}>
              Try again
            </Button>
          </div>
        )}

        {displayStatus === 'active' &&
          !loading &&
          !error &&
          eligibility?.eligible &&
          proposals.length > 0 && (
            <div className="page-footer">
              <Button
                className="h-11 w-full font-semibold"
                onClick={() =>
                  canResumeVoting(status) ? runSubmission(false) : setView('questions')
                }
              >
                {canResumeVoting(status) ? 'Resume voting' : 'Review proposals'}
              </Button>
            </div>
          )}

        {displayStatus === 'active' &&
          !loading &&
          !error &&
          eligibility &&
          !eligibility.eligible && (
            <div className="page-footer">
              <Button
                variant="outline"
                className="h-11 w-full"
                onClick={() => setEligibilityNoticeOpen(true)}
              >
                View eligibility details
              </Button>
            </div>
          )}
      </div>

      <Dialog open={eligibilityNoticeOpen} onOpenChange={setEligibilityNoticeOpen}>
        <DialogContent
          position="bottom"
          showCloseButton={false}
          onOpenAutoFocus={event => event.preventDefault()}
          className="gap-0 rounded-t-2xl border-t border-white/10 bg-[#202029] p-5"
        >
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-white/20" />
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
              <Icon icon="lucide:circle-alert" width={24} height={24} />
            </div>
            <DialogTitle className="text-xl leading-7">
              {insufficientSnapshotValue ? 'Insufficient balance' : 'Not eligible for this round'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              This account does not meet this round’s voting requirements.
            </DialogDescription>
          </DialogHeader>

          <p className="mt-3 text-center text-sm leading-6 text-[#a6adb5]">
            {insufficientSnapshotValue ? (
              <>
                Your wallet held{' '}
                <span className="font-semibold text-white">{snapshotVotingValue} ZEC</span> at
                snapshot block{' '}
                <span className="font-semibold text-white">
                  #{round.snapshotHeight.toLocaleString('en-US')}
                </span>
                . A minimum of{' '}
                <span className="font-semibold text-white">{minimumRequired} ZEC</span> was required
                to vote.
              </>
            ) : (
              <>
                Your funds at snapshot block{' '}
                <span className="font-semibold text-white">
                  #{round.snapshotHeight.toLocaleString('en-US')}
                </span>{' '}
                did not meet this round’s voting requirements.
              </>
            )}
          </p>
          <Button
            className="mt-5 h-11 w-full font-semibold"
            onClick={() => setEligibilityNoticeOpen(false)}
          >
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
