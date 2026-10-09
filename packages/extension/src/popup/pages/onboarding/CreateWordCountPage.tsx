import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { MnemonicWordCountSelector } from '../../components/onboarding/MnemonicWordCountSelector'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { OnboardingAccountNameField } from '../../components/onboarding/OnboardingAccountNameField'
import { getAccountNameValidationError } from '@/core/wallet/account-name'

export function CreateWordCountPage() {
  const { navigate } = useNavigate()
  const { mnemonicWordCount, setMnemonicWordCount, accountName, setAccountName } =
    useOnboardingStore()
  const accountNameError = getAccountNameValidationError(accountName)

  return (
    <div className="page-container">
      <PageHeader title="Create wallet" showBack />

      <div className="page-content pt-6">
        <div className="text-sm text-muted leading-relaxed space-y-2">
          <p>Your Secret Recovery Phrase restores every account in this wallet.</p>
          <p>Choose the phrase length you want to back up.</p>
        </div>

        <div className="mt-6">
          <OnboardingAccountNameField value={accountName} onChange={setAccountName} />
        </div>

        <div className="mt-6">
          <p className="text-sm text-muted mb-3">Recovery phrase length</p>
          <MnemonicWordCountSelector value={mnemonicWordCount} onChange={setMnemonicWordCount} />
        </div>
      </div>

      <div className="page-footer">
        <Button
          onClick={() => navigate('/onboarding/secure-wallet')}
          disabled={Boolean(accountNameError)}
          className="w-full h-[45px]"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
