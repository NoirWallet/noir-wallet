import { OnboardingPasswordForm } from '../../components/onboarding/OnboardingPasswordForm'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'

export function ImportPassword() {
  const { navigate, goBack } = useNavigate()
  const { setPassword, importWallet } = useOnboardingStore()

  const handleSubmit = async (data: { new: string }) => {
    setPassword(data.new)
    const success = await importWallet()
    if (success) {
      navigate('/onboarding/congratulations')
    } else {
      const error = useOnboardingStore.getState().error
      throw new Error(error || 'Failed to import wallet')
    }
  }

  const handleBack = () => {
    goBack()
  }

  return <OnboardingPasswordForm mode="import" onSubmit={handleSubmit} onBack={handleBack} />
}
