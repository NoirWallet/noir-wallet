import { assertNewPassword } from '@/core/wallet/password-policy'
import {
  parseKeystoneHardwareCredential,
  parseLedgerHardwareCredential,
  type LedgerHardwareCredential,
  type KeystoneHardwareCredential
} from '@/core/wallet/hardware-wallet-data'
import { SecureStorage } from '@/core/wallet/secure-storage'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { credentialLifecycle } from './credential-lifecycle'
import { credentialSession } from './credential-session'
import { backgroundZcashWalletRuntime } from './zcash-wallet-runtime'
import { syncScheduler } from './sync-scheduler'

export interface ProvisionKeystoneHardwareInput {
  readonly credential: unknown
  readonly displayName: string
  readonly password?: string
  readonly birthdayHeight?: number
}

function validateBirthdayHeight(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid birthday height')
  return value
}

async function ensureZcashRuntimePassword(password: string): Promise<void> {
  await backgroundZcashWalletRuntime.initialize()
  if (backgroundZcashWalletRuntime.getSessionPassword() !== null) return
  if (useWalletStore.getState().wallets.length === 0) {
    backgroundZcashWalletRuntime.establishProvisioningPasswordForEmptyRetainedInventory(password)
    return
  }
  const unlocked = await backgroundZcashWalletRuntime.unlock(password, { skipFailCount: true })
  if (!unlocked.success) throw new Error('Hardware Wallet provisioning session is invalid')
}

async function provisionRetainedZcashHardware(
  credential: KeystoneHardwareCredential | LedgerHardwareCredential,
  displayName: string,
  password: string,
  birthdayHeight: number | undefined,
  isFirstGlobalWallet: boolean
) {
  if (credential.accountExport.protocol !== 'zcash-accounts-v1') {
    throw new Error('Invalid Zcash hardware credential')
  }
  syncScheduler.pauseForTx()
  syncScheduler.abortSync()
  try {
    await ensureZcashRuntimePassword(password)
    const walletId = await backgroundZcashWalletRuntime.createHardwareWallet({
      name: displayName,
      ufvk: credential.accountExport.ufvk,
      seedFingerprintHex: credential.accountExport.seedFingerprintHex,
      accountHdIndex: credential.accountExport.accountHdIndex,
      keySource: credential.vendor,
      ...(credential.vendor === 'ledger'
        ? { deviceModel: credential.deviceModel, deviceName: credential.deviceName }
        : {}),
      ...(birthdayHeight === undefined ? {} : { birthdayHeight }),
      enforceNewPasswordPolicy: isFirstGlobalWallet
    })
    const synchronized = await credentialLifecycle.synchronizeRetainedV1(password)
    const descriptor = await credentialSession.unlock(password)
    if (!descriptor) throw new Error('Hardware Wallet provisioning produced an empty session')
    const unlocked = await backgroundZcashWalletRuntime.unlock(password, { skipFailCount: true })
    if (!unlocked.success) throw new Error('Hardware Wallet provisioning could not restore Wallet')
    const wallet = useWalletStore.getState().getWallet(walletId)
    if (!wallet || wallet.keySource !== credential.vendor || wallet.accounts.length === 0) {
      throw new Error('Provisioned Zcash hardware Wallet is missing')
    }
    if (!synchronized.generationId) {
      throw new Error('Provisioned Zcash hardware Wallet generation is missing')
    }
    await Promise.all([SecureStorage.resetLoginAttempts(), SecureStorage.saveLastActivityTime()])
    syncScheduler.onRequestSync()
    return Object.freeze({
      status:
        synchronized.status === 'migrated' || synchronized.status === 'synchronized'
          ? ('committed' as const)
          : ('already-committed' as const),
      generationId: synchronized.generationId,
      keyDomainId: walletId,
      accountIds: Object.freeze(wallet.accounts.map(account => account.id))
    })
  } catch (error) {
    await Promise.allSettled([backgroundZcashWalletRuntime.lock(), credentialSession.lock()])
    throw error
  } finally {
    syncScheduler.resumeAfterTx()
  }
}

export async function provisionHardwareWallet(
  input: ProvisionKeystoneHardwareInput,
  vendor: 'keystone' | 'ledger'
) {
  const credential =
    vendor === 'keystone'
      ? parseKeystoneHardwareCredential(input.credential)
      : parseLedgerHardwareCredential(input.credential)
  const birthdayHeight = validateBirthdayHeight(input.birthdayHeight)
  if (credential.accountExport.protocol !== 'zcash-accounts-v1' && birthdayHeight !== undefined) {
    throw new Error('Birthday height is only valid for Zcash hardware Wallets')
  }
  if (
    typeof input.displayName !== 'string' ||
    input.displayName.length === 0 ||
    input.displayName.length > 128 ||
    input.displayName.trim() !== input.displayName
  ) {
    throw new Error('Invalid hardware Wallet name')
  }

  await rehydrateWalletStore()
  const hasRetainedV1Wallet = useWalletStore.getState().wallets.length > 0
  const activeWalletSetMode = await credentialLifecycle.getActiveWalletSetMode()
  const isFirstWallet = !hasRetainedV1Wallet && activeWalletSetMode === 'inactive'
  const isInterruptedFirstWalletRecovery =
    !hasRetainedV1Wallet &&
    activeWalletSetMode === 'native-v2-hardware-only' &&
    !(await credentialSession.hasUnlockSession()) &&
    input.password !== undefined
  let password: string
  if (isFirstWallet || isInterruptedFirstWalletRecovery) {
    if (input.password === undefined) throw new Error('A password is required for the first Wallet')
    assertNewPassword(input.password)
    password = input.password
    if (isInterruptedFirstWalletRecovery) {
      const descriptor = await credentialSession.unlock(password)
      if (!descriptor) throw new Error('Hardware Wallet recovery produced an empty session')
    }
  } else {
    if (input.password !== undefined) {
      throw new Error('An existing Wallet must use the active global password session')
    }
    if (!(await credentialSession.hasUnlockSession())) {
      throw new Error('Wallet is locked. Please unlock and try again.')
    }
    password = await credentialSession.getProvisioningPassword()
  }

  const result =
    credential.accountExport.protocol === 'zcash-accounts-v1'
      ? await provisionRetainedZcashHardware(
          credential,
          input.displayName,
          password,
          birthdayHeight,
          isFirstWallet
        )
      : await credentialLifecycle.provisionKeystoneHardware({
          credential: parseKeystoneHardwareCredential(credential),
          displayName: input.displayName,
          password,
          network: DEFAULT_NETWORK
        })
  if (isFirstWallet) {
    const descriptor = await credentialSession.unlock(password)
    if (!descriptor) throw new Error('Hardware Wallet provisioning produced an empty session')
    await Promise.all([SecureStorage.resetLoginAttempts(), SecureStorage.saveLastActivityTime()])
  }
  return result
}

export function provisionKeystoneHardware(input: ProvisionKeystoneHardwareInput) {
  return provisionHardwareWallet(input, 'keystone')
}

export function provisionLedgerHardware(input: ProvisionKeystoneHardwareInput) {
  return provisionHardwareWallet(input, 'ledger')
}
