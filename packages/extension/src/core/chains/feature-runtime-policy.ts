import {
  BITCOIN_CHAIN_FEATURE_FLAG,
  EVM_CHAIN_FEATURE_FLAG,
  NEAR_CHAIN_FEATURE_FLAG,
  SOLANA_CHAIN_FEATURE_FLAG,
  type ChainFeatureFlagValue
} from '@/config/multichain-feature-flags'

export interface EvmFeatureRuntimePolicy {
  readonly newOperationsEnabled: boolean
  readonly transactionRecoveryEnabled: true
}

export function resolveEvmFeatureRuntimePolicy(
  enabledFlags: readonly ChainFeatureFlagValue[]
): EvmFeatureRuntimePolicy {
  return Object.freeze({
    newOperationsEnabled: enabledFlags.includes(EVM_CHAIN_FEATURE_FLAG),
    transactionRecoveryEnabled: true
  })
}

export interface BitcoinFeatureRuntimePolicy {
  readonly newOperationsEnabled: boolean
  readonly transactionRecoveryEnabled: true
}

export function resolveBitcoinFeatureRuntimePolicy(
  enabledFlags: readonly ChainFeatureFlagValue[]
): BitcoinFeatureRuntimePolicy {
  return Object.freeze({
    newOperationsEnabled: enabledFlags.includes(BITCOIN_CHAIN_FEATURE_FLAG),
    transactionRecoveryEnabled: true
  })
}

export interface SolanaFeatureRuntimePolicy {
  readonly newOperationsEnabled: boolean
}

export function resolveSolanaFeatureRuntimePolicy(
  enabledFlags: readonly ChainFeatureFlagValue[]
): SolanaFeatureRuntimePolicy {
  return Object.freeze({
    newOperationsEnabled: enabledFlags.includes(SOLANA_CHAIN_FEATURE_FLAG)
  })
}

export interface NearFeatureRuntimePolicy {
  readonly newOperationsEnabled: boolean
}

export function resolveNearFeatureRuntimePolicy(
  enabledFlags: readonly ChainFeatureFlagValue[]
): NearFeatureRuntimePolicy {
  return Object.freeze({
    newOperationsEnabled: enabledFlags.includes(NEAR_CHAIN_FEATURE_FLAG)
  })
}
