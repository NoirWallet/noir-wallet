import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import { BetaInviteLayout } from './BetaInviteLayout'
import { useBetaInviteBinding } from '../../hooks/useBetaInviteBinding'

export function BetaInviteBindingView({
  error,
  busy,
  onRetry,
  onChangeCode
}: {
  error: string
  busy: boolean
  onRetry: () => void
  onChangeCode: () => void
}) {
  return (
    <BetaInviteLayout
      title="Activating wallet"
      footer={
        error && (
          <>
            <Button onClick={onRetry} isLoading={busy} className="h-[45px] w-full">
              Retry
            </Button>
            <button
              type="button"
              onClick={onChangeCode}
              disabled={busy}
              className="w-full py-2 text-center text-sm text-primary transition-colors hover:text-primary/80 disabled:pointer-events-none disabled:opacity-50"
            >
              Use another code
            </button>
          </>
        )
      }
    >
      {!error && (
        <div
          role="status"
          aria-label="Activating wallet"
          className="flex justify-center py-2 text-primary"
        >
          <Icon
            icon="lucide:loader-circle"
            className="animate-spin"
            width={26}
            height={26}
            aria-hidden="true"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-center text-xs text-destructive">
          {error}
        </p>
      )}
    </BetaInviteLayout>
  )
}

export function BetaInviteProtectedRoute({ children }: { children: ReactNode }) {
  const { status, changeCode, error, busy, activate } = useBetaInviteBinding()

  if (!status.required || status.state.phase === 'activated') return children
  return (
    <BetaInviteBindingView
      error={error}
      busy={busy}
      onRetry={() => void activate()}
      onChangeCode={changeCode}
    />
  )
}

export function BetaInviteHardwareDoneButton() {
  const { status, changeCode, error, busy, activate } = useBetaInviteBinding()

  const done = () => {
    if (error) {
      void activate()
    } else if (!status.required || status.state.phase === 'activated') {
      window.close()
    }
  }

  return (
    <div className="w-full">
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        className="h-[45px] w-full"
        isLoading={busy}
        disabled={status.required && status.state.phase !== 'activated' && !error}
        onClick={done}
      >
        {busy ? 'Activating...' : error ? 'Retry' : 'Done'}
      </Button>
      {error && (
        <Button className="mt-2 h-10 w-full" variant="ghost" onClick={changeCode} disabled={busy}>
          Use another code
        </Button>
      )}
    </div>
  )
}
