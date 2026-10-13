import { useEffect, useRef, useState, type FormEvent } from 'react'
import { submitSignup } from '../lib/frost-signup'

export default function FrostVotePage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submission = useRef<AbortController | null>(null)

  useEffect(() => {
    document.title = 'FROST Multisig — Noir Wallet'
    return () => {
      submission.current?.abort()
    }
  }, [])

  async function signup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submission.current) return
    const controller = new AbortController()
    submission.current = controller
    setSubmitting(true)
    setSuccess(false)
    setError(null)
    try {
      await submitSignup(email, controller.signal)
      if (!controller.signal.aborted) {
        setSuccess(true)
        setEmail('')
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Your signup could not be confirmed. Please try again.'
        )
      }
    } finally {
      if (!controller.signal.aborted) setSubmitting(false)
      if (submission.current === controller) submission.current = null
    }
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-bg">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(0,209,138,0.1),transparent_65%)]"
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
          PLANNED FROST BETA
        </div>
        <h1 className="mt-6 font-serif text-[42px] leading-[1.1] tracking-tight text-white sm:text-[56px] md:text-[68px]">
          Two devices.
          <br />
          <span className="text-primary-light">One secure vault.</span>
        </h1>
        <p className="mt-5 text-sm font-medium tracking-[0.12em] text-white/80 md:text-base">
          FROST MULTISIG · 2-OF-3 THRESHOLD SIGNING
        </p>
        <p className="mx-auto mt-4 max-w-[610px] text-sm leading-relaxed text-white/60 md:text-base">
          NoirWallet plans to bring 2-of-3 threshold signing to Zcash. Your Mobile and Chrome
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
            <span className="text-[10px] tracking-wider text-white/50 sm:text-xs">2 / 3</span>
          </div>
          <DeviceCard mobile />
        </div>
        <section
          aria-labelledby="signup-title"
          className="mx-auto mt-10 max-w-[660px] rounded-2xl border border-primary/25 bg-card p-6 text-left md:mt-12 md:p-7"
        >
          <h2 id="signup-title" className="text-lg font-medium text-white">
            Interested in the FROST beta?
          </h2>
          <form className="mt-6" onSubmit={event => void signup(event)}>
            <label htmlFor="frost-email" className="text-sm font-medium text-white/80">
              Email
            </label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input
                id="frost-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                maxLength={254}
                value={email}
                disabled={submitting}
                placeholder="you@example.com"
                onChange={event => {
                  setEmail(event.target.value)
                  setSuccess(false)
                  setError(null)
                }}
                aria-invalid={error === 'Please enter a valid email address.'}
                aria-describedby={error ? 'signup-error' : undefined}
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-white/20 bg-bg px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-primary disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={submitting}
                className="min-h-12 shrink-0 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-light disabled:cursor-default disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Join interest list'}
              </button>
            </div>
          </form>
          {success && (
            <p role="status" className="mt-3 text-center text-sm text-primary-light">
              Thanks for your interest.
            </p>
          )}
          {error && (
            <p
              id="signup-error"
              role="alert"
              className="mt-3 text-center text-xs leading-relaxed text-white/70"
            >
              {error}
            </p>
          )}
        </section>
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
