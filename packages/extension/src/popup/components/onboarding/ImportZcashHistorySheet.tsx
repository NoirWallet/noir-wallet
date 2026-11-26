import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { InlineError } from '../common/InlineError'
import type { ZcashHistoryMode, ZcashRestoreMethod } from '../zcash/ZcashHistoryFields'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import { getFullZcashRecoveryBirthdayHeight } from '@/core/wallet/birthday-height'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { classifyError } from '@/lib/errors'
import { LatestAttempt } from '@/lib/async-utils'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'
import { useOnboardingTranslation } from './useOnboardingTranslation'
import { OnboardingRecoveryDatePicker } from './OnboardingRecoveryDatePicker'
import {
  getImportZcashHistoryDefaults,
  parseZcashHistoryRecoveryHeight,
  resolveZcashHistoryRecoveryDate
} from '@/popup/services/import-zcash-history-selection'

type HistoryValidationKey = 'invalidHeight' | 'heightTooLow' | 'missingRecoveryDate'

class ZcashHistoryValidationError extends Error {
  constructor(readonly key: HistoryValidationKey) {
    super(key)
  }
}

const historyChoices = [
  { value: 'new', label: 'newZcashAccount' },
  { value: 'restore', label: 'restoreZcashAccount' }
] as const

const restoreChoices = [
  { value: 'date', label: 'date', icon: 'lucide:calendar-days' },
  { value: 'height', label: 'blockHeight', icon: 'lucide:blocks' }
] as const

