import type { ChainFeatureFlagValue } from '@/config/multichain-feature-flags'
import { supportsEvmPrivateExecution } from '@/core/chains/evm'
import type { ChainDefinition, TransactionAction } from '@/core/chains/registry'
import { getZcashChainId } from '@/core/chains/registry'
import { isAccountChainEnabled } from '@/core/wallet/account-network-selection'
import { getFundingSourceUnavailableReason } from '@/core/wallet/funding-source'
import { isZcashHardwareKeySource } from '@/core/wallet/hardware-wallet-data'
import type { AccountData, KeySource, Network } from '@/types/wallet'
import type { AccountNetworksView } from './account-networks-client'
import { getShieldTransferChainIds } from './shield-transfer'

export function getHomeAccountCapabilities(input: {
  readonly account: AccountNetworksView | null
  readonly retainedAccount: AccountData | null | undefined
  readonly retainedKeySource: KeySource | undefined
  readonly enabledFlags: readonly ChainFeatureFlagValue[]
  readonly network: Network
}) {
  const { account, retainedAccount, retainedKeySource, enabledFlags, network } = input
  const source = account?.walletSource
  const networks = (account?.networks ?? []).filter(
    ({ chain }) =>
      chain.network.kind === network &&
      enabledFlags.includes(chain.featureFlag) &&
      (source?.kind !== 'hardware' ||
        source.hardware.capabilities.some(capability => capability === chain.family))
  )
  const zcash = networks.find(({ chain }) => chain.family === 'zcash')?.chain
  const retainedZcash = Boolean(
    !account &&
    retainedAccount &&
    (retainedAccount.addresses.transparent || retainedAccount.addresses.shielded) &&
    enabledFlags.includes('chain.zcash') &&
    isAccountChainEnabled(retainedAccount, network, 'zcash', getZcashChainId(network))
  )
  const keySource = source
    ? source.kind === 'hardware'
      ? isZcashHardwareKeySource(source.hardware.vendor)
        ? source.hardware.vendor
        : undefined
      : source.kind
    : retainedKeySource
  const canSign = (chain: ChainDefinition, action: TransactionAction = 'native-transfer') =>
    chain.capabilities.signing.status === 'available' &&
    chain.capabilities.transaction.status === 'available' &&
    chain.capabilities.transaction.actions.includes(action)
  const canSignZcash = zcash ? canSign(zcash) : retainedZcash
  const canSendShieldedZcash =
    canSignZcash && !getFundingSourceUnavailableReason(keySource, 'shielded')
  const canSendTransparentZcash =
    canSignZcash && !getFundingSourceUnavailableReason(keySource, 'transparent')
  const otherPublicChains = networks.filter(
    ({ chain }) => chain.family !== 'zcash' && canSign(chain)
  )
  const canReceiveZcash = zcash ? zcash.capabilities.address.status === 'available' : retainedZcash
  const privateEvm =
    otherPublicChains.some(({ chain }) => chain.family === 'evm') &&
    supportsEvmPrivateExecution(source)
  const confidentialHome =
    privateEvm &&
    account !== null &&
    getShieldTransferChainIds({ ...account, networks }, network === 'mainnet').length > 0
  const canShieldZcash = canSendTransparentZcash && (!zcash || canSign(zcash, 'shield'))

  return {
    hasZcash: Boolean(zcash) || retainedZcash,
    canSend: canSendShieldedZcash || canSendTransparentZcash || otherPublicChains.length > 0,
    canReceive:
      canReceiveZcash ||
      networks.some(({ chain }) => chain.capabilities.address.status === 'available'),
    canSendShieldedZcash,
    canReceiveZcash,
    sendFromShieldedZcash:
      canSendShieldedZcash && !canSendTransparentZcash && otherPublicChains.length === 0,
    privateEvm,
    confidentialHome,
    canShieldFromHome: canShieldZcash || confidentialHome,
    canSwapFromPublic:
      network === 'mainnet' &&
      (canSendTransparentZcash ||
        privateEvm ||
        otherPublicChains.some(({ chain }) => chain.family === 'bitcoin'))
  }
}
