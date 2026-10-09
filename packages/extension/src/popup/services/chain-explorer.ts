import {
  getBitcoinNetworkConfig,
  getNearNetworkConfig,
  getSolanaNetworkConfig
} from '@/config/networks'
import {
  getBlockExplorerBaseUrl,
  getBlockExplorerTransactionPath
} from '@/lib/block-explorer-preferences'
import {
  findChainEndpointOverride,
  getActiveChainEndpointSettings
} from '@/core/chains/chain-endpoint-settings'
import { resolveEvmNetworkCatalog } from '@/core/chains/evm-runtime-config'
import { getNetworkConfig } from '@/lib/runtime-network'
import { getBitcoinChainId, getZcashChainId } from '@/core/chains/registry'
import type { Network } from '@/types'

export interface ChainExplorerTarget {
  readonly baseUrl: string
  readonly transactionPath: string
}

export function resolveChainExplorerTarget(
  chainId: string,
  network: Network
): ChainExplorerTarget | null {
  const settings = getActiveChainEndpointSettings()
  const custom = findChainEndpointOverride(settings, chainId)?.explorer
  if (custom) {
    return Object.freeze({
      baseUrl: custom.baseUrl,
      transactionPath: custom.transactionPath
    })
  }
  if (chainId === getZcashChainId(network)) {
    return network === 'mainnet'
      ? Object.freeze({
          baseUrl: getBlockExplorerBaseUrl('zcash'),
          transactionPath: getBlockExplorerTransactionPath('zcash')
        })
      : Object.freeze({ baseUrl: getNetworkConfig(network).explorerUrl, transactionPath: 'tx' })
  }
  if (chainId === getBitcoinChainId(network)) {
    return Object.freeze({
      baseUrl: getBitcoinNetworkConfig(network).explorerUrl,
      transactionPath: 'tx'
    })
  }
  const solana = getSolanaNetworkConfig(network === 'mainnet' ? 'mainnet' : 'devnet')
  if (chainId === solana.chainId) {
    return Object.freeze({ baseUrl: 'https://solscan.io', transactionPath: 'tx' })
  }
  const near = getNearNetworkConfig(network)
  if (chainId === near.chainId) {
    return Object.freeze({ baseUrl: near.explorerUrl, transactionPath: 'txns' })
  }
  const evm = resolveEvmNetworkCatalog(network, settings).find(config => config.chainId === chainId)
  return evm?.explorerUrl
    ? Object.freeze({ baseUrl: evm.explorerUrl, transactionPath: 'tx' })
    : null
}

export function formatChainTransactionExplorerUrl(
  chainId: string,
  transactionHash: string,
  network: Network
): string {
  const custom = findChainEndpointOverride(getActiveChainEndpointSettings(), chainId)?.explorer
  if (custom) {
    return `${custom.baseUrl}/${custom.transactionPath}/${encodeURIComponent(transactionHash)}`
  }
  const solana = getSolanaNetworkConfig(network === 'mainnet' ? 'mainnet' : 'devnet')
  if (chainId === solana.chainId) {
    const cluster = network === 'mainnet' ? '' : '?cluster=devnet'
    return `https://solscan.io/tx/${encodeURIComponent(transactionHash)}${cluster}`
  }
  const target = resolveChainExplorerTarget(chainId, network)
  if (!target) return ''
  return `${target.baseUrl}/${target.transactionPath}/${encodeURIComponent(transactionHash)}`
}

export function formatChainAddressExplorerUrl(
  chainId: string,
  address: string,
  network: Network
): string {
  const custom = findChainEndpointOverride(getActiveChainEndpointSettings(), chainId)?.explorer
  if (custom) return `${custom.baseUrl}/address/${encodeURIComponent(address)}`
  const solana = getSolanaNetworkConfig(network === 'mainnet' ? 'mainnet' : 'devnet')
  if (chainId === solana.chainId) {
    const cluster = network === 'mainnet' ? '' : '?cluster=devnet'
    return `https://solscan.io/account/${encodeURIComponent(address)}${cluster}`
  }
  const near = getNearNetworkConfig(network)
  if (chainId === near.chainId) {
    return `${near.explorerUrl}/address/${encodeURIComponent(address)}`
  }
  const target = resolveChainExplorerTarget(chainId, network)
  if (!target) return ''
  return `${target.baseUrl}/address/${encodeURIComponent(address)}`
}

export function formatChainAssetExplorerUrl(
  chainId: string,
  asset: Readonly<{ kind: 'native' | 'token'; namespace: string; reference: string }>,
  network: Network
): string {
  const custom = findChainEndpointOverride(getActiveChainEndpointSettings(), chainId)?.explorer
  if (custom) return custom.baseUrl
  const target = resolveChainExplorerTarget(chainId, network)
  if (!target) return ''
  if (asset.kind === 'token' && asset.namespace === 'erc20') {
    return `${target.baseUrl}/token/${encodeURIComponent(asset.reference)}`
  }
  return target.baseUrl
}
