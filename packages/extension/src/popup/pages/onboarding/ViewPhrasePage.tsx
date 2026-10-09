import { useState, useEffect } from 'react'
import { WALLET_CONFIG } from '@/config/wallet'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { WarningBox } from '../../components/ui/WarningBox'
import { SeedPhraseDisplay } from '../../components/seed-phrase/SeedPhraseDisplay'
import { LabeledCheckbox } from '../../components/common/LabeledCheckbox'
import { CopyToast, useCopyToClipboard } from '../../components/common/CopyToast'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'

export function ViewPhrasePage() {
  const { navigate } = useNavigate()
  const {
    seedPhrase,
    acknowledgedWarning,
    setAcknowledgedWarning,
    generateSeedPhrase,
    isLoading,
    error
  } = useOnboardingStore()

  const [isBlurred, setIsBlurred] = useState(true)
  const { copyToClipboard, showToast } = useCopyToClipboard()

  useEffect(() => {
    if (seedPhrase.length === 0) {
      // generateSeedPhrase is now async
      generateSeedPhrase()
    }
  }, []) // Remove generateSeedPhrase from deps to avoid re-triggering

  const handleNext = () => {
    navigate('/onboarding/confirm-phrase')
  }

  // Show loading state while WASM is being loaded
  if (isLoading) {
    return (
      <div className="page-container">
        <PageHeader showBack />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted">Loading secure module...</p>
          </div>
        </div>
      </div>
    )
  }

  // Show error if WASM loading failed
  if (error) {
    return (
      <div className="page-container">
        <PageHeader showBack />
        <div className="flex-1 flex items-center justify-center px-5">
          <div className="text-center">
            <p className="text-danger mb-4">{error}</p>
            <Button onClick={() => generateSeedPhrase()}>Retry</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <CopyToast show={showToast} />
      <PageHeader title="View Secret Phrase" showBack />

      <div className="flex-1 px-5 pt-3 overflow-y-auto">
        <p className="text-sm text-muted mb-4">
          Store these {WALLET_CONFIG.MNEMONIC_LENGTH} words securely to restore your wallet anytime.
          Sharing your seed phrase may cause you to lose your assets.
        </p>

        <div className="relative mb-4">
          <SeedPhraseDisplay
            words={seedPhrase}
            blurred={isBlurred}
            onReveal={() => setIsBlurred(false)}
            onCopy={() => copyToClipboard(seedPhrase.join(' '))}
          />
        </div>
      </div>

      <div className="px-5 pt-4 pb-5 space-y-4">
        <div className="flex justify-center">
          <LabeledCheckbox
            checked={acknowledgedWarning}
            onChange={setAcknowledgedWarning}
            label="I acknowledge"
          />
        </div>
        <Button onClick={handleNext} disabled={!acknowledgedWarning} className="w-full h-[45px]">
          Next
        </Button>
      </div>
    </div>
  )
}
