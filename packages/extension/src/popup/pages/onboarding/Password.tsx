import { OnboardingPasswordForm } from '../../components/onboarding/OnboardingPasswordForm'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'

export function Password() {
  const { navigate, goBack } = useNavigate()
  const { setPassword } = useOnboardingStore()

  const handleSubmit = async (data: { new: string }) => {
    // Store the password
    setPassword(data.new)
    // Navigate to next step
    navigate('/onboarding/create-word-count')
  }

  const handleBack = () => {
    goBack()
  }

  return <OnboardingPasswordForm mode="create" onSubmit={handleSubmit} onBack={handleBack} />
}
