import {
  findBuiltinEvmNetworkConfig,
  getBitcoinNetworkConfig,
  getEvmNetworkConfigs,
  getNearNetworkConfig,
  NETWORKS,
  getSolanaNetworkConfig
} from '@/config/networks'
import {
  getBlockExplorerBaseUrl,
  getBlockExplorerTransactionPath
} from '@/lib/block-explorer-preferences'
import { BLOCK_EXPLORER_GROUPS } from '@/config/block-explorers'
import {
  resolveBitcoinFeatureRuntimePolicy,
  resolveEvmFeatureRuntimePolicy,
  resolveNearFeatureRuntimePolicy,
  resolveSolanaFeatureRuntimePolicy
} from '@/core/chains/feature-runtime-policy'
import type { ChainEndpointSettings, ChainRpcProtocol } from '@/core/chains/chain-endpoint-settings'
import { resolveEvmNetworkCatalog } from '@/core/chains/evm-runtime-config'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import {
  getEvmRpcEndpointOptions,
  resolveBitcoinRpcEndpointOptions,
  resolveNearRpcEndpointOptions,
  resolveSolanaRpcEndpointOptions
} from '@/infrastructure/chains/managed-rpc-endpoints'
import { getBitcoinChainId, getZcashChainId } from '@/core/chains/registry'
import type { RpcEndpointGroup } from '@/config/rpc-endpoints'

interface RpcEndpointPreset {
  readonly id: string
  readonly label: string
  readonly url: string
}

export interface RpcChainOption {
  readonly chainId: string
  readonly label: string
  readonly iconChain: string
  readonly protocol: ChainRpcProtocol
  readonly defaultUrl: string
  readonly presets?: readonly RpcEndpointPreset[]
}

export interface ExplorerChainOption {
  readonly chainId: string
  readonly label: string
  readonly iconChain: string
  readonly defaultUrl: string
  readonly defaultTransactionPath: string
  readonly presets?: readonly {
    readonly id: string
    readonly label: string
    readonly baseUrl: string
    readonly transactionPath: string
  }[]
}

export function buildZcashRpcChainOption(groups: readonly RpcEndpointGroup[]): RpcChainOption {
  return {
    chainId: getZcashChainId(DEFAULT_NETWORK),
    label: DEFAULT_NETWORK === 'testnet' ? 'Zcash Testnet' : 'Zcash',
    iconChain: 'zec',
    protocol: 'zcash-lightwalletd',
    defaultUrl: NETWORKS[DEFAULT_NETWORK].rpcUrl,
    presets: groups.find(group => group.chain === 'zcash')?.options
  }
}

export function buildRpcChainOptions(settings: ChainEndpointSettings): readonly RpcChainOption[] {
  const bitcoin = getBitcoinNetworkConfig(DEFAULT_NETWORK)
  const solana = getSolanaNetworkConfig(DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'devnet')
  const near = getNearNetworkConfig(DEFAULT_NETWORK)
  const evmEnabled = resolveEvmFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled
  const bitcoinEnabled = resolveBitcoinFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled
  const solanaEnabled = resolveSolanaFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled
  const nearEnabled = resolveNearFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled

  return Object.freeze([
    ...(bitcoinEnabled
      ? [
          Object.freeze({
            chainId: getBitcoinChainId(DEFAULT_NETWORK),
            label: bitcoin.displayName,
            iconChain: 'btc',
            protocol: 'bitcoin-esplora' as const,
            defaultUrl: resolveBitcoinRpcEndpointOptions(DEFAULT_NETWORK)[0].baseUrl,
            presets: resolveBitcoinRpcEndpointOptions(DEFAULT_NETWORK).map(endpoint =>
              Object.freeze({
                id: endpoint.id,
                label: endpoint.id === 'mempool-space' ? 'mempool.space' : 'Blockstream',
                url: endpoint.baseUrl
              })
            )
          })
        ]
      : []),
    ...(evmEnabled
      ? resolveEvmNetworkCatalog(DEFAULT_NETWORK, settings).map(network => {
          const builtin = findBuiltinEvmNetworkConfig(DEFAULT_NETWORK, network.chainId)
          return Object.freeze({
            chainId: network.chainId,
            label: network.displayName,
            iconChain: network.iconChain,
            protocol: 'evm-json-rpc' as const,
            defaultUrl: builtin
              ? getEvmRpcEndpointOptions(DEFAULT_NETWORK, network.chainId)[0].url
              : (settings.customEvmNetworks.find(custom => custom.chainId === network.chainId)?.rpc
                  .url ?? network.rpcUrl),
            ...(builtin
              ? { presets: getEvmRpcEndpointOptions(DEFAULT_NETWORK, network.chainId) }
              : {})
          })
        })
      : []),
    ...(solanaEnabled
      ? [
          Object.freeze({
            chainId: solana.chainId,
            label: solana.displayName,
            iconChain: 'sol',
            protocol: 'solana-json-rpc' as const,
            defaultUrl: resolveSolanaRpcEndpointOptions(solana.cluster)[0].url,
            presets: resolveSolanaRpcEndpointOptions(solana.cluster)
          })
        ]
      : []),
    ...(nearEnabled
      ? [
          Object.freeze({
            chainId: near.chainId,
            label: near.displayName,
            iconChain: 'near',
            protocol: 'near-json-rpc' as const,
            defaultUrl: resolveNearRpcEndpointOptions(near.network)[0].url,
            presets: resolveNearRpcEndpointOptions(near.network)
          })
        ]
      : [])
  ])
}

