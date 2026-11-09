import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { getDefaultImportNetworkFamilies } from '@/core/wallet/account-network-selection'
import { availableSoftwareAccountFamilies } from '@/popup/services/account-network-selection-client'
import { AccountNetworkFamilyChoices } from '@/popup/components/account/AccountNetworkFamilyChoices'
import { ImportZcashHistorySheet } from '@/popup/components/onboarding/ImportZcashHistorySheet'
import { InlineError } from '@/popup/components/common/InlineError'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import type { AccountNetworkFamily } from '@/core/wallet/account-network-selection'

export function ImportAccountsPage() {
  const { navigate, replace } = useNavigate()
  const {
    flowMode,
    importedSeedPhrase,
    mnemonicWordCount,
    accountName,
    selectedNetworkFamilies,
    setSelectedNetworkFamilies,
    addImportedWallet,
    isLoading,
    error
  } = useOnboardingStore()
  const availableFamilies = useMemo(() => availableSoftwareAccountFamilies(), [])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [addressPreviews, setAddressPreviews] = useState<
    Partial<Record<AccountNetworkFamily, string>>
  >({})
  const [addressesLoading, setAddressesLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const selected =
    selectedNetworkFamilies ?? getDefaultImportNetworkFamilies(mnemonicWordCount, availableFamilies)

  useEffect(() => {
    if (!importedSeedPhrase) replace('/onboarding/import')
  }, [importedSeedPhrase, replace])

  useEffect(() => {
    if (!importedSeedPhrase) return
    let cancelled = false
    setAddressPreviews({})
    setAddressesLoading(true)
    setPreviewFailed(false)
    void zcashWalletRuntimeClient
      .previewSoftwareWalletAddresses({
        mnemonic: importedSeedPhrase,
        selectedNetworkFamilies: availableFamilies
      })
      .then(previews => {
        if (!cancelled)
          setAddressPreviews(
            Object.fromEntries(previews.map(preview => [preview.family, preview.address]))
          )
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true)
      })
      .finally(() => {
        if (!cancelled) setAddressesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [importedSeedPhrase, availableFamilies, previewAttempt])

  const handleContinue = async () => {
    if (selected.length === 0) return
    setSelectedNetworkFamilies(selected)
    if (selected.includes('zcash')) {
      setHistoryOpen(true)
      return
    }
    if (flowMode === 'addWallet') {
      const success = await addImportedWallet()
      if (success) replace('/onboarding/congratulations')
      return
    }
    navigate('/onboarding/import-password')
  }

  return (
    <div className="page-container">
      <PageHeader title="Import Accounts" showBack backDisabled={isLoading} />
      <div className="page-content min-w-0 px-4 py-5">
        <div className="rounded-lg bg-card px-4 py-4">
          <h1 className="truncate text-base font-medium">{accountName.trim() || 'Account 1'}</h1>
          <div className="mt-3">
            <AccountNetworkFamilyChoices
              availableFamilies={availableFamilies}
              selectedFamilies={selected}
              onChange={setSelectedNetworkFamilies}
              disabled={isLoading}
              showZcashSyncWarning
              addressPreviews={addressPreviews}
              addressesLoading={addressesLoading}
            />
            {previewFailed && (
              <InlineError
                message="Could not load addresses."
                onRetry={() => setPreviewAttempt(attempt => attempt + 1)}
                className="mt-3"
              />
            )}
          </div>
        </div>
      </div>
      <div className="page-footer">
        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={() => void handleContinue()}
          disabled={isLoading || selected.length === 0}
          isLoading={isLoading}
          className="h-[45px] w-full"
        >
          Continue
        </Button>
      </div>
      {historyOpen && <ImportZcashHistorySheet onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
