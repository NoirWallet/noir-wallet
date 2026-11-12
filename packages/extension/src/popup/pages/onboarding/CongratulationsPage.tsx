import { InlineError } from '@/popup/components/common/InlineError'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import WalletIcon from '@/images/wallet-icon.svg'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { useWalletStore } from '@/store/wallet-store'
import { useBetaInviteBinding } from '../../hooks/useBetaInviteBinding'
import { Pill } from '@/popup/components/multisig/Pill'
import { isMultisigUiEnabled } from '@/core/multisig/multisig-runtime-policy'
import { openMultisigCreateTab } from '@/lib/multisig-tab'

export function CongratulationsPage() {
  const { replace } = useNavigate()
  const { flowMode, mode, dappRequestId, reset } = useOnboardingStore()
  const { status, changeCode, error, busy, activate } = useBetaInviteBinding()
  const activationPending = status.required && status.state.phase !== 'activated'
  // Imported wallets and dApp-triggered onboarding keep the single "Got it" action.
  const showMultisig = isMultisigUiEnabled() && mode === 'create' && !dappRequestId && !error

  const handleComplete = async () => {
    if (activationPending) return
    reset()

    // If onboarding was triggered by dApp connection, redirect to approval page
    if (dappRequestId) {
      // Redirect to approval page where user can manually approve the connection
      replace(`/approval?requestId=${dappRequestId}`)
      return
    }

    // Normal onboarding flow
    if (flowMode === 'addWallet') {
      replace('/account-list')
    } else {
      replace('/')
    }
  }

  const handleStartWithMultisig = async () => {
    // handleComplete ignores clicks while activation is pending, so the tab must not open either.
    if (activationPending) return
    // Read before handleComplete resets the onboarding store. Adding a wallet leaves the current
    // wallet unchanged, so the created one must come from the store, not from the current wallet.
    const { createdWallet } = useOnboardingStore.getState()
    const { currentWalletId, currentAccountId } = useWalletStore.getState()
    const target =
      createdWallet ??
      (currentWalletId && currentAccountId
        ? { walletId: currentWalletId, accountId: currentAccountId }
        : null)
    // The popup navigates home below; the flow itself runs in the new full tab.
    if (target) openMultisigCreateTab(target)
    await handleComplete()
  }

  return (
    <div className="page-container">
      <PageHeader />

      <div className="flex-1 flex flex-col items-center justify-center px-5">
        <div className="mb-8">
          <img src={WalletIcon} alt="Wallet" />
        </div>

        <h1 className="text-lg font-medium text-center mb-3">Congratulations!</h1>

        <p className="text-xs text-foreground text-center leading-relaxed">
          Your wallet is ready. You can now securely send, receive, and store digital assets.
        </p>
      </div>

      <div className="px-5 pb-5">
        {error && (
          <div className="mb-3 space-y-2">
            <InlineError message={error} onRetry={() => void activate()} retrying={busy} />
            <Button variant="ghost" onClick={changeCode} disabled={busy} className="w-full h-10">
              Use another code
            </Button>
          </div>
        )}
        {!error && showMultisig && (
          <div className="space-y-4">
            <div className="space-y-0.5">
              <Button
                onClick={handleStartWithMultisig}
                disabled={activationPending || busy}
                isLoading={busy}
                className="relative w-full h-[45px] rounded-lg font-bold text-black"
              >
                Start with Multisig
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Pill tone="suggested">Suggested</Pill>
                </span>
              </Button>
              <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary text-center">
                <p>Multiple devices. One secure authorization.</p>
                <p>Makes your every transaction more secure.</p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={handleComplete}
              disabled={activationPending || busy}
              isLoading={busy}
              className="w-full h-[45px] rounded-lg border-primary hover:border-primary"
            >
              Start Directly
            </Button>
            <p className="text-xs text-foreground/70 text-center text-balance">
              Your recovery phrase securely manages all supported blockchain accounts.
            </p>
          </div>
        )}
        {!error && !showMultisig && (
          <Button
            onClick={handleComplete}
            disabled={activationPending || busy}
            isLoading={busy}
            className="w-full h-[45px]"
          >
            Got it
          </Button>
        )}
      </div>
    </div>
  )
}
