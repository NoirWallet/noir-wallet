import { useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { DatePicker } from '../ui/date-picker'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { getFullZcashRecoveryBirthdayHeight } from '@/core/wallet/birthday-height'
import { classifyError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import dayjs from '@/lib/dayjs'
import { getUtcDayStartTimestamp } from '@/lib/zcash-birthday'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'

type HistoryMode = 'new' | 'restore'
type RestoreMethod = 'date' | 'height'

export type AddAccountZcashHistorySelection =
  | { readonly mode: 'new' }
  | { readonly mode: 'restore'; readonly birthdayHeight: number }

interface AddAccountZcashHistoryContentProps {
  readonly priorUsageDetected: boolean
  readonly onConfirm: (selection: AddAccountZcashHistorySelection) => void
}

class ZcashAccountHistoryValidationError extends Error {}

export function AddAccountZcashHistoryContent({
  priorUsageDetected,
  onConfirm
}: AddAccountZcashHistoryContentProps) {
  const fullRecoveryHeight = getFullZcashRecoveryBirthdayHeight(DEFAULT_NETWORK)
  const [historyMode, setHistoryMode] = useState<HistoryMode | null>(
    priorUsageDetected ? 'restore' : null
  )
  const [restoreMethod, setRestoreMethod] = useState<RestoreMethod>('date')
  const [syncDate, setSyncDate] = useState<dayjs.Dayjs | null>(null)
  const [syncHeight, setSyncHeight] = useState('')
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resolveBirthdayHeight = async (): Promise<number> => {
    if (restoreMethod === 'height') {
      const normalizedHeight = syncHeight.replace(/,/g, '').trim()
      if (!/^\d+$/.test(normalizedHeight)) {
        throw new ZcashAccountHistoryValidationError('Enter a valid Zcash block height.')
      }
      const height = Number(normalizedHeight)
      if (!Number.isSafeInteger(height) || height < fullRecoveryHeight) {
        throw new ZcashAccountHistoryValidationError(
          `Block height must be ${fullRecoveryHeight.toLocaleString()} or later.`
        )
      }
      return height
    }

    if (!syncDate) {
      throw new ZcashAccountHistoryValidationError(
        'Select the approximate date of the first ZEC transaction.'
      )
    }
    const timestamp = getUtcDayStartTimestamp(syncDate)
    const height = await zcashWalletRuntimeClient.getBlockByTime(timestamp)
    if (!Number.isSafeInteger(height) || height <= 0) {
      throw new Error('The Zcash network returned an invalid block height. Please try again.')
    }
    return Math.max(fullRecoveryHeight, height)
  }

  const handleContinue = async () => {
    setError(null)
    if (historyMode === 'new') {
      onConfirm({ mode: 'new' })
      return
    }
    if (historyMode !== 'restore') {
      setError('Choose whether this Zcash account has received ZEC before.')
      return
    }

    setIsResolving(true)
    try {
      onConfirm({ mode: 'restore', birthdayHeight: await resolveBirthdayHeight() })
    } catch (cause) {
      setError(
        cause instanceof ZcashAccountHistoryValidationError
          ? cause.message
          : classifyError(cause).userMessage
      )
    } finally {
      setIsResolving(false)
    }
  }

  return (
    <div className="space-y-4 pt-1">
      <p className="text-sm leading-relaxed text-muted">
        {priorUsageDetected
          ? 'Previous transparent Zcash activity was found, but its first block could not be resolved. Set where recovery should begin.'
          : "We couldn't confirm whether this derived account has prior Zcash history. Shielded activity cannot be detected without scanning."}
      </p>

      {!priorUsageDetected && (
        <div role="radiogroup" aria-label="Zcash account history" className="space-y-2">
          <HistoryChoice
            title="New Zcash account"
            description="Use the current chain height. Older ZEC history will not be scanned."
            selected={historyMode === 'new'}
            onSelect={() => {
              setHistoryMode('new')
              setError(null)
            }}
          />
          <HistoryChoice
            title="Restore Zcash history"
            description="Set the approximate first ZEC transaction so older funds can be found."
            selected={historyMode === 'restore'}
            onSelect={() => {
              setHistoryMode('restore')
              setError(null)
            }}
          />
        </div>
      )}

      {historyMode === 'restore' && (
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div
            role="radiogroup"
            aria-label="Zcash history start"
            className="grid grid-cols-2 gap-2"
          >
            <RestoreMethodChoice
              label="Date"
              icon="lucide:calendar-days"
              selected={restoreMethod === 'date'}
              onSelect={() => {
                setRestoreMethod('date')
                setError(null)
              }}
            />
            <RestoreMethodChoice
              label="Block height"
              icon="lucide:blocks"
              selected={restoreMethod === 'height'}
              onSelect={() => {
                setRestoreMethod('height')
                setError(null)
              }}
            />
          </div>
          {restoreMethod === 'height' ? (
            <div>
              <label className="mb-2 block text-sm text-muted">Custom Zcash block height</label>
              <Input
                type="text"
                inputMode="numeric"
                value={syncHeight}
                onChange={event => setSyncHeight(event.target.value)}
                placeholder={`At least ${fullRecoveryHeight.toLocaleString()}`}
                aria-label="Zcash birthday height"
                className="h-[45px] rounded-xl font-mono"
              />
            </div>
          ) : (
            <div>
              <label className="mb-2 block text-sm text-muted">
                Approximate first ZEC transaction
              </label>
              <DatePicker
                value={syncDate}
                onChange={value => {
                  setSyncDate(value)
                  setError(null)
                }}
                minDate={dayjs(DEFAULT_NETWORK === 'mainnet' ? '2018-10-01' : '2018-01-01')}
                ariaLabel="First ZEC transaction date"
                placeholder="Select date"
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button
        onClick={() => void handleContinue()}
        disabled={historyMode === null || isResolving}
        isLoading={isResolving}
        className="h-[45px] w-full"
      >
        Continue
      </Button>
    </div>
  )
}

function RestoreMethodChoice({
  label,
  icon,
  selected,
  onSelect
}: {
  readonly label: string
  readonly icon: string
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={label}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-center text-[11px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-primary/60 bg-primary/5 text-foreground'
          : 'border-white/10 bg-card text-muted hover:border-white/20 hover:text-foreground'
      )}
    >
      <Icon icon={icon} width={16} height={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}

function HistoryChoice({
  title,
  description,
  selected,
  onSelect
}: {
  readonly title: string
  readonly description: string
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={title}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-primary/60 bg-primary/5'
          : 'border-white/10 bg-card hover:border-white/20'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
          selected ? 'border-primary' : 'border-muted'
        )}
      >
        {selected && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>
      </span>
    </button>
  )
}
