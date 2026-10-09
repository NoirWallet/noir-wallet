import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/common/PageHeader'
import { SeedPhraseDisplay } from '../../components/seed-phrase/SeedPhraseDisplay'
import { BackupWordInputs } from '../../components/seed-phrase/BackupWordInputs'
import { useWalletBackupVerification } from '../../hooks/useWalletBackupVerification'
import { CopyToast, useCopyToClipboard } from '../../components/common/CopyToast'
import { useLocation, useNavigate } from '../../provider/Router'
import { accountManager } from '@/core/wallet/account-manager'
import { getWalletsNeedingSecretPhraseBackup } from '@/core/wallet/secret-phrase-backup'
import { didWalletSessionEnd } from '@/core/wallet/session-state'
import { classifyError } from '@/lib/errors'
import { formatWalletBackupName } from '@/lib/format'
import { useWalletStore } from '@/store/wallet-store'

type BackupStep = 'password' | 'phrase' | 'confirm'

export function ViewSeedPhrase() {
  const [searchParams] = useSearchParams()
  const walletId = searchParams.get('walletId')
  const backupMode = searchParams.get('backup') === '1'

  return (
    <SeedPhraseContent
      key={`${walletId ?? ''}:${backupMode}`}
      walletId={walletId}
      backupMode={backupMode}
    />
  )
}

