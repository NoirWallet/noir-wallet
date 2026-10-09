import { getEvmNetworkConfigs } from '@/config/networks'
import { RHEA_SWAP_CHAIN_CATALOG, type RheaSwapToken } from '@/core/services/rhea-swap'
import { parseSolanaPublicKey } from '@/core/chains/solana'

type SendAssetIdentity = Readonly<{
  chainId: string
  namespace: string
  reference: string
}>

export type CrossChainSendAssetGroup = 'ETH' | 'USDC'
export type CrossChainSendCapabilities = Readonly<{ evm: boolean; solana: boolean }>

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const MAINNET_EVM_NETWORKS = getEvmNetworkConfigs('mainnet')

export function getCrossChainSendAssetGroup(
  asset: SendAssetIdentity
): CrossChainSendAssetGroup | null {
  const evm = MAINNET_EVM_NETWORKS.find(network => network.chainId === asset.chainId)
  if (
    evm?.nativeCurrency.symbol === 'ETH' &&
    asset.namespace === 'slip44' &&
    asset.reference === evm.nativeCurrency.slip44Reference
  ) {
    return 'ETH'
  }
  if (
    evm?.usdcContract &&
    asset.namespace === 'erc20' &&
    asset.reference.toLowerCase() === evm.usdcContract.toLowerCase()
  ) {
    return 'USDC'
  }
  if (
    asset.chainId.startsWith('solana:') &&
    asset.namespace === 'token' &&
    asset.reference === SOLANA_USDC_MINT
  ) {
    return 'USDC'
  }
  return null
}

export function getCrossChainSendTokenGroup(token: RheaSwapToken): CrossChainSendAssetGroup | null {
  const evm = MAINNET_EVM_NETWORKS.find(
    network => network.chainId === `eip155:${token.rheaChainId}`
  )
  if (evm?.nativeCurrency.symbol === 'ETH' && token.isNative) return 'ETH'
  if (
    evm?.usdcContract &&
    !token.isNative &&
    token.rheaAddress.toLowerCase() === evm.usdcContract.toLowerCase()
  ) {
    return 'USDC'
  }
  if (token.rheaChainId === 'solana' && !token.isNative && token.rheaAddress === SOLANA_USDC_MINT) {
    return 'USDC'
  }
  return null
}

export function isCrossChainSendDestination(
  source: RheaSwapToken | null,
  destination: RheaSwapToken,
  capabilities: CrossChainSendCapabilities
): boolean {
  if (
    !source ||
    source.rheaChainId === destination.rheaChainId ||
    !isCrossChainSendChainEnabled(source, capabilities)
  )
    return false
  const group = getCrossChainSendTokenGroup(source)
  if (!group || getCrossChainSendTokenGroup(destination) !== group) return false
  return isCrossChainSendChainEnabled(destination, capabilities)
}

export function filterCrossChainSendDestinations(
  source: RheaSwapToken | null,
  destinations: readonly RheaSwapToken[],
  capabilities: CrossChainSendCapabilities
): readonly RheaSwapToken[] {
  return destinations.filter(destination =>
    isCrossChainSendDestination(source, destination, capabilities)
  )
}

export function isCrossChainSendChainEnabled(
  token: RheaSwapToken,
  capabilities: CrossChainSendCapabilities
): boolean {
  const chain = RHEA_SWAP_CHAIN_CATALOG.find(
    candidate => candidate.apiChainId === token.rheaChainId
  )
  return chain?.walletFamily === 'evm'
    ? capabilities.evm
    : chain?.walletFamily === 'solana'
      ? capabilities.solana
      : false
}

export function isCrossChainSendRecipientValid(
  destination: RheaSwapToken | null,
  address: string
): boolean {
  if (!destination || !address) return false
  if (destination.rheaChainId === 'solana') {
    try {
      return parseSolanaPublicKey(address) === address
    } catch {
      return false
    }
  }
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}
