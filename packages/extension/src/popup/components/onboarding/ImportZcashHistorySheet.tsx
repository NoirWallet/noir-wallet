import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { DatePicker } from '../ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { InlineError } from '../common/InlineError'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import { getFullZcashRecoveryBirthdayHeight } from '@/core/wallet/birthday-height'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { classifyError } from '@/lib/errors'
import { LatestAttempt } from '@/lib/async-utils'
import { cn } from '@/lib/utils'
import { getUtcDayStartTimestamp } from '@/lib/zcash-birthday'
import dayjs from '@/lib/dayjs'
import { getImportZcashHistoryDefaults } from '@/popup/services/import-zcash-history-selection'

type HistoryMode = 'new' | 'restore'
type RestoreMethod = 'date' | 'height'

class ZcashHistoryValidationError extends Error {}

export function ImportZcashHistorySheet({ onClose }: { readonly onClose: () => void }) {
  const { navigate, replace } = useNavigate()
  const {
    flowMode,
    importedSeedPhrase,
    birthdayHeight,
    importZcashHistorySelection,
    setBirthdayHeight,
    setImportZcashHistorySelection,
    addImportedWallet
  } = useOnboardingStore()
  const fullRecoveryHeight = getFullZcashRecoveryBirthdayHeight(DEFAULT_NETWORK)
  const [initialSelection] = useState(() =>
    getImportZcashHistoryDefaults(birthdayHeight, importZcashHistorySelection)
  )
  const [historyMode, setHistoryMode] = useState<HistoryMode>(initialSelection.historyMode)
  const [restoreMethod, setRestoreMethod] = useState<RestoreMethod>(initialSelection.restoreMethod)
  const [syncDate, setSyncDate] = useState<dayjs.Dayjs | null>(
    initialSelection.syncDate ? dayjs(initialSelection.syncDate) : null
  )
  const [syncHeight, setSyncHeight] = useState(initialSelection.syncHeight)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const continueAttempts = useRef(new LatestAttempt())

  useEffect(() => {
    const attempts = continueAttempts.current
    return () => attempts.invalidate()
  }, [])

  useEffect(() => {
    if (!importedSeedPhrase) replace('/onboarding/import')
  }, [importedSeedPhrase, replace])

  const resetPendingContinue = () => {
    continueAttempts.current.invalidate()
    setIsImporting(false)
    setError(null)
    setRetryable(false)
  }

  const selectHistoryMode = (mode: HistoryMode) => {
    resetPendingContinue()
    setHistoryMode(mode)
  }

  const selectRestoreMethod = (method: RestoreMethod) => {
    resetPendingContinue()
    setRestoreMethod(method)
  }

  const resolveBirthdayHeight = async (): Promise<number | undefined> => {
    if (historyMode === 'new') return undefined

    if (restoreMethod === 'height') {
      const normalizedHeight = syncHeight.replace(/,/g, '').trim()
      if (!/^\d+$/.test(normalizedHeight)) {
        throw new ZcashHistoryValidationError('Enter a valid Zcash block height.')
      }
      const height = Number(normalizedHeight)
      if (!Number.isSafeInteger(height) || height < fullRecoveryHeight) {
        throw new ZcashHistoryValidationError(
          `Block height must be ${fullRecoveryHeight.toLocaleString()} or later.`
        )
      }
      return height
    }

    if (!syncDate) {
      throw new ZcashHistoryValidationError(
        'Select a date before your account’s first transaction.'
      )
    }
    const timestamp = getUtcDayStartTimestamp(syncDate)
    const resolvedHeight = await zcashWalletRuntimeClient.getBlockByTime(timestamp)
    if (!Number.isSafeInteger(resolvedHeight) || resolvedHeight <= 0) {
      throw new Error('The Zcash network returned an invalid block height. Please try again.')
    }
    return Math.max(fullRecoveryHeight, resolvedHeight)
  }

  const handleContinue = async () => {
    const attempt = continueAttempts.current.begin()
    setError(null)
    setRetryable(false)
    setIsImporting(true)
    try {
      const height = await resolveBirthdayHeight()
      if (!continueAttempts.current.isCurrent(attempt)) return
      setBirthdayHeight(height)
      setImportZcashHistorySelection(
        historyMode === 'new'
          ? { mode: 'new' }
          : restoreMethod === 'date'
            ? { mode: 'restore', method: 'date', date: syncDate!.format('YYYY-MM-DD') }
            : { mode: 'restore', method: 'height' }
      )

      if (flowMode === 'addWallet') {
        const success = await addImportedWallet()
        if (!continueAttempts.current.isCurrent(attempt)) return
        if (success) replace('/onboarding/congratulations')
        else setError(useOnboardingStore.getState().error)
        return
      }
      navigate('/onboarding/import-password')
    } catch (cause) {
      if (!continueAttempts.current.isCurrent(attempt)) return
      const classified = classifyError(cause)
      const validationError = cause instanceof ZcashHistoryValidationError
      setError(validationError ? cause.message : classified.userMessage)
      setRetryable(!validationError && classified.retryable)
    } finally {
      if (continueAttempts.current.isCurrent(attempt)) setIsImporting(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !(flowMode === 'addWallet' && isImporting)) onClose()
      }}
    >
      <DialogContent
        position="bottom"
        className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0"
      >
        <DialogHeader className="px-5 pb-4 pt-5">
          <DialogTitle className="sr-only">Zcash account setup</DialogTitle>
          <DialogDescription className="pr-8">
            Has this phrase received ZEC before?
          </DialogDescription>
        </DialogHeader>

        <fieldset
          disabled={flowMode === 'addWallet' && isImporting}
          className="min-h-0 min-w-0 overflow-y-auto px-5 pb-4"
        >
          <div role="radiogroup" aria-label="Zcash account setup" className="space-y-2">
            <HistoryChoice
              title="New Zcash Account"
              selected={historyMode === 'new'}
              onSelect={() => selectHistoryMode('new')}
            />
            <HistoryChoice
              title="Restore Zcash Account"
              selected={historyMode === 'restore'}
              onSelect={() => selectHistoryMode('restore')}
            />
          </div>

          {historyMode === 'restore' && (
            <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <div
                role="radiogroup"
                aria-label="Zcash history start"
                className="grid grid-cols-2 gap-2"
              >
                <RestoreMethodChoice
                  label="Date"
                  icon="lucide:calendar-days"
                  selected={restoreMethod === 'date'}
                  onSelect={() => selectRestoreMethod('date')}
                />
                <RestoreMethodChoice
                  label="Block height"
                  icon="lucide:blocks"
                  selected={restoreMethod === 'height'}
                  onSelect={() => selectRestoreMethod('height')}
                />
              </div>
              {restoreMethod === 'height' ? (
                <div>
                  <label className="mb-2 block text-sm text-muted">Block height</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={syncHeight}
                    onChange={event => {
                      resetPendingContinue()
                      setSyncHeight(event.target.value)
                    }}
                    placeholder={`At least ${fullRecoveryHeight.toLocaleString()}`}
                    aria-label="Zcash birthday height"
                    className="h-[45px] rounded-xl font-mono"
                  />
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-sm text-muted">
                    Select an approximate date before your account’s first transaction to restore
                    your shielded balance.
                  </p>
                  <label className="mb-2 block text-sm text-muted">Recovery start date</label>
                  <DatePicker
                    value={syncDate}
                    onChange={value => {
                      setSyncDate(value)
                      selectRestoreMethod('date')
                    }}
                    ariaLabel="First ZEC transaction date"
                    minDate={dayjs(DEFAULT_NETWORK === 'mainnet' ? '2018-10-01' : '2018-01-01')}
                    placeholder="Select date"
                  />
                </div>
              )}
            </div>
          )}
        </fieldset>

        <div className="px-5 pb-5 pt-2">
          {error && (
            <InlineError
              message={error}
              onRetry={error && retryable ? () => void handleContinue() : undefined}
              retrying={isImporting}
              className="mb-3"
            />
          )}
          <Button
            onClick={handleContinue}
            disabled={isImporting}
            isLoading={isImporting}
            className="h-[45px] w-full"
          >
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  selected,
  onSelect
}: {
  readonly title: string
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
        'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        selected
          ? 'border-primary/60 bg-primary/5'
          : 'border-white/10 bg-card hover:border-white/20'
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
          selected ? 'border-primary' : 'border-muted'
        )}
      >
        {selected && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="text-sm font-medium text-foreground">{title}</span>
    </button>
  )
}
