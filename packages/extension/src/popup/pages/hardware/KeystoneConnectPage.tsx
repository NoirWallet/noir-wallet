import { useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/common/PageHeader'
import { PasswordInput } from '../../components/common/PasswordInput'
import { PasswordStrength } from '../../components/common/PasswordStrength'
import { QRScanner } from '../../components/hardware/QRScanner'
import { AccountDerivationPaths } from '../../components/hardware/AccountDerivationPaths'
import { SyncOptionsModal } from '../../components/onboarding/SyncOptionsModal'
import { openModal } from '../../provider/ModalManager'
import { parseZcashAccounts, type UR, type KeystoneAccountsPayload } from '@/lib/keystone'
import { accountManager } from '@/core/wallet/account-manager'
import { useWalletStore } from '@/store/wallet-store'
import { WALLET_CONFIG } from '@/config/wallet'
import { formatSortAddress } from '@/lib/format'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent } from '@/lib/analytics'
import keystoneLogo from '@/images/keystone-logo.webp'
import { classifyError } from '@/lib/errors'

const MIN_PW = WALLET_CONFIG.SECURITY.MIN_PASSWORD_LENGTH

type Step = 'guide' | 'scan' | 'configure' | 'success'

/**
 * Full-tab Keystone connection flow:
 * scan `ur:zcash-accounts` -> pick account/birthday -> create watch-only wallet.
 */
