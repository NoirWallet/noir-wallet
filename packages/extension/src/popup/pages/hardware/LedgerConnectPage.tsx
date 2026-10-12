import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { PageHeader } from '../../components/common/PageHeader'
import { ChainIcon } from '../../components/common/ChainIcon'
import { PasswordInput } from '../../components/common/PasswordInput'
import { PasswordStrength } from '../../components/common/PasswordStrength'
import { SyncOptionsModal } from '../../components/onboarding/SyncOptionsModal'
import { openModal } from '../../provider/ModalManager'
import {
  accountNetworksClient,
  type AccountNetworksCatalogView
} from '../../services/account-networks-client'
import { ledgerHardwareProvisioningClient } from '../../services/hardware-provisioning-client'
import { exportLedgerWalletAccounts } from '../../services/ledger-account-export'
import {
  LEDGER_CHAIN_FAMILIES,
  type LedgerChainFamily,
  type LedgerHardwareCredential,
  type LedgerPublicAccount
} from '@/core/wallet/hardware-wallet-data'
import type { LedgerTransport } from '@/lib/ledger/device'
import { cn } from '@/lib/utils'
import { getNewPasswordValidationError, isNewPasswordValid } from '@/core/wallet/password-policy'
import { useWalletStore } from '@/store/wallet-store'
import {
  MAX_ZCASH_ACCOUNT_INDEX,
  parseLedgerAccountIndex,
  ledgerCatalogWallets,
  ledgerProvisioningCredential,
  ledgerLogicalAccountIndex,
  ledgerRegisteredFamilies,
  ledgerCanAddZcashAccount
} from './ledger-connect-model'