export function buildExplorerChainOptions(
  settings: ChainEndpointSettings
): readonly ExplorerChainOption[] {
  const zcash = NETWORKS[DEFAULT_NETWORK]
  const bitcoin = getBitcoinNetworkConfig(DEFAULT_NETWORK)
  const solana = getSolanaNetworkConfig(DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'devnet')
  const near = getNearNetworkConfig(DEFAULT_NETWORK)
  const builtinEvm = getEvmNetworkConfigs(DEFAULT_NETWORK)
  const evmEnabled = resolveEvmFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled
  const bitcoinEnabled = resolveBitcoinFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled
  const solanaEnabled = resolveSolanaFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled
  const nearEnabled = resolveNearFeatureRuntimePolicy(
    __ENABLED_CHAIN_FEATURE_FLAGS__
  ).newOperationsEnabled

  return Object.freeze([
    Object.freeze({
      chainId: getZcashChainId(DEFAULT_NETWORK),
      label: 'Zcash',
      iconChain: 'zec',
      defaultUrl:
        DEFAULT_NETWORK === 'mainnet' ? getBlockExplorerBaseUrl('zcash') : zcash.explorerUrl,
      defaultTransactionPath:
        DEFAULT_NETWORK === 'mainnet' ? getBlockExplorerTransactionPath('zcash') : 'tx',
      ...(DEFAULT_NETWORK === 'mainnet'
        ? { presets: BLOCK_EXPLORER_GROUPS.find(group => group.chain === 'zcash')?.options }
        : {})
    }),
    ...(bitcoinEnabled
      ? [
          Object.freeze({
            chainId: getBitcoinChainId(DEFAULT_NETWORK),
            label: bitcoin.displayName,
            iconChain: 'btc',
            defaultUrl: bitcoin.explorerUrl,
            defaultTransactionPath: 'tx'
          })
        ]
      : []),
    ...(evmEnabled
      ? resolveEvmNetworkCatalog(DEFAULT_NETWORK, settings).map(network => {
          const customNetwork = settings.customEvmNetworks.find(
            custom => custom.chainId === network.chainId
          )
          return Object.freeze({
            chainId: network.chainId,
            label: network.displayName,
            iconChain: network.iconChain,
            defaultUrl:
              builtinEvm.find(builtin => builtin.chainId === network.chainId)?.explorerUrl ??
              customNetwork?.explorer?.baseUrl ??
              '',
            defaultTransactionPath: customNetwork?.explorer?.transactionPath ?? 'tx'
          })
        })
      : []),
    ...(solanaEnabled
      ? [
          Object.freeze({
            chainId: solana.chainId,
            label: solana.displayName,
            iconChain: 'sol',
            defaultUrl: solana.explorerUrl,
            defaultTransactionPath: 'tx'
          })
        ]
      : []),
    ...(nearEnabled
      ? [
          Object.freeze({
            chainId: near.chainId,
            label: near.displayName,
            iconChain: 'near',
            defaultUrl: near.explorerUrl,
            defaultTransactionPath: 'txns'
          })
        ]
      : [])
  ])
}
