import type { ChainFeatureFlagValue } from '@/config/multichain-feature-flags'
import { isNewWalletFamilyEnabled } from '@/core/chains/feature-runtime-policy'
import {
  createBuildAddressGatedChainRegistry,
  createInitialProductChainRegistry
} from '@/core/chains/registry'
import { isAccountNetworkEnabled } from '@/core/wallet/account-network-selection'
import { isZcashHardwareKeySource } from '@/core/wallet/hardware-wallet-data'
import type { AccountData, KeySource, Network } from '@/types'
import { availableSoftwareAccountFamilies } from './account-network-selection-client'

export interface ShieldZcashVaultEntry {
  readonly showVaultCard: boolean
  readonly hasActiveZcash: boolean
  readonly canEnableZcash: boolean
}

export function resolveShieldZcashVaultEntry(input: {
  readonly network: Network
  readonly keySource: KeySource | undefined
  readonly account: AccountData | null | undefined
  readonly hasPortfolioZcash: boolean
  readonly enabledFlags: readonly ChainFeatureFlagValue[]
}): ShieldZcashVaultEntry {
  const { network, keySource, account, hasPortfolioZcash, enabledFlags } = input
  const zcashReleased = isNewWalletFamilyEnabled('zcash', enabledFlags)
  const registry = createBuildAddressGatedChainRegistry(createInitialProductChainRegistry(network))
  const zcashInProduct = registry.list().some(chain => chain.family === 'zcash')
  const showVaultCard = zcashReleased && zcashInProduct && keySource !== 'private-key'

  const hasActiveZcash = hasPortfolioZcash
  if (!showVaultCard) {
    return Object.freeze({ showVaultCard: false, hasActiveZcash, canEnableZcash: false })
  }
  if (hasActiveZcash) {
    return Object.freeze({ showVaultCard: true, hasActiveZcash: true, canEnableZcash: false })
  }

  const softwareWallet = keySource === undefined || keySource === 'software'
  const zcashSelectable = availableSoftwareAccountFamilies().includes('zcash')
  const zcashSelected =
    account !== undefined && account !== null && isAccountNetworkEnabled(account, network, 'zcash')
  const canEnableZcash =
    softwareWallet &&
    zcashSelectable &&
    account != null &&
    !zcashSelected &&
    !isZcashHardwareKeySource(keySource)

  return Object.freeze({
    showVaultCard: true,
    hasActiveZcash: false,
    canEnableZcash
  })
}

export function shieldZcashEnablePath(
  walletId: string,
  accountId: string
): `/account-networks?walletId=${string}&accountId=${string}` {
  return `/account-networks?walletId=${encodeURIComponent(walletId)}&accountId=${encodeURIComponent(accountId)}`
}
