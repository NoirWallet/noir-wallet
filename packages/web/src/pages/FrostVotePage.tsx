import { useEffect, useRef, useState } from 'react'
import {
  fetchVoteSnapshot,
  getVoterId,
  type VoteSnapshot,
  type VoteChoice
} from '../lib/frost-vote'

const votingOptions: { choice: VoteChoice; label: string }[] = [
  { choice: 'support', label: 'In favor' },
  { choice: 'oppose', label: 'Against' }
]

export default function FrostVotePage() {
  const [snapshot, setSnapshot] = useState<VoteSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<VoteChoice | null>(null)
  const [storageError, setStorageError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voterId = useRef<string | null>(null)
  const submission = useRef<AbortController | null>(null)

  useEffect(() => {
    document.title = 'FROST Multisig — Noir Wallet'
    const controller = new AbortController()

    async function load() {
      try {
        // A Web Lock keeps first-time identity creation consistent across tabs.
        voterId.current = navigator.locks
          ? await navigator.locks.request('noir-frost-voter', () => getVoterId(localStorage))
          : getVoterId(localStorage)
      } catch {
        if (controller.signal.aborted) return
        setStorageError(true)
      }
      if (controller.signal.aborted) return
      try {
        const result = await fetchVoteSnapshot('GET', voterId.current, null, controller.signal)
        if (!controller.signal.aborted) setSnapshot(result)
      } catch {
        if (!controller.signal.aborted) setError('Could not load votes. Please try again.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => {
      controller.abort()
      submission.current?.abort()
    }
  }, [])

  async function vote(choice: VoteChoice) {
    if (!voterId.current || submission.current || snapshot?.choice) return
    const controller = new AbortController()
    submission.current = controller
    setSubmitting(choice)
    setError(null)
    try {
      const result = await fetchVoteSnapshot('POST', voterId.current, choice, controller.signal)
      if (!controller.signal.aborted) setSnapshot(result)
    } catch {
      if (!controller.signal.aborted) {
        setError('Your vote could not be confirmed. Please try again; retries count only once.')
      }
    } finally {
      if (!controller.signal.aborted) setSubmitting(null)
      if (submission.current === controller) submission.current = null
    }
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-bg">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-16 -z-10 h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(0,209,138,0.1),transparent_65%)]"
      />
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-5 py-6 md:px-8 md:py-8">
        <a href="/" aria-label="Noir Wallet home" className="flex items-center gap-2.5">
          <img src="/images/logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="font-serif text-[22px] text-white">
            Noir <span className="text-primary">Wallet</span>
          </span>
        </a>
        <a href="/" className="text-sm text-white/60 transition-colors hover:text-white">
          Back to home <span aria-hidden="true">↗</span>
        </a>
      </header>

      <main className="mx-auto max-w-[940px] px-5 pb-10 pt-8 text-center md:px-8 md:pt-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-4 py-2 text-xs tracking-[0.08em] text-primary-light">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
          PLANNED FEATURE · COMMUNITY VOTE
        </div>
        <h1 className="mt-6 font-serif text-[42px] leading-[1.1] tracking-tight text-white sm:text-[56px] md:text-[68px]">
          Two devices.
          <br />
          <span className="text-primary-light">One secure vault.</span>
        </h1>
        <p className="mt-5 text-sm font-medium tracking-[0.12em] text-white/80 md:text-base">
          FROST MULTISIG · 2-OF-2 THRESHOLD SIGNING
        </p>
        <p className="mx-auto mt-4 max-w-[610px] text-sm leading-relaxed text-white/60 md:text-base">
          NoirWallet plans to bring 2-of-2 threshold signing to Zcash. Your Mobile and Chrome
          Extension each hold a key share. Start a transaction in Chrome, confirm on your phone.
          Both devices must sign.
        </p>

        <div className="mx-auto mt-9 flex max-w-[660px] items-center justify-center gap-2 sm:gap-5 md:mt-11">
          <DeviceCard mobile={false} />
          <div className="flex shrink-0 flex-col items-center gap-2 text-primary-light">
            <svg aria-hidden="true" width="42" height="42" viewBox="0 0 48 48" fill="none">
              <path
                d="M24 5 38 11v11c0 10-7 17-14 21C17 39 10 32 10 22V11L24 5Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="m17 24 5 5 10-11"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-[10px] tracking-wider text-white/50 sm:text-xs">2 / 2</span>
          </div>
          <DeviceCard mobile />
        </div>
        <p className="mt-5 text-xs tracking-wide text-white/45">
          Independent key shares. Joint authorization. Your control.
        </p>

        <section
          aria-labelledby="vote-title"
          className="mx-auto mt-10 max-w-[660px] rounded-2xl border border-primary/25 bg-card p-6 text-left md:mt-12 md:p-7"
        >
          <h2 id="vote-title" className="text-lg font-medium text-white">
            Want FROST in NoirWallet?
          </h2>
          <p className="mt-1 text-sm text-white/55">Help us shape what comes next.</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {votingOptions.map(option => (
              <div
                key={option.choice}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center sm:p-4"
              >
                <p className="text-sm font-medium text-white/80">{option.label}</p>
                <div className="mt-2 min-h-14" aria-live="polite" aria-atomic="true">
                  {snapshot ? (
                    <>
                      <p className="break-all text-3xl font-medium tabular-nums text-white">
                        {snapshot[option.choice].toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-white/50">
                        {snapshot[option.choice] === 1 ? 'vote' : 'votes'}
                      </p>
                    </>
                  ) : (
                    <p className="pt-2 text-xs text-white/50">
                      {loading ? 'Loading…' : 'Unavailable'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={
                    loading || submitting !== null || storageError || Boolean(snapshot?.choice)
                  }
                  onClick={() => void vote(option.choice)}
                  className={`mt-4 min-h-11 w-full rounded-lg px-2 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-light disabled:cursor-default disabled:opacity-60 ${option.choice === 'support' ? 'bg-primary text-black hover:bg-primary-light' : 'border border-white/25 text-white hover:bg-white/10'}`}
                >
                  {snapshot?.choice === option.choice
                    ? '✓ Your vote'
                    : submitting === option.choice
                      ? 'Submitting…'
                      : option.choice === 'support'
                        ? 'Vote in favor'
                        : 'Vote against'}
                </button>
              </div>
            ))}
          </div>
          {snapshot?.choice && (
            <p role="status" className="mt-3 text-center text-sm text-primary-light">
              Thanks for sharing your opinion.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-center text-xs leading-relaxed text-white/70">
              {error}
            </p>
          )}
          {storageError && (
            <p role="alert" className="mt-3 text-center text-xs leading-relaxed text-white/70">
              Enable browser storage and reload this page to vote.
            </p>
          )}
          <p className="mt-4 text-center text-xs leading-relaxed text-white/40">
            One vote per browser. No wallet connection required.
          </p>
        </section>

        <p className="mx-auto mt-6 max-w-[600px] text-xs leading-relaxed text-white/40">
          Planned feature. Availability and device compatibility will be confirmed before release.
        </p>
      </main>
    </div>
  )
}

function DeviceCard({ mobile }: { mobile: boolean }) {
  return (
    <div className="flex min-h-[170px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl border border-white/10 bg-linear-to-b from-white/5 to-white/[0.02] p-3 sm:min-h-[190px] sm:p-5">
      <svg
        aria-hidden="true"
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        className="text-white/80"
      >
        {mobile ? (
          <>
            <rect
              x="14"
              y="4"
              width="20"
              height="39"
              rx="4"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M21 9h6M22 38h4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            <rect
              x="5"
              y="8"
              width="38"
              height="26"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M5 15h38M17 41h14M24 34v7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="10" cy="11.5" r="1" fill="currentColor" />
            <circle cx="14" cy="11.5" r="1" fill="currentColor" />
          </>
        )}
      </svg>
      <p className="mt-3 text-xs font-medium text-white sm:text-base">
        {mobile ? 'Mobile' : 'Chrome Extension'}
      </p>
      <span className="mt-2 rounded-md bg-primary/10 px-2.5 py-1 text-[10px] tracking-wide text-primary-light sm:text-xs">
        Key share {mobile ? 'B' : 'A'}
      </span>
    </div>
  )
}
