import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import WalletIcon from '@/images/wallet-icon.svg'
import { PasswordInput } from './PasswordInput'
import { accountManager } from '@/core/wallet/account-manager'
import { classifyError } from '@/lib/errors'
import { useNavigate } from '../../provider/Router'
import { openModal } from '../../provider/ModalManager'
import { SecureStorage } from '@/core/wallet/secure-storage'

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
  title = 'Enter your password',
  description,
  headerContent
}: UnlockFormProps) {
  const { replace } = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lockRemainingSeconds, setLockRemainingSeconds] = useState(0)
  const [isAccountLocked, setIsAccountLocked] = useState(false)

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
    if (!password) {
      setError('Please enter your password')
      return
    }

    if (isAccountLocked) {
      setError(`Account locked. Please wait ${lockRemainingSeconds} seconds.`)
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await accountManager.unlock(password, {
        allowMissingCredentialRecovery: true
      })
      if (result.success) {
        if (onUnlockSuccess) {
          await onUnlockSuccess()
        }
      } else if (result.isLocked) {
        setIsAccountLocked(true)
        setLockRemainingSeconds(Math.ceil((result.lockRemainingMs || 0) / 1000))
        setError('Too many failed attempts. Account temporarily locked.')
      } else if (result.failure === 'credential_missing') {
        setError(
          'Wallet credentials are missing from this device. Restore your wallet to continue.'
        )
      } else if (result.failure === 'credential_invalid') {
        setError('Wallet credentials are damaged. Restore your wallet to continue.')
      } else if (result.failure === 'operation_failed') {
        setError('Unable to unlock your wallet. Please try again.')
      } else {
        if (result.remainingAttempts !== undefined && result.remainingAttempts <= 2) {
          setError(`Incorrect password. ${result.remainingAttempts} attempts remaining.`)
        } else {
          setError('Incorrect password')
        }
      }
    } catch (err) {
      setError(classifyError(err).userMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    const confirmed = await openModal<boolean>({
      title: 'Reset Wallet',
      body: (resolve, close) => (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted">
              If you forgot your password, you'll need to reset your wallet using your Secret
              Recovery Phrase.
            </p>
            <p className="text-sm text-muted">
              This will remove your current wallet from this device.
            </p>
          </div>

          <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
            <p className="text-xs text-yellow-500">
              ⚠️ Make sure you have your Secret Recovery Phrase before proceeding.
            </p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                close()
                resolve(false)
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                close()
                resolve(true)
              }}
              className="flex-1"
            >
              Reset Wallet
            </Button>
          </div>
        </div>
      )
    })

    if (confirmed) {
      setIsLoading(true)
      setError('')
      try {
        await accountManager.clearWalletData()
        replace('/onboarding')
      } catch {
        setError('Unable to reset wallet. Please try again.')
      } finally {
        setIsLoading(false)
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-8">
        {headerContent}

        {showWalletIcon && !headerContent && (
          <div className="mb-6">
            <img src={WalletIcon} alt="Wallet" />
          </div>
        )}

        <h1 className="text-lg font-semibold text-center mb-2">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground text-center mb-6">{description}</p>
        )}

        <div className="w-full max-w-sm space-y-4">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Enter Password"
            error={error}
            onEnter={handleUnlock}
            disabled={isAccountLocked}
          />

          {isAccountLocked && lockRemainingSeconds > 0 && (
            <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
              <p className="text-sm text-destructive text-center">
                🔒 Account locked. Try again in {lockRemainingSeconds}s
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
              Cancel
            </Button>
          )}
          <Button
            onClick={handleUnlock}
            disabled={!password || isAccountLocked}
            isLoading={isLoading}
            className={`h-[45px] ${showCancelButton ? 'flex-1' : 'w-full'}`}
          >
            {isAccountLocked ? `Locked (${lockRemainingSeconds}s)` : 'Unlock'}
          </Button>
        </div>

        {showForgotPassword && (
          <button
            onClick={handleForgotPassword}
            className="w-full text-center text-sm text-primary hover:text-primary/80 transition-colors py-2"
          >
            Forgot password?
          </button>
        )}
      </div>
    </div>
  )
}
