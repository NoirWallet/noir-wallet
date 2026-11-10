import { Input } from '@/popup/components/ui/input'
import {
  getAccountNameValidationError,
  MAX_ACCOUNT_NAME_CODE_POINTS
} from '@/core/wallet/account-name'

interface OnboardingAccountNameFieldProps {
  readonly value: string
  readonly onChange: (value: string) => void
}

export function OnboardingAccountNameField({ value, onChange }: OnboardingAccountNameFieldProps) {
  const error = getAccountNameValidationError(value)

  return (
    <div>
      <label htmlFor="onboarding-account-name" className="mb-2 block text-sm text-muted">
        Account name
      </label>
      <Input
        id="onboarding-account-name"
        value={value}
        onChange={event => onChange(event.target.value)}
        maxLength={MAX_ACCOUNT_NAME_CODE_POINTS}
        placeholder="Account 1"
        aria-invalid={Boolean(error)}
        className="h-[45px] rounded-xl"
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}