function SeedPhraseContent({
  walletId,
  backupMode
}: {
  walletId: string | null
  backupMode: boolean
}) {
  const wallets = useWalletStore(state => state.wallets)
  const displayNames = useWalletStore(state => state.accountDisplayNames)
  const targetWalletId = useRef(walletId ?? useWalletStore.getState().currentWalletId).current
  const targetWallet = targetWalletId
    ? wallets.find(wallet => wallet.id === targetWalletId)
    : undefined
  const backupTarget =
    backupMode && walletId
      ? getWalletsNeedingSecretPhraseBackup(wallets).some(wallet => wallet.id === walletId)
      : false
  const targetName = targetWallet ? formatWalletBackupName(targetWallet, wallets, displayNames) : ''
  const { goBack, replace } = useNavigate()
  const location = useLocation()
  const hasReturnPage =
    location.state &&
    typeof location.state === 'object' &&
    'fromBackupBanner' in location.state &&
    location.state.fromBackupBanner === true

  const [password, setPassword] = useState('')
  const [step, setStep] = useState<BackupStep>('password')
  const [isVerifying, setIsVerifying] = useState(false)
  const [seedPhrase, setSeedPhrase] = useState<string[]>([])
  const [isBlurred, setIsBlurred] = useState(true)
  const backupVerification = useWalletBackupVerification(targetWalletId)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [error, setError] = useState('')
  const requestVersion = useRef(0)
  const mounted = useRef(true)
  const sessionEndedRef = useRef(false)
  const confirmationInFlight = useRef(false)
  const { copyToClipboard, showToast } = useCopyToClipboard()

  const clearSecrets = () => {
    setPassword('')
    setSeedPhrase([])
    backupVerification.reset()
    setIsBlurred(true)
    setIsVerifying(false)
  }

  const returnToPage = () => {
    if (!backupMode || hasReturnPage) goBack()
    else replace('/')
  }

  const requestIsCurrent = (version: number, requirePendingBackup: boolean) => {
    if (!mounted.current || sessionEndedRef.current || requestVersion.current !== version)
      return false
    if (accountManager.isLocked()) return false
    if (!requirePendingBackup) {
      return Boolean(targetWalletId && useWalletStore.getState().getWallet(targetWalletId))
    }
    return Boolean(
      walletId &&
      getWalletsNeedingSecretPhraseBackup(useWalletStore.getState().wallets).some(
        wallet => wallet.id === walletId
      )
    )
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestVersion.current += 1
    }
  }, [])

  useEffect(() => {
    if (!targetWallet || (backupMode && !backupTarget && !confirmationInFlight.current)) {
      requestVersion.current += 1
      clearSecrets()
    }
  }, [backupMode, backupTarget, targetWallet])

  useEffect(() => {
    const handleSessionChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (!didWalletSessionEnd(changes, areaName)) return
      sessionEndedRef.current = true
      requestVersion.current += 1
      clearSecrets()
      setSessionEnded(true)
    }

    chrome.storage.onChanged.addListener(handleSessionChange)
    return () => chrome.storage.onChanged.removeListener(handleSessionChange)
  }, [])

  const handleUnlock = async () => {
    if (!password) {
      setError('Please enter your password')
      return
    }
    if (!targetWallet || (backupMode && !backupTarget)) return

    const version = ++requestVersion.current
    setIsVerifying(true)
    setError('')

    try {
      const phrase = await accountManager.getSeedPhrase(password, targetWalletId ?? undefined)
      if (!requestIsCurrent(version, backupMode)) return
      if (phrase) {
        setPassword('')
        setSeedPhrase(phrase.split(' '))
        setStep('phrase')
      } else {
        setError('Failed to retrieve secret phrase')
      }
    } catch (err) {
      if (requestIsCurrent(version, backupMode)) setError(classifyError(err).userMessage)
    } finally {
      if (requestIsCurrent(version, backupMode)) setIsVerifying(false)
    }
  }

  const handleContinue = async () => {
    if (!backupMode || !walletId || !backupTarget) return
    requestVersion.current += 1
    setSeedPhrase([])
    setIsBlurred(true)
    setError('')
    setStep('confirm')
    await backupVerification.prepare()
  }

  const handleConfirm = async () => {
    if (!backupMode || !walletId || !backupTarget) return
    await backupVerification.submit(async verification => {
      const version = ++requestVersion.current
      confirmationInFlight.current = true
      try {
        await accountManager.confirmWalletBackup(walletId, verification)
        if (!requestIsCurrent(version, false)) return
        clearSecrets()
        returnToPage()
      } finally {
        confirmationInFlight.current = false
      }
    })
  }

  const handleBack = () => {
    requestVersion.current += 1
    clearSecrets()
    setError('')
    if (step === 'confirm') {
      setStep('password')
      return
    }
    returnToPage()
  }

  if (sessionEnded || accountManager.isLocked()) return null

  if (
    !targetWallet ||
    (backupMode && !backupTarget && !(confirmationInFlight.current && targetWallet))
  ) {
    return (
      <div className="page-container">
        <PageHeader
          title={backupMode ? 'Back up secret phrase' : 'View secret phrase'}
          showBack
          onBack={returnToPage}
        />
        <div className="page-content text-sm text-muted">Wallet unavailable.</div>
      </div>
    )
  }

  const title = backupMode ? 'Back up secret phrase' : 'View secret phrase'

  if (step === 'password') {
    return (
      <div className="page-container">
        <PageHeader title={title} showBack onBack={handleBack} />
        <div className="page-content">
          {backupMode && <p className="mb-4 text-sm font-medium break-words">{targetName}</p>}
          <p className="mb-5 text-sm text-muted">
            Sharing your secret phrase may cause you to lose your assets
          </p>
          <label htmlFor="secret-phrase-password" className="block text-sm text-muted mb-2">
            Enter Password
          </label>
          <Input
            id="secret-phrase-password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            className="h-[46px] rounded-xl mb-4"
            onKeyDown={event => event.key === 'Enter' && void handleUnlock()}
          />
          {error && (
            <p role="alert" className="text-sm text-red-500 mt-2">
              {error}
            </p>
          )}
        </div>
        <div className="page-footer">
          <Button
            disabled={!password}
            isLoading={isVerifying}
            onClick={handleUnlock}
            className="w-full h-[45px]"
          >
            Unlock to reveal
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'confirm') {
    return (
      <div className="page-container">
        <PageHeader
          title="Confirm backup"
          showBack
          backDisabled={backupVerification.isSubmitting}
          onBack={handleBack}
        />
        <div className="page-content">
          <p className="mb-5 text-sm font-medium break-words">{targetName}</p>
          <BackupWordInputs verification={backupVerification} />
        </div>
        <div className="page-footer">
          <Button
            disabled={!backupVerification.canSubmit}
            isLoading={backupVerification.isSubmitting}
            onClick={handleConfirm}
            className="w-full h-[45px]"
          >
            Confirm backup
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <CopyToast show={showToast} />
      <PageHeader title={title} showBack onBack={handleBack} />
      <div className="page-content">
        {backupMode && <p className="mb-3 text-sm font-medium break-words">{targetName}</p>}
        <p className="mb-3 text-sm text-muted">
          Never share your Secret Recovery Phrase with anyone. Anyone with this phrase can take your
          assets forever.
        </p>
        <SeedPhraseDisplay
          words={seedPhrase}
          blurred={isBlurred}
          onReveal={() => setIsBlurred(false)}
        />
      </div>
      <div className="page-footer flex gap-2">
        <Button
          variant={backupMode ? 'outline' : 'default'}
          onClick={() => copyToClipboard(seedPhrase.join(' '))}
          className="h-[45px] flex-1"
        >
          Copy
        </Button>
        {backupMode && (
          <Button onClick={handleContinue} className="h-[45px] flex-1">
            Continue
          </Button>
        )}
      </div>
    </div>
  )
}
