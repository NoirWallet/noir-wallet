import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { WarningBox } from '../ui/WarningBox'
import WalletIcon from '@/images/wallet-icon.svg'
import { PasswordInput } from './PasswordInput'
import { classifyError } from '@/lib/errors'
import { useNavigate } from '../../provider/Router'
import { rehydrateWalletStore } from '@/store/wallet-store'
import { openModal } from '../../provider/ModalManager'
import { DialogFooter } from '../ui/dialog'
import { SecureStorage } from '@/core/wallet/secure-storage'
import { BlockingWalletFailure } from '../shell/BlockingWalletFailure'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import { getUnlockFailureMessage } from '@/popup/services/unlock-failure-message'
import { useOnboardingTranslation } from '../onboarding/useOnboardingTranslation'

type UnlockError =
  | { key: 'emptyPassword' | 'tooManyAttempts' | 'resetFailed' }
  | { key: 'waitForUnlock'; seconds: number }
  | { key: 'remainingAttempts'; count: number }
  | { message: string }

interface UnlockFormProps {
  onUnlockSuccess?: () => void | Promise<void>
  onCancel?: () => void
  showCancelButton?: boolean
  showForgotPassword?: boolean
  showWalletIcon?: boolean
  title?: string
  description?: string
  headerContent?: React.ReactNode
}

export function UnlockForm({
  onUnlockSuccess,
  onCancel,
  showCancelButton = false,
  showForgotPassword = true,
  showWalletIcon = true,
  title,
  description,
  headerContent
}: UnlockFormProps) {
  const { t, errorText } = useOnboardingTranslation()
  const { replace } = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<UnlockError | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lockRemainingSeconds, setLockRemainingSeconds] = useState(0)
  const [isAccountLocked, setIsAccountLocked] = useState(false)
  const [walletUpgradeFailed, setWalletUpgradeFailed] = useState(false)

  useEffect(() => {
    checkLockStatus()
  }, [])

  useEffect(() => {
    if (lockRemainingSeconds <= 0) {
      setIsAccountLocked(false)
      return
    }

    const timer = setInterval(() => {
      setLockRemainingSeconds(prev => {
        if (prev <= 1) {
          setIsAccountLocked(false)
          checkLockStatus()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [lockRemainingSeconds])

  const checkLockStatus = async () => {
    const status = await SecureStorage.getLoginAttempts()
    if (status.isLocked) {
      setIsAccountLocked(true)
      setLockRemainingSeconds(Math.ceil(status.lockRemainingMs / 1000))
    } else {
      setIsAccountLocked(false)
    }
  }

  const handleUnlock = async () => {
    if (isLoading) return
    if (!password) {
      setError({ key: 'emptyPassword' })
      return
    }

    if (isAccountLocked) {
      setError({ key: 'waitForUnlock', seconds: lockRemainingSeconds })
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await zcashWalletRuntimeClient.unlock(password)
      if (result.needsWalletImport) {
        await rehydrateWalletStore()
        setPassword('')
        replace('/onboarding')
        return
      }
      if (result.upgradeFailed) {
        setWalletUpgradeFailed(true)
        return
      }
      if (result.success) {
        await rehydrateWalletStore()
        setPassword('')

        if (onUnlockSuccess) {
          await onUnlockSuccess()
        }
      } else if (result.isLocked) {
        setIsAccountLocked(true)
        setLockRemainingSeconds(Math.ceil((result.lockRemainingMs || 0) / 1000))
        setError({ key: 'tooManyAttempts' })
      } else {
        const message = getUnlockFailureMessage(result)
        const count = result.remainingAttempts
        setError(
          count !== undefined && message === `Incorrect password. ${count} attempts remaining.`
            ? { key: 'remainingAttempts', count }
            : { message }
        )
      }
    } catch (err) {
      setError({ message: classifyError(err).userMessage })
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    const confirmed = await openModal<boolean>({
      title: t('resetWallet'),
      body: resolve => (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted">{t('resetRestore')}</p>
            <p className="text-sm text-muted">{t('resetRemovesWallet')}</p>
          </div>

          <WarningBox>{t('resetWarning')}</WarningBox>

          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => {
                resolve(false)
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resolve(true)
              }}
            >
              {t('resetWallet')}
            </Button>
          </DialogFooter>
        </div>
      )
    })

    if (confirmed) {
      setIsLoading(true)
      setError(null)
      try {
        await zcashWalletRuntimeClient.reset()
        replace('/onboarding')
      } catch {
        setError({ key: 'resetFailed' })
      } finally {
        setIsLoading(false)
      }
    }
  }

  if (walletUpgradeFailed) {
    return (
      <BlockingWalletFailure
        title={t('upgradeFailed')}
        description={t('upgradeLocked')}
        assurance={t('upgradeAssurance')}
        isRetrying={isLoading}
        onRetry={handleUnlock}
      />
    )
  }

  const passwordError =
    error &&
    ('message' in error
      ? errorText(error.message, 'unlockFailed')
      : error.key === 'waitForUnlock'
        ? t(error.key, { seconds: error.seconds })
        : error.key === 'remainingAttempts'
          ? t(error.key, { count: error.count })
          : t(error.key))

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-8">
        {headerContent}

        {showWalletIcon && !headerContent && (
          <div className="mb-6">
            <img src={WalletIcon} alt={t('wallet')} />
          </div>
        )}

        <h1 className="text-lg font-semibold text-center mb-2">
          {title ?? t('enterPasswordTitle')}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground text-center mb-6">{description}</p>
        )}

        <div className="w-full max-w-sm space-y-4">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder={t('enterPassword')}
            error={passwordError ?? undefined}
            onEnter={handleUnlock}
            disabled={isAccountLocked || isLoading}
          />

          {isAccountLocked && lockRemainingSeconds > 0 && (
            <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
              <p className="text-sm text-destructive text-center">
                <span aria-hidden="true">🔒 </span>
                {t('lockCountdown', { seconds: lockRemainingSeconds })}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-3">
        <div className="flex gap-3">
          {showCancelButton && onCancel && (
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 h-[45px]"
            >
              {t('cancel')}
            </Button>
          )}
          <Button
            onClick={handleUnlock}
            disabled={!password || isAccountLocked}
            isLoading={isLoading}
            className={`h-[45px] ${showCancelButton ? 'flex-1' : 'w-full'}`}
          >
            {isAccountLocked ? t('lockedButton', { seconds: lockRemainingSeconds }) : t('unlock')}
          </Button>
        </div>

        {showForgotPassword && (
          <button
            onClick={handleForgotPassword}
            className="w-full text-center text-sm text-primary hover:text-primary/80 transition-colors py-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('forgotPassword')}
          </button>
        )}
      </div>
    </div>
  )
}
