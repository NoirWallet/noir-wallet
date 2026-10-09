import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { PageHeader } from '../../components/common/PageHeader'
import { Button } from '../../components/ui/button'
import { useNavigate } from '../../provider/Router'
import { accountManager } from '@/core/wallet/account-manager'
import type { VotingRoundStatus, VotingRoundSummary } from '@/core/worker/types'
import {
  getVotingDiscoveryErrorMessage,
  getVotingDisplayStatus,
  getPopulatedVotingStatuses,
  parseVotingDate,
  type VotingDisplayStatus,
  votingErrorMessage
} from '@/lib/voting'
import { useSettingsStore } from '@/store/settings-store'
import { useWalletStore } from '@/store/wallet-store'

interface RoundWithStatus {
  round: VotingRoundSummary
  status: VotingRoundStatus | null
}

const TABS: Array<{ id: VotingDisplayStatus; label: string }> = [
  { id: 'active', label: 'Active' },
  { id: 'voted', label: 'Voted' },
  { id: 'closed', label: 'Closed' }
]

function formatDate(value: string): string {
  const date = parseVotingDate(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Voting() {
  const { navigate } = useNavigate()
  const wallet = useWalletStore(state => state.getCurrentWallet())
  const accountId = useWalletStore(state => state.currentAccountId)
  const votingIntroSeen = useSettingsStore(state => state.votingIntroSeen)
  const setVotingIntroSeen = useSettingsStore(state => state.setVotingIntroSeen)
  const [tab, setTab] = useState<VotingDisplayStatus>('active')
  const [rounds, setRounds] = useState<RoundWithStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRounds = useCallback(async () => {
    if (!wallet || !accountId || wallet.keySource === 'keystone') return
    setLoading(true)
    setError(null)
    try {
      const core = await accountManager.getWalletCore(wallet.id, accountId)
      const discovery = await core.discoverVotingRounds()
      const discoveryError = getVotingDiscoveryErrorMessage(discovery)
      if (discoveryError) {
        setRounds([])
        setError(discoveryError)
        return
      }
      const withStatuses = await Promise.all(
        discovery.accepted.map(async round => ({
          round,
          status: await core.getVotingRoundStatus(round.roundId).catch(() => null)
        }))
      )
      setRounds(withStatuses)
    } catch (cause) {
      setError(votingErrorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [accountId, wallet])

  useEffect(() => {
    if (votingIntroSeen) loadRounds().catch(() => {})
  }, [loadRounds, votingIntroSeen])

  const populatedTabs = useMemo(() => {
    const populated = getPopulatedVotingStatuses(rounds)
    return TABS.filter(item => populated.includes(item.id))
  }, [rounds])
  const selectedTab = populatedTabs.some(item => item.id === tab) ? tab : populatedTabs[0]?.id
  const visibleRounds = useMemo(
    () =>
      selectedTab
        ? rounds.filter(item => getVotingDisplayStatus(item.round, item.status) === selectedTab)
        : [],
    [rounds, selectedTab]
  )

  if (wallet?.keySource === 'keystone') {
    return (
      <div className="page-container">
        <PageHeader title="Voting" showBack />
        <div className="page-content flex flex-col items-center justify-center text-center">
          <Icon icon="lucide:alert-triangle" width={40} height={40} className="text-muted mb-4" />
          <h2 className="font-semibold">Software wallet required</h2>
          <p className="mt-2 text-sm text-muted">
            Keystone cannot create the private proofs and signatures required by Zcash voting.
          </p>
        </div>
      </div>
    )
  }

  if (!votingIntroSeen) {
    return (
      <div className="page-container">
        <PageHeader title="Voting" showBack />
        <div className="page-content flex flex-col">
          <div className="flex flex-1 flex-col items-center justify-center text-center px-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mb-5">
              <Icon icon="lucide:shield" width={34} height={34} />
            </div>
            <h1 className="text-xl font-semibold">Private Zcash voting</h1>
            <p className="mt-3 text-sm text-muted leading-6">
              Use eligible shielded funds to vote without revealing which notes belong to you or how
              you voted.
            </p>
            <div className="mt-6 w-full text-left space-y-3">
              {[
                ['lucide:check', 'Eligibility is checked against the round snapshot'],
                ['lucide:shield', 'Your ballot is submitted with privacy-preserving proofs'],
                ['lucide:refresh-cw', 'Interrupted submissions can be resumed safely']
              ].map(([icon, text]) => (
                <div key={text} className="flex gap-3 p-3 rounded-xl bg-card text-sm">
                  <Icon
                    icon={icon}
                    width={18}
                    height={18}
                    className="text-primary shrink-0 mt-0.5"
                  />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="page-footer">
          <Button className="w-full h-11" onClick={() => setVotingIntroSeen(true)}>
            View voting rounds
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Voting"
        showBack
        action={{
          icon: <Icon icon="lucide:refresh-cw" width={16} height={16} />,
          onClick: () => loadRounds()
        }}
      />
      {populatedTabs.length > 1 && (
        <div className="px-4 pt-4 shrink-0">
          <div
            className="grid p-1 rounded-xl bg-content2"
            style={{ gridTemplateColumns: `repeat(${populatedTabs.length}, minmax(0, 1fr))` }}
          >
            {populatedTabs.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`py-2 rounded-lg text-xs font-medium transition-colors ${
                  selectedTab === item.id ? 'bg-card text-white' : 'text-muted'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="page-content space-y-3">
        {loading && (
          <div className="py-16 flex justify-center text-muted">
            <Icon icon="lucide:loader-2" width={24} height={24} className="animate-spin" />
          </div>
        )}
        {!loading && error && (
          <div role="alert" className="p-4 rounded-xl border border-danger/30 bg-danger/10">
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={loadRounds}>
              Try again
            </Button>
          </div>
        )}
        {!loading && !error && visibleRounds.length === 0 && (
          <div className="py-16 text-center">
            <Icon icon="lucide:inbox" width={34} height={34} className="mx-auto text-muted" />
            <p className="mt-3 text-sm font-medium">No voting rounds available</p>
          </div>
        )}
        {!loading &&
          visibleRounds.map(({ round, status }) => (
            <button
              key={round.roundId}
              onClick={() => navigate('/voting/round', { state: { round, status } })}
              className="w-full rounded-lg border border-white/10 bg-card p-4 text-left transition-colors hover:border-white/20 hover:bg-[#30303a]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2 py-1 text-[11px] font-medium capitalize text-primary">
                  <Icon icon="lucide:clock-3" width={12} height={12} />
                  {getVotingDisplayStatus(round, status)}
                </span>
                <span className="text-xs text-muted">Closes {formatDate(round.endsAt)}</span>
              </div>
              <h2 className="mt-4 truncate text-base font-semibold">{round.name}</h2>
              <p className="mt-2 text-xs text-muted">
                {round.proposalCount} proposal{round.proposalCount === 1 ? '' : 's'} · Snapshot
                block #{round.snapshotHeight.toLocaleString('en-US')}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-[#a6adb5]">
                  <Icon
                    icon="lucide:shield-check"
                    width={14}
                    height={14}
                    className="text-primary"
                  />
                  Authenticated source
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-white">
                  View round
                  <Icon icon="lucide:chevron-right" width={14} height={14} />
                </span>
              </div>
            </button>
          ))}
      </div>
    </div>
  )
}
