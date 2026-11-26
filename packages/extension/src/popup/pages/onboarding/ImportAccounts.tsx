import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { getDefaultImportNetworkFamilies } from '@/core/wallet/account-network-selection'
import { availableSoftwareAccountFamilies } from '@/popup/services/account-network-selection-client'
import { OnboardingNetworkChoices } from '@/popup/components/onboarding/OnboardingNetworkChoices'
import { useOnboardingTranslation } from '@/popup/components/onboarding/useOnboardingTranslation'
import { DEFAULT_ACCOUNT_NAME } from '@/core/wallet/account-name'
import { ImportZcashHistorySheet } from '@/popup/components/onboarding/ImportZcashHistorySheet'
import { InlineError } from '@/popup/components/common/InlineError'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import type { AccountNetworkFamily } from '@/core/wallet/account-network-selection'
import { Checkbox } from '../../components/ui/checkbox'

export function ImportAccounts() {
  const { t, errorText } = useOnboardingTranslation()
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
  const previousSelection = useRef(selected)

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
      <PageHeader title={t('importAccounts')} showBack backDisabled={isLoading} />
      <div className="page-content min-w-0 px-4 pb-5 !pt-3">
        <p className="mb-1.5 px-1 text-sm leading-5 text-muted">{t('foundAccount')}</p>
        <label className="mb-3.5 flex min-h-[46px] cursor-pointer items-center justify-between gap-3 rounded-lg bg-popover px-4">
          <span className="text-base font-medium">
            {t(selected.length > 0 ? 'accountSelected' : 'noAccountsSelected')}
          </span>
          <Checkbox
            aria-label={t('selectAccount')}
            checked={selected.length > 0}
            disabled={isLoading}
            onCheckedChange={checked => {
              if (checked) {
                setSelectedNetworkFamilies(
                  previousSelection.current.length > 0
                    ? previousSelection.current
                    : getDefaultImportNetworkFamilies(mnemonicWordCount, availableFamilies)
                )
              } else {
                previousSelection.current = selected
                setSelectedNetworkFamilies([])
              }
            }}
            className="size-5 rounded-md data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
          />
        </label>
        <div className="rounded-lg bg-popover px-4 py-4">
          <h1 className="truncate text-base font-medium">
            {accountName.trim() || DEFAULT_ACCOUNT_NAME}
          </h1>
          <div className="mt-3">
            <OnboardingNetworkChoices
              availableFamilies={availableFamilies}
              selectedFamilies={selected}
              onChange={setSelectedNetworkFamilies}
              disabled={isLoading}
              addressPreviews={addressPreviews}
              addressesLoading={addressesLoading}
            />
            {previewFailed && (
              <InlineError
                message={t('addressesFailed')}
                retryLabel={t('retry')}
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
            {errorText(error, 'importFailed')}
          </p>
        )}
        <Button
          size="wallet"
          onClick={() => void handleContinue()}
          disabled={isLoading || selected.length === 0}
          isLoading={isLoading}
          className="h-[45px] w-full"
        >
          {t('continue')}
        </Button>
      </div>
      {historyOpen && <ImportZcashHistorySheet onClose={() => setHistoryOpen(false)} />}
    </div>
  )
}