const CHAIN_NAMES: Record<LedgerChainFamily, string> = {
  zcash: 'Zcash',
  evm: 'EVM',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  near: 'NEAR'
}
export function LedgerConnectPage() {
  const network = useWalletStore(state => state.currentNetwork)
  const retainedWalletCount = useWalletStore(state => state.wallets.length)
  const [catalog, setCatalog] = useState<AccountNetworksCatalogView | null>(null)
  const [loading, setLoading] = useState(true)
  const [catalogAvailable, setCatalogAvailable] = useState(false)
  const [step, setStep] = useState<'connect' | 'waiting' | 'configure' | 'success'>('connect')
  const [targetWalletId, setTargetWalletId] = useState('')
  const [targetAccount, setTargetAccount] = useState('0')
  const [existingCredential, setExistingCredential] = useState<
    LedgerHardwareCredential | undefined
  >()
  const [families, setFamilies] = useState<readonly LedgerChainFamily[]>(['zcash'])
  const [deviceIndex, setDeviceIndex] = useState('0')
  const [exported, setExported] = useState<{
    credential: LedgerHardwareCredential
    anchorProof?: LedgerPublicAccount
  } | null>(null)
  const [walletName, setWalletName] = useState('Ledger')
  const [birthdayHeight, setBirthdayHeight] = useState<number | undefined>()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [deviceMessage, setDeviceMessage] = useState('Select your Ledger')
  const [awaitingApp, setAwaitingApp] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const appReady = useRef<(() => void) | null>(null)
  const connecting = useRef(false)
  const provisioning = useRef(false)
  const wallets = ledgerCatalogWallets(catalog)
  const target = wallets.find(wallet => wallet.id === targetWalletId)
  const accountIndex = ledgerLogicalAccountIndex(targetAccount, target?.accounts ?? [])
  const registeredFamilies = ledgerRegisteredFamilies(existingCredential, accountIndex, network)
  const canAddZcash = ledgerCanAddZcashAccount(existingCredential, accountIndex, network)
  const selectedFamilies = families.filter(family => family !== 'zcash' || canAddZcash)
  const parsedDeviceIndex = parseLedgerAccountIndex(deviceIndex)
  const firstWallet = !loading && !catalog?.accounts.length && retainedWalletCount === 0
  useEffect(() => {
    let disposed = false
    void accountNetworksClient
      .getCatalog()
      .then(result => {
        if (!disposed) {
          setCatalog(result)
          setCatalogAvailable(true)
        }
      })
      .catch(cause => {
        if (!disposed) setError(cause instanceof Error ? cause.message : 'Wallet check failed')
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
      abort.current?.abort()
      appReady.current?.()
    }
  }, [])
  useEffect(() => {
    let disposed = false
    setExistingCredential(undefined)
    if (!targetWalletId) return
    setLoading(true)
    void ledgerHardwareProvisioningClient
      .getCredential(targetWalletId)
      .then(credential => {
        if (!disposed) setExistingCredential(credential)
      })
      .catch(cause => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : 'Ledger Wallet unavailable')
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [targetWalletId])
  const cancelConnection = () => {
    abort.current?.abort()
    appReady.current?.()
    appReady.current = null
    setAwaitingApp(false)
    setStep('connect')
  }
  const detect = async (transport: LedgerTransport) => {
    if (
      parsedDeviceIndex === null ||
      accountIndex === null ||
      !catalogAvailable ||
      loading ||
      connecting.current ||
      selectedFamilies.length === 0
    )
      return
    connecting.current = true
    setBirthdayHeight(undefined)
    const controller = new AbortController()
    abort.current = controller
    setError('')
    setDeviceMessage('Select your Ledger in the browser dialog')
    setStep('waiting')
    try {
      const result = await exportLedgerWalletAccounts({
        transport,
        network,
        families: selectedFamilies,
        deviceAccountIndex: parsedDeviceIndex,
        accountIndex,
        existing: existingCredential,
        signal: controller.signal,
        onStep: (app, confirming) =>
          setDeviceMessage(
            confirming ? 'Confirm the account on your Ledger' : `Open the ${app} app`
          ),
        prepareApp: () =>
          new Promise<void>(resolve => {
            appReady.current = () => {
              appReady.current = null
              setAwaitingApp(false)
              resolve()
            }
            setAwaitingApp(true)
          })
      })
      controller.signal.throwIfAborted()
      setExported(result)
      if (!targetWalletId) setWalletName(result.credential.deviceName)
      setStep('configure')
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Ledger connection failed')
        setStep('connect')
      }
    } finally {
      connecting.current = false
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
    if (result?.confirmed) setBirthdayHeight(result.height)
  }
  const create = async () => {
    if (!exported || accountIndex === null || provisioning.current) return
    provisioning.current = true
    setCreating(true)
    setError('')
    try {
      await ledgerHardwareProvisioningClient.provision({
        credential: ledgerProvisioningCredential(
          exported.credential,
          birthdayHeight,
          accountIndex,
          network
        ),
        displayName: walletName.trim(),
        ...(targetWalletId
          ? { existingKeyDomainId: targetWalletId, anchorProof: exported.anchorProof }
          : {}),
        ...(firstWallet ? { password } : {})
      })
      setPassword('')
      setConfirmPassword('')
      setStep('success')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ledger setup failed')
    } finally {
      provisioning.current = false
      setCreating(false)
    }
  }
  return (
    <div className="page-container page-container--tab">
      <PageHeader
        title={targetWalletId ? 'Add Ledger Accounts' : 'Connect Ledger'}
        showBack={step === 'connect' || step === 'configure'}
        onBack={step === 'configure' ? () => setStep('connect') : undefined}
      />
      {step === 'connect' && (
        <>
          <div className="page-content min-h-0 space-y-4">
            {wallets.length > 0 && (
              <div className={cn('grid gap-3', target && 'grid-cols-2')}>
                <div className="min-w-0">
                  <label htmlFor="ledger-wallet" className="mb-2 block text-sm text-muted">
                    Wallet
                  </label>
                  <select
                    id="ledger-wallet"
                    className="h-[45px] w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={targetWalletId}
                    onChange={event => {
                      const wallet = wallets.find(item => item.id === event.target.value)
                      setTargetWalletId(event.target.value)
                      setTargetAccount(String(wallet?.accounts[0]?.index ?? 0))
                      setFamilies([])
                      setError('')
                      if (wallet) setWalletName(wallet.name)
                    }}
                  >
                    <option value="">New Ledger Wallet</option>
                    {wallets.map(wallet => (
                      <option key={wallet.id} value={wallet.id}>
                        {wallet.name}
                      </option>
                    ))}
                  </select>
                </div>
                {target && (
                  <div className="min-w-0">
                    <label
                      htmlFor="ledger-logical-account"
                      className="mb-2 block text-sm text-muted"
                    >
                      Account
                    </label>
                    <select
                      id="ledger-logical-account"
                      className="h-[45px] w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                      value={targetAccount}
                      onChange={event => setTargetAccount(event.target.value)}
                    >
                      {target.accounts.map(account => (
                        <option key={account.index} value={account.index}>
                          {account.name}
                        </option>
                      ))}
                      <option value="new">Add account</option>
                    </select>
                  </div>
                )}
              </div>
            )}
            <fieldset>
              <legend className="mb-3 text-sm font-medium">Chains</legend>
              <div
                className={cn(
                  'grid grid-cols-3 gap-2 overflow-y-auto',
                  wallets.length > 0 ? 'max-h-40' : 'max-h-56'
                )}
              >
                {LEDGER_CHAIN_FAMILIES.map(family => {
                  const registered = registeredFamilies.includes(family)
                  const selected = !!registered || selectedFamilies.includes(family)
                  return (
                    <button
                      key={family}
                      type="button"
                      disabled={!!registered || (family === 'zcash' && !canAddZcash)}
                      aria-pressed={selected}
                      className={cn(
                        'flex h-16 w-full flex-col items-center justify-center gap-1 rounded-xl border px-2 text-center text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 disabled:cursor-default disabled:opacity-50',
                        selected
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border bg-card text-muted hover:text-foreground'
                      )}
                      onClick={() =>
                        setFamilies(current =>
                          current.includes(family)
                            ? current.filter(item => item !== family)
                            : [...current, family]
                        )
                      }
                    >
                      <ChainIcon
                        chain={family}
                        showTooltip={false}
                        aria-hidden="true"
                        className="size-6 shrink-0 rounded-full"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium leading-4">{CHAIN_NAMES[family]}</span>
                        {registered && (
                          <span className="block text-[10px] leading-3 text-muted">Added</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div>
              <label htmlFor="ledger-account-index" className="mb-2 block text-sm text-muted">
                Device account index
              </label>
              <Input
                id="ledger-account-index"
                type="number"
                className="h-[45px]"
                min={0}
                max={MAX_ZCASH_ACCOUNT_INDEX}
                step={1}
                inputMode="numeric"
                value={deviceIndex}
                onChange={event => setDeviceIndex(event.target.value)}
                aria-invalid={parsedDeviceIndex === null}
              />
              {parsedDeviceIndex === null && (
                <p className="mt-2 text-xs text-danger">Enter a valid account index.</p>
              )}
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <div className="page-footer space-y-2">
            <Button
              className="w-full h-[45px]"
              disabled={
                !catalogAvailable ||
                loading ||
                accountIndex === null ||
                parsedDeviceIndex === null ||
                !selectedFamilies.length ||
                (!!targetWalletId && !existingCredential)
              }
              onClick={() => void detect('usb')}
            >
              Connect Ledger
            </Button>
            <button
              type="button"
              className="w-full py-2 text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
              disabled={
                !catalogAvailable ||
                loading ||
                accountIndex === null ||
                parsedDeviceIndex === null ||
                !selectedFamilies.length ||
                (!!targetWalletId && !existingCredential)
              }
              onClick={() => void detect('bluetooth')}
            >
              Use Bluetooth instead
            </button>
          </div>
        </>
      )}
      {step === 'waiting' && (
        <>
          <div className="page-content flex flex-col items-center justify-center gap-4 text-center">
            <Icon
              icon={awaitingApp ? 'lucide:usb' : 'lucide:loader-2'}
              width={32}
              className={awaitingApp ? '' : 'animate-spin text-primary'}
            />
            <p>{deviceMessage}</p>
          </div>
          <div className="page-footer space-y-2">
            {awaitingApp && (
              <Button className="w-full" onClick={() => appReady.current?.()}>
                Continue
              </Button>
            )}
            <Button className="w-full" variant="outline" onClick={cancelConnection}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {step === 'configure' && exported && (
        <>
          <div className="page-content space-y-4 pt-4">
            <div className="flex items-center gap-3">
              <Icon icon="lucide:check-circle-2" width={22} className="text-primary" />
              <span>{exported.credential.deviceName}</span>
            </div>
            {!targetWalletId && (
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
            )}
            {selectedFamilies.includes('zcash') && (
              <Button variant="outline" onClick={() => void chooseBirthday()}>
                {birthdayHeight === undefined
                  ? 'Restore from sync date'
                  : `Sync from block ${birthdayHeight.toLocaleString()}`}
              </Button>
            )}
            {firstWallet && (
              <div className="space-y-3">
                <PasswordInput
                  placeholder="Password"
                  value={password}
                  onChange={setPassword}
                  error={
                    password ? (getNewPasswordValidationError(password) ?? undefined) : undefined
                  }
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
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
          <div className="page-footer">
            <Button
              className="w-full"
              isLoading={creating}
              disabled={
                creating ||
                !walletName.trim() ||
                (firstWallet && (!isNewPasswordValid(password) || password !== confirmPassword))
              }
              onClick={() => void create()}
            >
              {targetWalletId ? 'Add Accounts' : 'Add Wallet'}
            </Button>
          </div>
        </>
      )}
      {step === 'success' && (
        <>
          <div className="page-content flex flex-col items-center justify-center gap-4">
            <Icon icon="lucide:check-circle-2" width={40} className="text-primary" />
            <p>Ledger accounts added</p>
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
