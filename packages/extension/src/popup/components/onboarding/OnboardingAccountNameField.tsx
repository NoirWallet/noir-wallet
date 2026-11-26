import { Input } from '@/popup/components/ui/input'
import { useOnboardingTranslation } from './useOnboardingTranslation'
import {
  getAccountNameValidationError,
  MAX_ACCOUNT_NAME_CODE_POINTS
} from '@/core/wallet/account-name'

interface OnboardingAccountNameFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label?: string
}

export function OnboardingAccountNameField({
  value,
  onChange,
  label
}: OnboardingAccountNameFieldProps) {
  const { t } = useOnboardingTranslation()
  const error = getAccountNameValidationError(value)

  return (
    <div>
      <label htmlFor="onboarding-account-name" className="mb-2 block text-sm text-muted">
        {label ?? t('accountName')}
      </label>
      <Input
        id="onboarding-account-name"
        value={value}
        onChange={event => onChange(event.target.value)}
        maxLength={MAX_ACCOUNT_NAME_CODE_POINTS}
        placeholder={t('accountNameExample')}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'onboarding-account-name-error' : undefined}
        className="h-[45px] rounded-xl"
      />
      {error && (
        <p id="onboarding-account-name-error" className="mt-1.5 text-xs text-destructive">
          {t('accountNameInvalid', { max: MAX_ACCOUNT_NAME_CODE_POINTS })}
        </p>
      )}
    </div>
  )
}
