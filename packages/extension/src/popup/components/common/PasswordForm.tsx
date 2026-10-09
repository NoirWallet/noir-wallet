import { useState } from 'react'
import { Button } from '../ui/button'
import { PageHeader } from './PageHeader'
import { PasswordStrength } from './PasswordStrength'
import { PasswordInput } from './PasswordInput'
import { LabeledCheckbox } from './LabeledCheckbox'
import { WALLET_CONFIG } from '@/config/wallet'
import { classifyError } from '@/lib/errors'
import { openModal } from '../../provider/ModalManager'
import { TermsOfUse } from '../../pages/settings/TermsOfUse'

const MIN_PW = WALLET_CONFIG.SECURITY.MIN_PASSWORD_LENGTH

type PasswordFormMode = 'create' | 'import' | 'change'

interface PasswordFormProps {
  mode: PasswordFormMode
  title: string
  description: string
  submitText: string
  showTerms?: boolean
  onSubmit: (data: { current?: string; new: string }) => Promise<void>
  onBack?: () => void
}

export function PasswordForm({
  mode,
  title,
  description,
  submitText,
  showTerms = false,
  onSubmit,
  onBack
}: PasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isValid =
    password.length >= MIN_PW &&
    password === confirmPassword &&
    (!showTerms || agreedToTerms) &&
    (mode !== 'change' || currentPassword.length > 0)

  const handleSubmit = async () => {
    if (!isValid) return

    setError(null)
    setIsSubmitting(true)

    try {
      await onSubmit({
        current: mode === 'change' ? currentPassword : undefined,
        new: password
      })
    } catch (err) {
      setError(classifyError(err).userMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title={title} showBack={!!onBack} onBack={onBack} backDisabled={isSubmitting} />

      <div className="flex-1 px-5 pt-4 overflow-y-auto">
        <p className="text-base text-muted leading-relaxed mb-6">{description}</p>

        <div className="space-y-4">
          {mode === 'change' && (
            <PasswordInput
              label="Current Password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Enter current password"
            />
          )}

          <PasswordInput
            label={mode === 'change' ? 'New Password' : 'Password'}
            value={password}
            onChange={setPassword}
            placeholder={mode === 'change' ? 'Enter new password' : `At least ${MIN_PW} characters`}
          />

          <PasswordStrength password={password} />

          <PasswordInput
            label="Confirm Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm password"
            error={
              error ||
              (confirmPassword && password !== confirmPassword
                ? 'Passwords do not match'
                : undefined)
            }
          />
          <div className="text-xs text-muted">
            * Minimum {MIN_PW} characters required. Adding uppercase, lowercase, numbers, and
            symbols will make your password stronger.
          </div>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {showTerms && (
          <div className="flex justify-center">
            <LabeledCheckbox
              checked={agreedToTerms}
              onChange={setAgreedToTerms}
              label={
                <span>
                  I agree to the{' '}
                  <button
                    type="button"
                    onClick={() =>
                      openModal({
                        showCloseButton: true,
                        body: (_resolve: (v: any) => void, close: () => void) => (
                          <TermsOfUse embedded onClose={close} />
                        )
                      })
                    }
                    className="text-muted hover:text-foreground underline cursor-pointer"
                  >
                    Terms of Use
                  </button>
                </span>
              }
            />
          </div>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
          className="w-full h-[45px]"
        >
          {isSubmitting ? 'Processing...' : submitText}
        </Button>
      </div>
    </div>
  )
}
