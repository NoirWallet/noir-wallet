import { useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/common/PageHeader'
import { PasswordInput } from '../../components/common/PasswordInput'
import { PasswordStrength } from '../../components/common/PasswordStrength'
import { AccountDerivationPaths } from '../../components/hardware/AccountDerivationPaths'
import { SyncOptionsModal } from '../../components/onboarding/SyncOptionsModal'
import { openModal } from '../../provider/ModalManager'
import { accountManager } from '@/core/wallet/account-manager'
import { useWalletStore } from '@/store/wallet-store'
import { WALLET_CONFIG } from '@/config/wallet'
import {
  exportLedgerAccount,
  getLedgerDeviceName,
  type LedgerAccountExport,
  type LedgerTransport
} from '@/lib/ledger/device'
import { classifyError } from '@/lib/errors'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { MAX_ZCASH_ACCOUNT_INDEX } from '@/lib/zcash-derivation'
import ledgerLogo from '@/images/ledger-logo.svg'

const MIN_PW = WALLET_CONFIG.SECURITY.MIN_PASSWORD_LENGTH

type Step = 'guide' | 'device' | 'configure' | 'success'
type HistoryChoice = 'new' | 'existing' | null

function interactionMessage(interaction: string): string {
  if (interaction.toLowerCase().includes('address')) return 'Verify the address on your Ledger'
  if (interaction.toLowerCase().includes('app')) return 'Open the Zcash app on your Ledger'
  return 'Follow the instructions on your Ledger'
}

export function LedgerConnectPage() {
  const network = useWalletStore(state => state.currentNetwork)
  const isFirstWallet = useWalletStore(state => state.wallets.length === 0)
  const [step, setStep] = useState<Step>('guide')
  const [transport, setTransport] = useState<LedgerTransport>('usb')
  const [accountIndexInput, setAccountIndexInput] = useState('0')
  const [walletName, setWalletName] = useState('Ledger')
  const [birthdayHeight, setBirthdayHeight] = useState<number | undefined>()
  const [historyChoice, setHistoryChoice] = useState<HistoryChoice>(null)
  const [showAdvanced, setShowAdvanced] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deviceMessage, setDeviceMessage] = useState('Connect and unlock your Ledger')
  const [exported, setExported] = useState<LedgerAccountExport | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accountIndex = Number(accountIndexInput)
  const accountIndexValid =
    /^\d+$/.test(accountIndexInput) &&
    Number.isInteger(accountIndex) &&
    accountIndex >= 0 &&
    accountIndex <= MAX_ZCASH_ACCOUNT_INDEX
  const passwordValid =
    !isFirstWallet || (password.length >= MIN_PW && password === confirmPassword)
  const canCreate =
    !!exported &&
    historyChoice !== null &&
    walletName.trim().length > 0 &&
    accountIndexValid &&
    passwordValid &&
    !isCreating

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
      setHistoryChoice('existing')
      setBirthdayHeight(result.height)
    }
  }

  const handleDetect = async (selectedTransport: LedgerTransport) => {
    if (!accountIndexValid) return
    setTransport(selectedTransport)
    setStep('device')
    setError(null)
    setDeviceMessage(
      selectedTransport === 'usb'
        ? 'Select your Ledger in the browser dialog'
        : 'Select your Ledger over Bluetooth'
    )
    try {
      const account = await exportLedgerAccount({
        transport: selectedTransport,
        network,
        accountIndex,
        onInteraction: interaction => setDeviceMessage(interactionMessage(interaction))
      })
      setExported(account)
      setWalletName(getLedgerDeviceName(account.deviceModel, account.deviceName))
      setStep('configure')
    } catch (cause) {
      setError(classifyError(cause).userMessage)
      setStep('guide')
    }
  }

  const handleCreate = async () => {
    if (!exported || !canCreate) return
    setIsCreating(true)
    setError(null)
    try {
      await accountManager.createHardwareWallet({
        name: walletName.trim(),
        ufvk: exported.ufvk,
        accountHdIndex: accountIndex,
        birthdayHeight,
        password: isFirstWallet ? password : undefined,
        keySource: 'ledger',
        deviceModel: exported.deviceModel,
        deviceName: exported.deviceName
      })
      sendAnalyticsEvent(ANALYTICS_EVENTS.HW_CONNECTED, {
        pageId: PAGE_IDS.HARDWARE_CONNECT,
        extra: {
          transport,
          device_model: exported.deviceModel,
          is_existing_wallet: historyChoice === 'existing'
        }
      })
      sendAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, {
        pageId: PAGE_IDS.HARDWARE_CONNECT,
        params: { method: 'hardware' }
      })
      setStep('success')
    } catch (cause) {
      setError(classifyError(cause).userMessage)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="page-container page-container--tab">
      <PageHeader
        title="Connect Ledger"
        showBack={step === 'guide' || step === 'configure'}
        onBack={step === 'configure' ? () => setStep('guide') : undefined}
      />

      {step === 'guide' && (
        <>
          <div className="page-content">
            <img src={ledgerLogo} alt="Ledger" className="h-8 w-auto mt-2 mb-6" />

            <h2 className="text-xl font-semibold mb-2">Ready your Ledger</h2>
            <p className="text-sm text-muted leading-relaxed mb-6">
              Connect your device, then approve the account export on its screen.
            </p>

            <div className="space-y-3">
              <PreparationItem icon="lucide:lock" text="Unlock your Ledger" />
              <PreparationItem icon="lucide:wallet-cards" text="Open the Zcash app" />
              <PreparationItem icon="lucide:monitor-off" text="Close Ledger Wallet" />
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(value => !value)}
              className="mt-6 flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
              aria-expanded={showAdvanced}
            >
              Advanced options
              <Icon
                icon="lucide:chevron-down"
                width={15}
                height={15}
                className={cn('transition-transform', showAdvanced && 'rotate-180')}
              />
            </button>

            {showAdvanced && (
              <div className="mt-3">
                <label className="block text-sm text-muted mb-2">Account Index</label>
                <Input
                  type="number"
                  min={0}
                  max={MAX_ZCASH_ACCOUNT_INDEX}
                  step={1}
                  inputMode="numeric"
                  value={accountIndexInput}
                  onChange={event => setAccountIndexInput(event.target.value)}
                  aria-invalid={!accountIndexValid}
                  className="h-[45px]"
                />
                {!accountIndexValid && (
                  <p className="mt-2 text-xs text-danger">
                    Enter a whole number from 0 to {MAX_ZCASH_ACCOUNT_INDEX}.
                  </p>
                )}
                {accountIndexValid && (
                  <AccountDerivationPaths
                    network={network}
                    accountIndex={accountIndex}
                    className="mt-3"
                  />
                )}
              </div>
            )}

            {error && (
              <div className="mt-5 rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</div>
            )}
          </div>
          <div className="page-footer space-y-2">
            <Button
              onClick={() => handleDetect('usb')}
              disabled={!accountIndexValid}
              className="w-full h-[45px]"
            >
              Connect Ledger
            </Button>
            <button
              type="button"
              onClick={() => handleDetect('bluetooth')}
              disabled={!accountIndexValid}
              className="w-full py-2 text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
            >
              Use Bluetooth instead
            </button>
          </div>
        </>
      )}

      {step === 'device' && (
        <div className="page-content flex flex-col items-center justify-center text-center">
          <img src={ledgerLogo} alt="Ledger" className="h-9 w-auto mb-8" />
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-5">
            <Icon
              icon="lucide:loader-2"
              width={30}
              height={30}
              className="animate-spin text-primary"
            />
          </div>
          <p className="font-medium mb-1">Waiting for Ledger</p>
          <p className="text-sm text-muted">{deviceMessage}</p>
        </div>
      )}

      {step === 'configure' && exported && (
        <>
          <div className="page-content">
            <div className="flex items-center gap-3 rounded-xl bg-card p-4 mb-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon icon="lucide:check" width={20} height={20} className="text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {getLedgerDeviceName(exported.deviceModel, exported.deviceName)}
                </p>
                <p className="text-xs text-muted">Zcash account {accountIndex + 1} connected</p>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-sm font-medium mb-3">Has this account received ZEC before?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={historyChoice === 'new'}
                  onClick={() => {
                    setHistoryChoice('new')
                    setBirthdayHeight(undefined)
                  }}
                  className={cn(
                    'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
                    historyChoice === 'new'
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-card text-muted hover:text-foreground'
                  )}
                >
                  No, it is new
                </button>
                <button
                  type="button"
                  aria-pressed={historyChoice === 'existing'}
                  onClick={handlePickBirthday}
                  className={cn(
                    'rounded-xl border px-3 py-3 text-sm font-medium transition-colors',
                    historyChoice === 'existing'
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border bg-card text-muted hover:text-foreground'
                  )}
                >
                  Yes, restore it
                </button>
              </div>
              {historyChoice === 'existing' && (
                <button
                  type="button"
                  onClick={handlePickBirthday}
                  className="mt-3 text-xs font-medium text-primary hover:text-primary/80"
                >
                  {birthdayHeight
                    ? `Sync from block ${birthdayHeight.toLocaleString()} · Change`
                    : 'Change sync date'}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(value => !value)}
              className="mb-4 flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
              aria-expanded={showAdvanced}
            >
              Advanced options
              <Icon
                icon="lucide:chevron-down"
                width={15}
                height={15}
                className={cn('transition-transform', showAdvanced && 'rotate-180')}
              />
            </button>

            {showAdvanced && (
              <div className="mb-5">
                <label className="block text-sm text-muted mb-2">Wallet Name</label>
                <Input
                  value={walletName}
                  onChange={event => setWalletName(event.target.value)}
                  placeholder="Ledger"
                  className="h-[45px]"
                />
              </div>
            )}

            {isFirstWallet && (
              <div className="space-y-4 mb-5">
                <p className="text-sm text-muted">
                  Set a password to secure your wallet on this device.
                </p>
                <PasswordInput
                  placeholder={`At least ${MIN_PW} characters`}
                  value={password}
                  onChange={setPassword}
                />
                <PasswordStrength password={password} />
                <PasswordInput
                  placeholder="Confirm password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  error={
                    confirmPassword && password !== confirmPassword
                      ? 'Passwords do not match'
                      : undefined
                  }
                />
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{error}</div>
            )}
          </div>
          <div className="page-footer">
            <Button
              onClick={handleCreate}
              disabled={!canCreate}
              isLoading={isCreating}
              className="w-full h-[45px]"
            >
              {isCreating ? 'Adding Wallet...' : 'Add Wallet'}
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
            <h2 className="text-base font-semibold mb-2">Ledger Connected</h2>
            <p className="text-sm text-muted text-center">
              Zcash app {exported?.appVersion ?? ''} is ready. The account is now syncing.
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

function PreparationItem({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-foreground">
        <Icon icon={icon} width={17} height={17} />
      </div>
      <p className="text-sm font-medium">{text}</p>
    </div>
  )
}
