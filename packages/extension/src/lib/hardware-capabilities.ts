import type { KeySource } from '@/types'

export interface HardwareWalletCapabilities {
  externalSigning: boolean
  transactionSigning: boolean
  transparentInputs: boolean
  shieldedInputs: boolean
  messageSigning: boolean
  lendingIdentity: boolean
  derivedAccountImport: boolean
}

export type HardwareUnsupportedDAppMethod =
  | 'zcash_signMessage'
  | 'zcash_getPublicKey'
  | 'zcash_checkLendingMcaAccount'

const SOFTWARE_CAPABILITIES: HardwareWalletCapabilities = {
  externalSigning: false,
  transactionSigning: true,
  transparentInputs: true,
  shieldedInputs: true,
  messageSigning: true,
  lendingIdentity: true,
  derivedAccountImport: true
}

const HARDWARE_TRANSACTION_CAPABILITIES: HardwareWalletCapabilities = {
  externalSigning: true,
  transactionSigning: true,
  transparentInputs: true,
  shieldedInputs: true,
  messageSigning: false,
  lendingIdentity: false,
  derivedAccountImport: false
}

export function isHardwareKeySource(keySource?: KeySource): boolean {
  return keySource === 'keystone' || keySource === 'ledger'
}

export function getHardwareWalletCapabilities(keySource?: KeySource): HardwareWalletCapabilities {
  if (keySource === 'keystone') {
    return { ...HARDWARE_TRANSACTION_CAPABILITIES, transparentInputs: false }
  }
  if (keySource === 'ledger') {
    return HARDWARE_TRANSACTION_CAPABILITIES
  }
  return SOFTWARE_CAPABILITIES
}

export function getHardwareDAppMethodUnavailableReason(
  keySource: KeySource | undefined,
  method: string
): string | undefined {
  if (!isHardwareKeySource(keySource)) return undefined

  const walletName = keySource === 'ledger' ? 'Ledger' : 'Keystone'
  const reasons: Record<HardwareUnsupportedDAppMethod, string> = {
    zcash_signMessage: `${walletName} wallet is connected, but message signing is not supported by the current Noir Wallet integration.`,
    zcash_getPublicKey: `${walletName} wallet is connected, but public-key identity access is not supported by the current Noir Wallet integration.`,
    zcash_checkLendingMcaAccount: `${walletName} wallet is connected, but lending identity is not supported by the current Noir Wallet integration.`
  }

  return method in reasons ? reasons[method as HardwareUnsupportedDAppMethod] : undefined
}
