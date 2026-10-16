import {
  findChainEndpointOverride,
  parseChainEndpointSettings,
  setActiveChainEndpointSettings,
  withActiveEvmChainId,
  type ChainEndpointSettings
} from '@/core/chains/chain-endpoint-settings'
import {
  CUSTOM_EVM_NETWORKS_ENABLED,
  resolveActiveEvmNetworkConfig,
  resolveEvmNetworkCatalog,
  resolveReleasedChainEndpointSettings
} from '@/core/chains/evm-runtime-config'
import { getBitcoinChainId, getZcashChainId, parseChainId } from '@/core/chains/registry'
import { assertDisabledChainEndpointsUnchanged } from '@/core/chains/disabled-chain-endpoint-policy'
import {
  findBuiltinEvmNetworkConfig,
  getNearNetworkConfig,
  getSolanaNetworkConfig
} from '@/config/networks'
import { attestBitcoinEsploraEndpoint } from '@/infrastructure/chains/bitcoin'
import { attestEvmRpcEndpoint } from '@/infrastructure/chains/evm'
import { attestNearRpcEndpoint } from '@/infrastructure/chains/near'
import { attestSolanaRpcEndpoint } from '@/infrastructure/chains/solana'
import { attestZcashLightwalletdEndpoint } from '@/infrastructure/chains/zcash/zcash-network-attestation'
import {
  SETTINGS_STORAGE_KEY,
  decodePersistedWalletSettings,
  resolvePersistedNetworkChainEndpointSettings,
  updatePersistedWalletSettings
} from '@/lib/wallet-settings-storage'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { ChromeSessionEvmPendingTransferStore } from '@/infrastructure/chains/evm'
import { IndexedDbTransactionRepository } from '@/infrastructure/persistence/repositories'
import { credentialLifecycle } from './credential-lifecycle'
import { dappManager } from '@/core/dapp/dapp-manager'
import {
  resolveBitcoinFeatureRuntimePolicy,
  resolveNearFeatureRuntimePolicy,
  resolveSolanaFeatureRuntimePolicy
} from '@/core/chains/feature-runtime-policy'

const MAXIMUM_ATTESTATION_CONCURRENCY = 3

async function mapWithConcurrency<T>(
  values: readonly T[],
  operation: (value: T) => Promise<void>
): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next
      next += 1
      await operation(values[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(values.length, MAXIMUM_ATTESTATION_CONCURRENCY) }, worker)
  )
}

export class ChainEndpointSettingsCoordinator {
  private readonly pendingEvmTransfers = new ChromeSessionEvmPendingTransferStore()
  private readonly transactions = new IndexedDbTransactionRepository()
  private queue: Promise<void> = Promise.resolve()

  read(): Promise<ChainEndpointSettings> {
    return this.readPersisted()
  }

  apply(value: unknown): Promise<ChainEndpointSettings> {
    return this.enqueue(() => this.applyValidated(value))
  }

  selectActiveEvmChain(chainId: string): Promise<ChainEndpointSettings> {
    return this.enqueue(async () => {
      const latest = await this.readPersisted()
      return this.applyValidated(withActiveEvmChainId(latest, chainId))
    })
  }

