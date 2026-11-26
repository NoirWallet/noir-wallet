import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import type { useWalletBackupVerification } from '@/popup/hooks/useWalletBackupVerification'
import { useTranslation } from '@/popup/i18n'
import { recoveryMessages } from '@/popup/i18n/recovery-messages'

export function BackupWordInputs({
  verification
}: {
  verification: ReturnType<typeof useWalletBackupVerification>
}) {
  const { locale, t } = useTranslation(recoveryMessages)
  const error = verification.error
  const errorText =
    error &&
    (locale === 'en'
      ? error
      : t(
          error === recoveryMessages.wrongWords[0]
            ? 'wrongWords'
            : error === recoveryMessages.unlockBeforeBackup[0]
              ? 'unlockBeforeBackup'
              : 'backupCheckFailed'
        ))
  if (verification.isPreparing)
    return (
      <div role="status" aria-label={t('prepareBackup')} className="space-y-4">
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-[46px] w-full rounded-lg" />
          </div>
        ))}
      </div>
    )
  if (!verification.wordIndices) {
    return errorText ? (
      <p role="alert" className="text-sm text-danger">
        {errorText}
      </p>
    ) : null
  }
  return (
    <div className="space-y-4">
      {verification.wordIndices.map((wordIndex, position) => (
        <label key={wordIndex} className="block text-sm text-muted">
          {t('wordNumber', { number: wordIndex + 1 })}
          <Input
            value={verification.words[position]}
            onChange={event => verification.setWord(position, event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 h-[46px]"
          />
        </label>
      ))}
      {errorText && (
        <p role="alert" className="text-sm text-danger">
          {errorText}
        </p>
      )}
    </div>
  )
}
