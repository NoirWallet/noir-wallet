import { useState } from 'react'
import { Button } from '../ui/button'
import { PageHeader } from '../common/PageHeader'
import { LabeledCheckbox } from '../common/LabeledCheckbox'
import { PASSWORD_POLICY } from '@/config/wallet'
import { getNewPasswordValidationError, getPasswordStrength } from '@/core/wallet/password-policy'
import { classifyError } from '@/lib/errors'
import { openModal } from '../../provider/ModalManager'
import { TermsOfUse } from '../../pages/settings/TermsOfUse'
import { PasswordInput } from '../auth/PasswordInput'
import { useOnboardingTranslation } from './useOnboardingTranslation'

const strengthDisplay = {
  'Too Weak': { label: 'strengthTooWeak', color: 'bg-danger' },
  Weak: { label: 'strengthWeak', color: 'bg-warning' },
  Medium: { label: 'strengthMedium', color: 'bg-warning' },
  Strong: { label: 'strengthStrong', color: 'bg-success' }
} as const

const termsMarker = '\uFFFC'
const passwordLimits = { min: PASSWORD_POLICY.MIN_LENGTH, max: PASSWORD_POLICY.MAX_LENGTH }

export function OnboardingPasswordForm({
  mode,
  onSubmit,
  onBack
}: {
  readonly mode: 'create' | 'import'
  readonly onSubmit: (data: { new: string }) => Promise<void>
  readonly onBack: () => void
}) {
  const { t, errorText } = useOnboardingTranslation()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const passwordError = getNewPasswordValidationError(password)
  const isValid = !passwordError && password === confirmPassword && agreedToTerms
  const { strength, score } = getPasswordStrength(password)
  const [beforeTerms, afterTerms] = t('agreeToTerms', { terms: termsMarker }).split(termsMarker)
  const isCreate = mode === 'create'

  const handleSubmit = async () => {
    if (!isValid) return

    setError(null)
    setIsSubmitting(true)
    try {
      await onSubmit({ new: password })
    } catch (cause) {
      setError(classifyError(cause).userMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader
        title={t('createPassword')}
        showBack
        onBack={onBack}
        backDisabled={isSubmitting}
      />

      <div className="flex-1 px-5 pt-4 overflow-y-auto">
        <p className="text-base text-muted leading-relaxed mb-6">
          {t(isCreate ? 'createPasswordDescription' : 'importPasswordDescription')}
        </p>

        <div className="space-y-4">
          <PasswordInput
            label={t('password')}
            value={password}
            onChange={setPassword}
            placeholder={t('passwordLength', passwordLimits)}
            error={password && passwordError ? errorText(passwordError, 'createFailed') : undefined}
          />

          {password && (
            <div className="space-y-2">
              <div className="flex gap-1" aria-hidden="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                      index < score ? strengthDisplay[strength].color : 'bg-white/20'
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-default-500">{t(strengthDisplay[strength].label)}</p>
            </div>
          )}

          <PasswordInput
            label={t('confirmPassword')}
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder={t('confirmPasswordPlaceholder')}
            error={
              error
                ? errorText(error, isCreate ? 'createFailed' : 'importFailed')
                : confirmPassword && password !== confirmPassword
                  ? t('passwordsMismatch')
                  : undefined
            }
          />
          <div className="text-xs text-muted">{t('passwordInstructions', passwordLimits)}</div>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        <div className="flex justify-center">
          <LabeledCheckbox
            checked={agreedToTerms}
            onChange={setAgreedToTerms}
            label={
              <span>
                {beforeTerms}
                <button
                  type="button"
                  onClick={() =>
                    openModal({ showCloseButton: true, body: () => <TermsOfUse embedded /> })
                  }
                  className="text-muted hover:text-foreground underline cursor-pointer"
                >
                  {t('termsOfUse')}
                </button>
                {afterTerms}
              </span>
            }
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
          className="w-full h-[45px]"
        >
          {t(isSubmitting ? 'processing' : isCreate ? 'create' : 'importWalletButton')}
        </Button>
      </div>
    </div>
  )
}