  private enqueue(operation: () => Promise<ChainEndpointSettings>): Promise<ChainEndpointSettings> {
    const result = this.queue.catch(() => {}).then(operation)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async readPersisted(): Promise<ChainEndpointSettings> {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
    return setActiveChainEndpointSettings(
      resolveReleasedChainEndpointSettings(
        DEFAULT_NETWORK,
        resolvePersistedNetworkChainEndpointSettings(stored[SETTINGS_STORAGE_KEY], DEFAULT_NETWORK)
      )
    )
  }

  private async applyValidated(value: unknown): Promise<ChainEndpointSettings> {
    const settings = parseChainEndpointSettings(value)
    if (!CUSTOM_EVM_NETWORKS_ENABLED && settings.customEvmNetworks.length > 0) {
      throw new Error('Custom EVM networks are not available in this release')
    }
    const currentSettings = await this.readPersisted()
    const catalog = resolveEvmNetworkCatalog(DEFAULT_NETWORK, settings)
    const solanaNetwork = getSolanaNetworkConfig(
      DEFAULT_NETWORK === 'mainnet' ? 'mainnet' : 'devnet'
    )
    const nearNetwork = getNearNetworkConfig(DEFAULT_NETWORK)
    const solanaEnabled = resolveSolanaFeatureRuntimePolicy(
      __ENABLED_CHAIN_FEATURE_FLAGS__
    ).newOperationsEnabled
    const nearEnabled = resolveNearFeatureRuntimePolicy(
      __ENABLED_CHAIN_FEATURE_FLAGS__
    ).newOperationsEnabled
    const bitcoinEnabled = resolveBitcoinFeatureRuntimePolicy(
      __ENABLED_CHAIN_FEATURE_FLAGS__
    ).newOperationsEnabled
    assertDisabledChainEndpointsUnchanged(currentSettings, settings, [
      ...(!bitcoinEnabled ? [getBitcoinChainId(DEFAULT_NETWORK)] : []),
      ...(!solanaEnabled ? [solanaNetwork.chainId] : []),
      ...(!nearEnabled ? [nearNetwork.chainId] : [])
    ])
    const supportedChainIds = new Set([
      getZcashChainId(DEFAULT_NETWORK),
      getBitcoinChainId(DEFAULT_NETWORK),
      solanaNetwork.chainId,
      nearNetwork.chainId,
      ...catalog.map(network => network.chainId)
    ])
    const unsupportedOverride = [...settings.overrides, ...(settings.savedRpcEndpoints ?? [])].find(
      override => !supportedChainIds.has(override.chainId)
    )
    if (unsupportedOverride) {
      throw new Error('This chain does not have an active endpoint adapter in this build')
    }
    if (
      settings.activeEvmChainId !== undefined &&
      !catalog.some(network => network.chainId === settings.activeEvmChainId)
    ) {
      throw new Error('The selected EVM network is not configured')
    }

    await this.assertSignedPendingTransfersRemainOnActiveChain(currentSettings, settings)

    const currentCatalog = resolveEvmNetworkCatalog(DEFAULT_NETWORK, currentSettings)
    const currentByChainId = new Map(currentCatalog.map(network => [network.chainId, network]))
    const attestations = new Map<string, () => Promise<void>>()
    for (const network of catalog) {
      const current = currentByChainId.get(network.chainId)
      // Selecting a configured chain must still work when its RPC is temporarily unavailable.
      if (current?.rpcUrl === network.rpcUrl) continue
      if (
        findBuiltinEvmNetworkConfig(DEFAULT_NETWORK, network.chainId) &&
        !findChainEndpointOverride(settings, network.chainId)?.rpc
      ) {
        continue
      }
      attestations.set(`evm:${network.chainId}:${network.rpcUrl}`, () =>
        attestEvmRpcEndpoint({ chainId: network.chainId, rpcUrl: network.rpcUrl })
      )
    }
    const newSavedEndpoints = (settings.savedRpcEndpoints ?? []).filter(
      endpoint =>
        !(currentSettings.savedRpcEndpoints ?? []).some(
          current =>
            current.chainId === endpoint.chainId &&
            current.rpc.url === endpoint.rpc.url &&
            current.rpc.protocol === endpoint.rpc.protocol
        )
    )
    for (const override of [...settings.overrides, ...newSavedEndpoints]) {
      const rpc = override.rpc
      if (!rpc) continue
      const currentOverride = findChainEndpointOverride(currentSettings, override.chainId)
      if (currentOverride?.rpc?.protocol === rpc.protocol && currentOverride.rpc.url === rpc.url) {
        continue
      }
      const chain = parseChainId(override.chainId)
      if (chain.namespace === 'eip155') {
        attestations.set(`evm:${override.chainId}:${rpc.url}`, () =>
          attestEvmRpcEndpoint({ chainId: override.chainId, rpcUrl: rpc.url })
        )
        continue
      }
      if (
        override.chainId === getZcashChainId(DEFAULT_NETWORK) &&
        rpc.protocol === 'zcash-lightwalletd'
      ) {
        attestations.set(`zcash:${rpc.url}`, () =>
          attestZcashLightwalletdEndpoint({ network: DEFAULT_NETWORK, baseUrl: rpc.url })
        )
        continue
      }
      if (
        override.chainId === getBitcoinChainId(DEFAULT_NETWORK) &&
        rpc.protocol === 'bitcoin-esplora'
      ) {
        attestations.set(`bitcoin:${rpc.url}`, () =>
          attestBitcoinEsploraEndpoint(override.chainId, rpc.url)
        )
        continue
      }
      if (
        solanaEnabled &&
        override.chainId === solanaNetwork.chainId &&
        rpc.protocol === 'solana-json-rpc'
      ) {
        attestations.set(`solana:${rpc.url}`, () =>
          attestSolanaRpcEndpoint({ chainId: override.chainId, rpcUrl: rpc.url })
        )
        continue
      }
      if (
        nearEnabled &&
        override.chainId === nearNetwork.chainId &&
        rpc.protocol === 'near-json-rpc'
      ) {
        attestations.set(`near:${rpc.url}`, () =>
          attestNearRpcEndpoint({ chainId: override.chainId, rpcUrl: rpc.url })
        )
        continue
      }
      throw new Error('This chain does not have an active custom RPC adapter in this build')
    }
    await mapWithConcurrency([...attestations.values()], attestation => attestation())

    await credentialLifecycle.synchronizeEvmNetworkMetadata(settings)

    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY)
    const raw = stored[SETTINGS_STORAGE_KEY]
    const current = decodePersistedWalletSettings(raw)
    if (current === null && raw !== undefined) {
      throw new Error('Persisted wallet settings are corrupted')
    }
    await chrome.storage.local.set({
      [SETTINGS_STORAGE_KEY]: updatePersistedWalletSettings(raw, {
        chainEndpointSettings: settings,
        chainEndpointSettingsByNetwork: {
          ...(current?.chainEndpointSettingsByNetwork &&
          typeof current.chainEndpointSettingsByNetwork === 'object' &&
          !Array.isArray(current.chainEndpointSettingsByNetwork)
            ? current.chainEndpointSettingsByNetwork
            : {}),
          [DEFAULT_NETWORK]: settings
        }
      })
    })
    const nextEvmChainIds = new Set(catalog.map(network => network.chainId))
    const removedEvmChainIds = currentCatalog
      .map(network => network.chainId)
      .filter(chainId => !nextEvmChainIds.has(chainId))
    if (removedEvmChainIds.length > 0) {
      await dappManager.removeChainAuthorizations(removedEvmChainIds)
    }
    setActiveChainEndpointSettings(settings)
    return settings
  }

