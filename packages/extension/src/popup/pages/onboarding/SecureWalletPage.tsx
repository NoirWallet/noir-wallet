import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import { WALLET_CONFIG } from '@/config/wallet'
import { useOnboardingStore } from '@/store/onboarding-store'

export function SecureWalletPage() {
  const { navigate } = useNavigate()
  const { generateSeedPhrase, isLoading, error } = useOnboardingStore()

  const handleNext = async () => {
    await generateSeedPhrase()
    // Only navigate if no error
    if (!useOnboardingStore.getState().error) {
      navigate('/onboarding/view-phrase')
    }
  }

  return (
    <div className="page-container">
      <PageHeader showBack />

      <div className="flex-1 px-5 pt-4">
        <h1 className="text-lg font-semibold mb-6">Secure your wallet</h1>

        <div className="text-base text-muted leading-relaxed space-y-4">
          <p>Secure your assets — back up your Secret Recovery Phrase now.</p>
          <p>
            On the next screen, you'll see your {WALLET_CONFIG.MNEMONIC_LENGTH}-word Secret Recovery
            Phrase.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Store it safely:</strong> Write it down and keep it in a secure location.
            </li>
            <li>
              <strong>Never share it:</strong> Anyone with this phrase gains permanent access to
              your assets. No official or support agent will ever ask for it.
            </li>
          </ul>
        </div>

        {error && <p className="text-danger text-sm mt-4">{error}</p>}
      </div>

      <div className="px-5 pb-5">
        <Button
          onClick={handleNext}
          disabled={isLoading}
          className="w-full h-[45px]"
          isLoading={isLoading}
        >
          Start backup
        </Button>
      </div>
    </div>
  )
}
