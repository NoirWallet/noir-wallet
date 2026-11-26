import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { Icon } from '@iconify/react'
import { useOnboardingTranslation } from '@/popup/components/onboarding/useOnboardingTranslation'

export function SecureWallet() {
  const { t, errorText } = useOnboardingTranslation()
  const { navigate } = useNavigate()
  const { mnemonicWordCount, generateSeedPhrase, isLoading, error } = useOnboardingStore()

  const handleNext = async () => {
    await generateSeedPhrase()
    // Only navigate if no error
    if (!useOnboardingStore.getState().error) {
      navigate('/onboarding/view-phrase')
    }
  }

  return (
    <div className="page-container">
      <PageHeader title={t('secureWallet')} showBack />

      <div className="flex-1 px-5 pt-4">
        <div className="text-base text-muted leading-relaxed space-y-4">
          <p>{t('backUpNow')}</p>
          <p>{t('backupNextScreen', { count: mnemonicWordCount })}</p>
          <div className="rounded-xl border border-danger/30 bg-danger/[0.08] p-4">
            <div className="mb-3 flex items-center gap-2 text-danger/90">
              <Icon icon="lucide:shield-alert" width={17} height={17} />
              <span className="text-sm font-semibold">{t('protectPhrase')}</span>
            </div>
            <ul className="list-disc space-y-2 pl-5 text-foreground/80 marker:text-danger/70">
              <li>
                <strong>{t('storeSafely')}</strong> {t('writeDown')}
              </li>
              <li>
                <strong>{t('neverShare')}</strong> {t('phraseAccessWarning')}
              </li>
            </ul>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-danger text-sm mt-4">
            {errorText(error, 'generatePhraseFailed')}
          </p>
        )}
      </div>

      <div className="px-5 pb-5">
        <Button
          onClick={handleNext}
          disabled={isLoading}
          className="w-full h-[45px]"
          isLoading={isLoading}
        >
          {t('startBackup')}
        </Button>
      </div>
    </div>
  )
}