export function ImportZcashHistorySheet({ onClose }: { readonly onClose: () => void }) {
  const { t, locale, errorText } = useOnboardingTranslation()
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
  const formattedHeight = fullRecoveryHeight.toLocaleString(locale)
  const [initialSelection] = useState(() =>
    getImportZcashHistoryDefaults(birthdayHeight, importZcashHistorySelection)
  )
  const [historyMode, setHistoryMode] = useState<ZcashHistoryMode>(initialSelection.historyMode)
  const [restoreMethod, setRestoreMethod] = useState<ZcashRestoreMethod>(
    initialSelection.restoreMethod
  )
  const [syncDate, setSyncDate] = useState<dayjs.Dayjs | null>(
    initialSelection.syncDate ? dayjs(initialSelection.syncDate) : null
  )
  const [syncHeight, setSyncHeight] = useState(initialSelection.syncHeight)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<
    | { message: string; fallback: 'importFailed' | 'recoveryDateFailed' }
    | { key: HistoryValidationKey }
    | null
  >(null)
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

  const selectHistoryMode = (mode: ZcashHistoryMode) => {
    resetPendingContinue()
    setHistoryMode(mode)
  }

  const selectRestoreMethod = (method: ZcashRestoreMethod) => {
    resetPendingContinue()
    setRestoreMethod(method)
  }

  const resolveBirthdayHeight = async (): Promise<number | undefined> => {
    if (historyMode === 'new') return undefined

    if (restoreMethod === 'height') {
      const parsed = parseZcashHistoryRecoveryHeight(syncHeight, fullRecoveryHeight)
      if (parsed.height === null) {
        throw new ZcashHistoryValidationError(
          parsed.error === 'format' ? 'invalidHeight' : 'heightTooLow'
        )
      }
      return parsed.height
    }

    if (!syncDate) {
      throw new ZcashHistoryValidationError('missingRecoveryDate')
    }
    return resolveZcashHistoryRecoveryDate(syncDate, fullRecoveryHeight, timestamp =>
      zcashWalletRuntimeClient.getBlockByTime(timestamp)
    )
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
        else {
          const message = useOnboardingStore.getState().error
          setError(message ? { message, fallback: 'importFailed' } : null)
        }
        return
      }
      navigate('/onboarding/import-password')
    } catch (cause) {
      if (!continueAttempts.current.isCurrent(attempt)) return
      const classified = classifyError(cause)
      const validationError = cause instanceof ZcashHistoryValidationError
      setError(
        validationError
          ? { key: cause.key }
          : { message: classified.userMessage, fallback: 'recoveryDateFailed' }
      )
      setRetryable(!validationError && classified.retryable)
    } finally {
      if (continueAttempts.current.isCurrent(attempt)) setIsImporting(false)
    }
  }

  const errorMessage =
    error &&
    ('key' in error
      ? t(error.key, { height: formattedHeight })
      : errorText(error.message, error.fallback))

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !(flowMode === 'addWallet' && isImporting)) onClose()
      }}
    >
      <DialogContent position="bottom" scroll="body" className="gap-0 p-0">
        <DialogHeader className="shrink-0 px-5 pb-4 pt-5">
          <DialogTitle className="sr-only">{t('zcashSetup')}</DialogTitle>
          <DialogDescription className="pr-8">{t('zcashReceivedBefore')}</DialogDescription>
        </DialogHeader>

        <fieldset
          disabled={flowMode === 'addWallet' && isImporting}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4"
        >
          <div role="radiogroup" aria-label={t('zcashSetup')} className="space-y-2">
            {historyChoices.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={historyMode === value}
                onClick={() => selectHistoryMode(value)}
                className={cn(
                  'flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                  historyMode === value
                    ? 'border-primary/60 bg-primary/5'
                    : 'border-white/10 bg-card hover:border-white/20'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                    historyMode === value ? 'border-primary' : 'border-muted'
                  )}
                >
                  {historyMode === value && <span className="size-2 rounded-full bg-primary" />}
                </span>
                <span className="text-sm font-medium text-foreground">{t(label)}</span>
              </button>
            ))}
          </div>
          {historyMode === 'restore' && (
            <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <div
                role="radiogroup"
                aria-label={t('zcashHistoryStart')}
                className="grid grid-cols-2 gap-2"
              >
                {restoreChoices.map(({ value, label, icon }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={restoreMethod === value}
                    onClick={() => selectRestoreMethod(value)}
                    className={cn(
                      'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-center text-[11px] font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                      restoreMethod === value
                        ? 'border-primary/60 bg-primary/5 text-foreground'
                        : 'border-white/10 bg-card text-muted hover:border-white/20 hover:text-foreground'
                    )}
                  >
                    <Icon icon={icon} width={16} height={16} aria-hidden="true" />
                    <span>{t(label)}</span>
                  </button>
                ))}
              </div>
              {restoreMethod === 'height' ? (
                <div>
                  <label
                    htmlFor="onboarding-zcash-height"
                    className="mb-2 block text-sm text-muted"
                  >
                    {t('blockHeight')}
                  </label>
                  <Input
                    id="onboarding-zcash-height"
                    type="text"
                    inputMode="numeric"
                    value={syncHeight}
                    onChange={event => {
                      resetPendingContinue()
                      setSyncHeight(event.target.value)
                    }}
                    placeholder={t('minimumHeight', { height: formattedHeight })}
                    aria-label={t('birthdayHeight')}
                    className="h-[45px] rounded-xl font-mono"
                  />
                </div>
              ) : (
                <div>
                  <div className="mb-2 text-sm text-muted">{t('recoveryStartDate')}</div>
                  <OnboardingRecoveryDatePicker
                    value={syncDate}
                    onChange={value => {
                      setSyncDate(value)
                      selectRestoreMethod('date')
                    }}
                    minDate={dayjs(DEFAULT_NETWORK === 'mainnet' ? '2018-10-01' : '2018-01-01')}
                  />
                </div>
              )}
            </div>
          )}
        </fieldset>

        <DialogFooter className="grid-flow-row px-5 pb-5 pt-2">
          {errorMessage && (
            <InlineError
              message={errorMessage}
              onRetry={retryable ? () => void handleContinue() : undefined}
              retrying={isImporting}
              retryLabel={t('retry')}
              className="mb-3"
            />
          )}
          <Button onClick={handleContinue} disabled={isImporting} isLoading={isImporting}>
            {t('continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