  private async assertSignedPendingTransfersRemainOnActiveChain(
    current: ChainEndpointSettings,
    next: ChainEndpointSettings
  ): Promise<void> {
    const currentChainId = resolveActiveEvmNetworkConfig(DEFAULT_NETWORK, current).chainId
    const nextChainId = resolveActiveEvmNetworkConfig(DEFAULT_NETWORK, next).chainId
    if (currentChainId === nextChainId) return
    const pending = (await this.pendingEvmTransfers.list()).filter(item => item.phase === 'signed')
    for (const item of pending) {
      const graph = await this.transactions.get(item.scope, item.transactionId)
      const chainId = graph?.segments.find(
        segment => segment.role === 'origin' && segment.target.kind === 'onchain'
      )?.target
      if (!chainId || chainId.kind !== 'onchain') {
        throw new Error('A signed EVM transaction must be recovered before switching networks')
      }
      if (nextChainId !== chainId.chainId) {
        throw new Error('Broadcast the signed EVM transaction before switching networks')
      }
    }
  }
}

export function resolveConfiguredBitcoinRpcUrl(
  settings: ChainEndpointSettings
): string | undefined {
  const override = findChainEndpointOverride(settings, getBitcoinChainId(DEFAULT_NETWORK))
  return override?.rpc?.protocol === 'bitcoin-esplora' ? override.rpc.url : undefined
}