export function KeystoneConnectPage() {
  const [step, setStep] = useState<Step>('guide')
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannerKey, setScannerKey] = useState(0)
  const [payload, setPayload] = useState<KeystoneAccountsPayload | null>(null)
  const [selectedAccountPosition, setSelectedAccountPosition] = useState(0)

  const [walletName, setWalletName] = useState('Keystone')
  const [birthdayHeight, setBirthdayHeight] = useState<number | undefined>(undefined)
  const [isExistingWallet, setIsExistingWallet] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const isFirstWallet = useWalletStore(state => state.wallets.length === 0)
  const network = useWalletStore(state => state.currentNetwork)
  const selectedAccount = payload?.accounts[selectedAccountPosition]

  const handleScan = (ur: UR) => {
    try {
      const parsed = parseZcashAccounts(ur)
      setPayload(parsed)
      setSelectedAccountPosition(0)
      setScanError(null)
      setStep('configure')
    } catch (e) {
      setScanError(classifyError(e).userMessage)
      setScannerKey(k => k + 1)
    }
  }

  const handlePickBirthday = async () => {
    const result = await openModal<{ height?: number; confirmed: boolean } | undefined>({
      title: 'Sync Optimization',
      body: (resolve, close) => (
        <SyncOptionsModal
          initialHeight={birthdayHeight}
          onConfirm={height => {
            resolve({ height, confirmed: true })
            close()
          }}
        />
      )
    })
    if (result?.confirmed) {
      setIsExistingWallet(true)
      setBirthdayHeight(result.height)
    }
  }

  const passwordValid =
    !isFirstWallet || (password.length >= MIN_PW && password === confirmPassword)
  const canCreate =
    !!payload && !!selectedAccount && walletName.trim().length > 0 && passwordValid && !isCreating

  const handleCreate = async () => {
    if (!payload || !selectedAccount || !canCreate) return

    setIsCreating(true)
    setCreateError(null)
    try {
      await accountManager.createHardwareWallet({
        name: walletName.trim(),
        ufvk: selectedAccount.ufvk,
        seedFingerprintHex: payload.seedFingerprintHex,
        accountHdIndex: selectedAccount.index,
        birthdayHeight,
        password: isFirstWallet ? password : undefined
      })
      sendAnalyticsEvent(ANALYTICS_EVENTS.HW_CONNECTED, {
        pageId: PAGE_IDS.HARDWARE_CONNECT,
        extra: { is_existing_wallet: isExistingWallet }
      })
      sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, {
        pageId: PAGE_IDS.HARDWARE_CONNECT,
        params: { method: 'hardware' }
      })
      setStep('success')
    } catch (e) {
      setCreateError(classifyError(e).userMessage)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="page-container page-container--tab">
      <PageHeader
        title="Connect Keystone"
        showBack={step === 'scan' || step === 'configure'}
        onBack={() => setStep(step === 'configure' ? 'scan' : 'guide')}
      />

      {step === 'guide' && (
        <>
          <div className="page-content">
            <img src={keystoneLogo} alt="Keystone" className="h-7 w-auto mt-2 mb-8" />

            <h2 className="text-2xl font-bold mb-2">Connect Hardware Wallet</h2>
            <p className="text-sm text-muted mb-8">
              Scan your Keystone's QR code to add it as an air-gapped, watch-only wallet.
            </p>

            <p className="text-sm font-semibold mb-4">Instructions</p>
            <div className="space-y-3">
              <GuideStep icon="lucide:lock" text="Unlock your Keystone" />
              <GuideStep icon="lucide:menu" text="Tap the menu icon" />
              <GuideStep icon="lucide:link-2" text="Tap on Connect Software Wallet" />
              <GuideStep icon="lucide:scan-line" text="Select Zcash and scan its QR code" />
            </div>
          </div>
          <div className="page-footer">
            <Button onClick={() => setStep('scan')} className="w-full h-[45px]">
              <Icon icon="lucide:camera" width={16} height={16} className="mr-2" />
              Ready to Scan
            </Button>
          </div>
        </>
      )}

      {step === 'scan' && (
        <div className="page-content">
          <p className="text-sm text-muted text-center mb-4">
            Point the camera at the QR code on your Keystone screen.
          </p>
          <QRScanner key={scannerKey} onScan={handleScan} />
          {scanError && <p className="text-xs text-danger text-center mt-3">{scanError}</p>}
        </div>
      )}

      {step === 'configure' && payload && (
        <>
          <div className="page-content">
            <div className="flex items-center gap-3 p-4 bg-card rounded-xl mb-5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon icon="lucide:check-circle" width={20} height={20} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-sm">Keystone Detected</p>
                <p className="text-xs text-muted truncate">
                  Device fingerprint: {formatSortAddress(payload.seedFingerprintHex)}
                </p>
              </div>
            </div>

            {payload.accounts.length > 1 && (
              <div className="mb-5">
                <label className="block text-sm text-muted mb-2">Account</label>
                <div className="space-y-2">
                  {payload.accounts.map((account, i) => (
                    <button
                      key={account.index}
                      onClick={() => setSelectedAccountPosition(i)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-colors ${
                        i === selectedAccountPosition
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:border-muted'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm">
                          {account.name || `Account ${account.index}`}
                        </span>
                        <span className="block text-xs text-muted">Index {account.index}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted font-mono">
                        {formatSortAddress(account.ufvk)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedAccount && (
              <div className="mb-5 rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted">Account Index</span>
                  <span className="font-mono text-sm text-foreground">{selectedAccount.index}</span>
                </div>
                <AccountDerivationPaths network={network} accountIndex={selectedAccount.index} />
              </div>
            )}

            <div className="mb-5">
              <label className="block text-sm text-muted mb-2">Wallet Name</label>
              <Input
                value={walletName}
                onChange={e => setWalletName(e.target.value)}
                placeholder="Keystone"
                className="h-[45px]"
              />
            </div>

            <div className="mb-5">
              <label className="block text-sm text-muted mb-2">Wallet History</label>
              <div className="space-y-2">
                <OptionCard
                  selected={!isExistingWallet}
                  title="Brand new wallet"
                  description="No previous transactions — sync from the current block"
                  onClick={() => {
                    setIsExistingWallet(false)
                    setBirthdayHeight(undefined)
                  }}
                />
                <OptionCard
                  selected={isExistingWallet}
                  title="Existing wallet with funds"
                  description={
                    isExistingWallet && birthdayHeight
                      ? `Sync from block ${birthdayHeight.toLocaleString()}`
                      : 'Pick the wallet creation date to scan past transactions'
                  }
                  onClick={handlePickBirthday}
                />
              </div>
            </div>

            {isFirstWallet && (
              <div className="space-y-4 mb-5">
                <p className="text-sm text-muted">
                  Set a password to secure your wallet on this device.
                </p>
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder={`At least ${MIN_PW} characters`}
                />
                <PasswordStrength password={password} />
                <PasswordInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="Confirm password"
                  error={
                    confirmPassword && password !== confirmPassword
                      ? 'Passwords do not match'
                      : undefined
                  }
                />
              </div>
            )}

            {createError && (
              <div className="p-3 rounded-lg bg-danger/10 text-danger text-sm">{createError}</div>
            )}
          </div>

          <div className="page-footer">
            <Button
              onClick={handleCreate}
              disabled={!canCreate}
              isLoading={isCreating}
              className="w-full h-[45px]"
            >
              {isCreating ? 'Creating Wallet...' : 'Connect Wallet'}
            </Button>
          </div>
        </>
      )}

      {step === 'success' && (
        <>
          <div className="page-content flex flex-col items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <Icon icon="lucide:check" width={40} height={40} className="text-primary" />
            </div>
            <h2 className="text-base font-semibold mb-2">Keystone Connected</h2>
            <p className="text-sm text-muted text-center">
              Your hardware wallet is ready. Close this page and open Noir Wallet from the browser
              toolbar.
            </p>
          </div>
          <div className="page-footer">
            <Button onClick={() => window.close()} className="w-full h-[45px]">
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function GuideStep({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
        <Icon icon={icon} width={18} height={18} className="text-foreground" />
      </div>
      <p className="text-sm font-medium">{text}</p>
    </div>
  )
}

function OptionCard({
  selected,
  title,
  description,
  onClick
}: {
  selected: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted'
      }`}
    >
      <div
        className={`w-4 h-4 mt-0.5 rounded-full border-2 shrink-0 flex items-center justify-center ${
          selected ? 'border-primary' : 'border-muted'
        }`}
      >
        {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
    </button>
  )
}
