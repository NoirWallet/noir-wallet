import { PASSWORD_POLICY } from '@/config/wallet'
import { MAX_ACCOUNT_NAME_CODE_POINTS } from '@/core/wallet/account-name'
import { useTranslation } from '@/popup/i18n'
import { onboardingMessages } from '@/popup/i18n/onboarding-messages'

const errorKeys = [
  'phraseMismatch',
  'confirmBeforeCreate',
  'generatePhraseFailed',
  'unexpectedPhraseLength',
  'selectNetwork',
  'passwordOnlyWhitespace',
  'passwordsMismatch',
  'termsRequired',
  'importFailed',
  'invalidNetworkHeight',
  'tooManyAttempts',
  'incorrectPassword',
  'incorrectPasswordRetry',
  'invalidPassword',
  'missingCredential',
  'invalidCredential',
  'unlockFailed',
  'connectionFailed',
  'timedOut',
  'requestTimedOut',
  'engineError',
  'engineUnresponsive',
  'engineCrashed',
  'invalidRecoveryPhrase',
  'accountConflict',
  'walletLocked',
  'walletInitializing',
  'walletStateChanged',
  'walletNotFound',
  'walletLoadFailed',
  'walletSaveFailed'
] as const satisfies readonly (keyof typeof onboardingMessages)[]

const errorKeyByMessage = new Map(errorKeys.map(key => [onboardingMessages[key][0], key] as const))
const localizedErrorKeys: ReadonlyMap<string, (typeof errorKeys)[number]> = errorKeyByMessage

type ErrorFallback =
  | 'generatePhraseFailed'
  | 'createFailed'
  | 'importFailed'
  | 'unlockFailed'
  | 'recoveryDateFailed'

export function useOnboardingTranslation() {
  const { t, locale } = useTranslation(onboardingMessages)
  const min = PASSWORD_POLICY.MIN_LENGTH
  const max = PASSWORD_POLICY.MAX_LENGTH

  const errorText = (message: string, fallback: ErrorFallback) => {
    if (locale === 'en') return message

    const key = localizedErrorKeys.get(message)
    if (key) return t(key)

    if (message === `Password must be at least ${min} characters`) {
      return t('passwordTooShort', { min })
    }
    if (message === `Password must be no more than ${max} characters`) {
      return t('passwordTooLong', { max })
    }
    if (message === `Account name must contain 1-${MAX_ACCOUNT_NAME_CODE_POINTS} characters`) {
      return t('accountNameInvalid', { max: MAX_ACCOUNT_NAME_CODE_POINTS })
    }

    return t(fallback)
  }

  return { t, locale, errorText }
}
