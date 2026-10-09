import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/common/PageHeader'
import { PasswordInput } from '../../components/common/PasswordInput'
import { PasswordStrength } from '../../components/common/PasswordStrength'
import { SyncOptionsModal } from '../../components/onboarding/SyncOptionsModal'
import { openModal } from '../../provider/ModalManager'
import { accountNetworksClient } from '../../services/account-networks-client'
import { ledgerHardwareProvisioningClient } from '../../services/keystone-hardware-provisioning-client'
import { createLedgerHardwareCredential } from '@/core/wallet/hardware-wallet-data'
import {
  exportLedgerAccount,
  getLedgerDeviceName,
  type LedgerAccountExport,
  type LedgerTransport
} from '@/lib/ledger/device'
import { getNewPasswordValidationError, isNewPasswordValid } from '@/core/wallet/password-policy'
import { useWalletStore } from '@/store/wallet-store'
import { classifyError } from '@/lib/errors'
import { MAX_ZCASH_ACCOUNT_INDEX, parseLedgerAccountIndex } from './ledger-connect-model'

type Step = 'connect' | 'waiting' | 'configure' | 'success'

export function LedgerConnectPage() {
  const network = useWalletStore(state => state.currentNetwork)
  const retainedWalletCount = useWalletStore(state => state.wallets.length)
  const [hasStorageV2Wallet, setHasStorageV2Wallet] = useState(false)
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [inventoryError, setInventoryError] = useState(false)
  const inventoryRequest = useRef(0)
  const [step, setStep] = useState<Step>('connect')
  const [accountIndexInput, setAccountIndexInput] = useState('0')
  const [exported, setExported] = useState<LedgerAccountExport | null>(null)
  const [walletName, setWalletName] = useState('Ledger')
  const [birthdayHeight, setBirthdayHeight] = useState<number | undefined>()
  const [isExisting, setIsExisting] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deviceMessage, setDeviceMessage] = useState('Select your device')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const accountIndex = parseLedgerAccountIndex(accountIndexInput)
  const isFirstWallet =
    !inventoryLoading && !inventoryError && retainedWalletCount === 0 && !hasStorageV2Wallet
  const passwordError = password ? getNewPasswordValidationError(password) : null
  const canCreate =
    exported !== null &&
    accountIndex !== null &&
    !inventoryLoading &&
    !inventoryError &&
    walletName.trim().length > 0 &&
    !creating &&
    (!isFirstWallet || (isNewPasswordValid(password) && password === confirmPassword))

  const loadInventory = useCallback(async () => {
    const request = ++inventoryRequest.current
    setInventoryLoading(true)
    setInventoryError(false)
    try {
      const catalog = await accountNetworksClient.getCatalog()
      if (request === inventoryRequest.current) {
        setHasStorageV2Wallet((catalog?.accounts.length ?? 0) > 0)
      }
    } catch {
      if (request === inventoryRequest.current) setInventoryError(true)
    } finally {
      if (request === inventoryRequest.current) setInventoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInventory()
    return () => {
      inventoryRequest.current += 1
    }
  }, [loadInventory])

  const detect = async (selectedTransport: LedgerTransport) => {
    if (accountIndex === null) return
    setError(null)
    setDeviceMessage('Select your Ledger in the browser dialog')
    setStep('waiting')
    try {
      const account = await exportLedgerAccount({
        transport: selectedTransport,
        network,
        accountIndex,
        onInteraction: () => setDeviceMessage('Follow the instructions on your Ledger')
      })
      setExported(account)
      setWalletName(getLedgerDeviceName(account.deviceModel, account.deviceName))
      setStep('configure')
    } catch (cause) {
      setError(classifyError(cause).userMessage)
      setStep('connect')
    }
  }

  const chooseBirthday = async () => {
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
      setIsExisting(true)
      setBirthdayHeight(result.height)
    }
  }

  const create = async () => {
    if (!exported || accountIndex === null || !canCreate) return
    setCreating(true)
    setError(null)
    try {
      await ledgerHardwareProvisioningClient.provision({
        credential: createLedgerHardwareCredential({
          ufvk: exported.ufvk,
          accountHdIndex: accountIndex,
          deviceModel: exported.deviceModel,
          deviceName: getLedgerDeviceName(exported.deviceModel, exported.deviceName)
        }),
        displayName: walletName.trim(),
        ...(birthdayHeight === undefined ? {} : { birthdayHeight }),
        ...(isFirstWallet ? { password } : {})
      })
      setStep('success')
    } catch (cause) {
      setError(classifyError(cause).userMessage)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page-container page-container--tab">
      <PageHeader
        title="Connect Ledger"
        showBack={step !== 'waiting' && step !== 'success'}
        onBack={step === 'configure' ? () => setStep('connect') : undefined}
      />
      {step === 'connect' && (
        <>
          <div className="page-content space-y-5 pt-5">
            <div className="flex items-center gap-3">
              <Icon icon="lucide:usb" width={28} height={28} />
              <h2 className="text-base font-semibold">Zcash account</h2>
            </div>
            <div>
              <label htmlFor="ledger-account-index" className="mb-2 block text-sm">
                Account index
              </label>
              <Input
                id="ledger-account-index"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_ZCASH_ACCOUNT_INDEX}
                value={accountIndexInput}
                onChange={event => setAccountIndexInput(event.target.value)}
                aria-invalid={accountIndex === null}
              />
              {accountIndex === null && (
                <p className="mt-2 text-xs text-danger">Enter a valid account index.</p>
              )}
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <div className="page-footer space-y-2">
            <Button
              className="w-full"
              disabled={accountIndex === null}
              onClick={() => void detect('usb')}
            >
              Connect via USB
            </Button>
            <Button
              className="w-full"
              variant="outline"
              disabled={accountIndex === null}
              onClick={() => void detect('bluetooth')}
            >
              Connect via Bluetooth
            </Button>
          </div>
        </>
      )}
      {step === 'waiting' && (
        <div className="page-content flex flex-col items-center justify-center gap-4 text-center">
          <Icon
            icon="lucide:loader-2"
            width={32}
            height={32}
            className="animate-spin text-primary"
          />
          <p className="text-sm">{deviceMessage}</p>
        </div>
      )}
      {step === 'configure' && exported && (
        <>
          <div className="page-content space-y-5 pt-5">
            <div className="flex items-center gap-3">
              <Icon icon="lucide:check-circle-2" width={22} height={22} className="text-primary" />
              <span className="font-medium">
                {getLedgerDeviceName(exported.deviceModel, exported.deviceName)}
              </span>
            </div>
            <div>
              <label htmlFor="ledger-wallet-name" className="mb-2 block text-sm">
                Wallet name
              </label>
              <Input
                id="ledger-wallet-name"
                value={walletName}
                onChange={event => setWalletName(event.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={!isExisting ? 'default' : 'outline'}
                onClick={() => {
                  setIsExisting(false)
                  setBirthdayHeight(undefined)
                }}
              >
                New account
              </Button>
              <Button
                variant={isExisting ? 'default' : 'outline'}
                onClick={() => void chooseBirthday()}
              >
                Restore account
              </Button>
            </div>
            {isExisting && (
              <button
                type="button"
                className="text-sm text-primary"
                onClick={() => void chooseBirthday()}
              >
                {birthdayHeight
                  ? `Sync from block ${birthdayHeight.toLocaleString()}`
                  : 'Change sync date'}
              </button>
            )}
            {isFirstWallet && (
              <div className="space-y-3">
                <PasswordInput
                  placeholder="Password"
                  value={password}
                  onChange={setPassword}
                  error={passwordError ?? undefined}
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
            {inventoryError && (
              <Button variant="outline" onClick={() => void loadInventory()}>
                Retry wallet check
              </Button>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <div className="page-footer">
            <Button
              className="w-full"
              disabled={!canCreate}
              isLoading={creating}
              onClick={() => void create()}
            >
              Add Wallet
            </Button>
          </div>
        </>
      )}
      {step === 'success' && (
        <>
          <div className="page-content flex flex-col items-center justify-center gap-3 text-center">
            <Icon icon="lucide:check-circle-2" width={42} height={42} className="text-primary" />
            <h2 className="font-semibold">Ledger connected</h2>
            <p className="text-sm text-muted">Your account is syncing.</p>
          </div>
          <div className="page-footer">
            <Button className="w-full" onClick={() => window.close()}>
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
