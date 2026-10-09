import { getBitcoinNetworkConfig } from '@/config/networks'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import type { BitcoinSupportedAddressType } from '@/core/chains/bitcoin'
import {
  createAssetRegistry,
  createInitialProductChainRegistry,
  getBundledInitialProductAssetDefinitions
} from '@/core/chains/registry'
import {
  BitcoinChangeReservationCoordinator,
  BitcoinDiscoveryCoordinator,
  BitcoinDiscoveryRefresher,
  BitcoinGapLimitScanner,
  BitcoinOwnedTransactionBalanceUpdater,
  BitcoinPortfolioCoordinator,
  BitcoinTransferOrchestrator,
  BitcoinTransferPreparationCoordinator,
  ChromeSessionBitcoinPendingTransferStore,
  createConfiguredBitcoinEsploraClient,
  IndexedDbBitcoinChangeReservationRepository,
  IndexedDbBitcoinDiscoveryRepository,
  IndexedDbBitcoinInputReservationRepository,
  loadActiveBitcoinDiscoveryContext
} from '@/infrastructure/chains/bitcoin'
import { BitcoinMultichainDerivationClient } from '@/infrastructure/keyring/multichain/bitcoin-derivation-client'
import { BitcoinAddressDerivationRouter } from '@/infrastructure/keyring/bitcoin-address-derivation-router'
import { BitcoinMultichainSigningClient } from '@/infrastructure/keyring/multichain/bitcoin-signing-client'
import {
  IndexedDbStorageV2Repository,
  IndexedDbCredentialRepository,
  IndexedDbTransactionRepository
} from '@/infrastructure/persistence/repositories'
import { formatLogError } from '@/lib/log-format'
import { logger } from '@/lib/logger'
import { BITCOIN_TRANSACTION_MONITOR_ALARM } from './bitcoin-transaction-monitor'
import { NEAR_INTENTS_TRANSACTION_MONITOR_ALARM } from './near-intents-transaction-monitor'
import { BackgroundBitcoinTransferController } from './bitcoin-transfer-controller'
import { getBitcoinAccountPreferences } from './bitcoin-account-preferences'
import { credentialSession } from './credential-session'
import { recordRheaSwapGraphBroadcast } from './rhea-swap'

export { BackgroundBitcoinTransferController } from './bitcoin-transfer-controller'
export type {
  BackgroundBitcoinTransferControllerOptions,
  BackgroundBitcoinTransferReview
} from './bitcoin-transfer-controller'

interface BackgroundBitcoinRuntime {
  readonly controller: BackgroundBitcoinTransferController
  readonly portfolio: BitcoinPortfolioCoordinator
  readonly discovery: BitcoinDiscoveryCoordinator
}

let backgroundBitcoinRuntime: BackgroundBitcoinRuntime | null = null

export function hasBackgroundBitcoinTransferCapability(): boolean {
  const chain = createInitialProductChainRegistry(DEFAULT_NETWORK).resolve(
    getBitcoinNetworkConfig(DEFAULT_NETWORK).chainId
  )
  return (
    chain.capabilities.transaction.status === 'available' &&
    chain.capabilities.transaction.actions.includes('native-transfer')
  )
}

function createBackgroundBitcoinRuntime(customRpcUrl?: string): BackgroundBitcoinRuntime {
  const network = getBitcoinNetworkConfig(DEFAULT_NETWORK)
  const storageRepository = new IndexedDbStorageV2Repository()
  const discoveryRepository = new IndexedDbBitcoinDiscoveryRepository()
  const inputReservations = new IndexedDbBitcoinInputReservationRepository()
  const accountPreferences = getBitcoinAccountPreferences()
  const getAddressType = (context: {
    readonly chainAccount: {
      readonly scope: { readonly keyDomainId: string; readonly accountId: string }
    }
  }) =>
    accountPreferences.get({
      network: DEFAULT_NETWORK,
      keyDomainId: context.chainAccount.scope.keyDomainId,
      accountId: context.chainAccount.scope.accountId
    })
  const derivation = new BitcoinAddressDerivationRouter({
    software: new BitcoinMultichainDerivationClient({ credentials: credentialSession }),
    storageRepository,
    credentialRepository: new IndexedDbCredentialRepository(),
    credentials: credentialSession,
    network: DEFAULT_NETWORK
  })
  const rpc = createConfiguredBitcoinEsploraClient(DEFAULT_NETWORK, customRpcUrl)
  const discoveryRefresher = new BitcoinDiscoveryRefresher({ rpc, concurrency: 1 })
  const notifyPortfolioUpdated = (scope: {
    readonly keyDomainId: string
    readonly accountId: string
  }) =>
    chrome.runtime
      .sendMessage({
        type: 'PORTFOLIO_UPDATED',
        walletId: scope.keyDomainId,
        accountId: scope.accountId
      })
      .catch(() => {})
  const balanceUpdater = new BitcoinOwnedTransactionBalanceUpdater({
    storageRepository,
    discoveryRepository,
    chainId: network.chainId,
    onUpdated: notifyPortfolioUpdated
  })
  const discovery = new BitcoinDiscoveryCoordinator({
    storageRepository,
    discoveryRepository,
    scanner: new BitcoinGapLimitScanner({ derivation, rpc }),
    refresher: discoveryRefresher,
    chainId: network.chainId,
    onProgress: (context, observation) => {
      if (!observation.activity.used && observation.utxos.length === 0) return
      void notifyPortfolioUpdated(context.chainAccount.scope)
    }
  })
  const changeReservations = new BitcoinChangeReservationCoordinator({
    discoveryRepository,
    reservationRepository: new IndexedDbBitcoinChangeReservationRepository(),
    derivation
  })
  const preparation = new BitcoinTransferPreparationCoordinator({
    discoveryRepository,
    derivation,
    rpc,
    inputReservations
  })
  const chains = createInitialProductChainRegistry(DEFAULT_NETWORK)
  const assets = createAssetRegistry(
    chains,
    getBundledInitialProductAssetDefinitions(DEFAULT_NETWORK)
  )
  const scheduleMonitor = async () => {
    await Promise.all([
      chrome.alarms.create(BITCOIN_TRANSACTION_MONITOR_ALARM, { delayInMinutes: 0.1 }),
      chrome.alarms.create(NEAR_INTENTS_TRANSACTION_MONITOR_ALARM, { delayInMinutes: 0.1 })
    ])
  }
  const orchestrator = new BitcoinTransferOrchestrator({
    repository: new IndexedDbTransactionRepository(),
    pendingStore: new ChromeSessionBitcoinPendingTransferStore(),
    signer: new BitcoinMultichainSigningClient({ credentials: credentialSession }),
    rpc,
    assets,
    changeReservations,
    inputReservations,
    onPendingBroadcast: scheduleMonitor,
    onBroadcastAccepted: async input => {
      const result = await balanceUpdater.applyBroadcast(input)
      if (result.errors > 0) {
        logger.warn(
          'Bitcoin post-broadcast balance update was incomplete',
          input.scope.keyDomainId,
          input.scope.accountId
        )
      }
      await recordRheaSwapGraphBroadcast(input.graph).catch(error => {
        logger.warn(`RHEA Swap submission recovery was deferred: ${formatLogError(error)}`)
      })
    },
    onMonitoringRequired: scheduleMonitor
  })
  const controller = new BackgroundBitcoinTransferController({
    preparation,
    orchestrator,
    loadActiveContext: () => loadActiveBitcoinDiscoveryContext(storageRepository, network.chainId),
    scanActive: addressType => discovery.scanActive({ addressType }),
    getAddressType,
    requiredConfirmations: network.requiredConfirmations
  })
  const portfolio = new BitcoinPortfolioCoordinator({
    storageRepository,
    discovery,
    inputReservations,
    chainId: network.chainId,
    chains,
    assets,
    getAddressType,
    onRefreshError: (error, context) => {
      logger.warn(
        `Bitcoin portfolio refresh failed: ${formatLogError(error)}`,
        context.chainAccount.scope.keyDomainId,
        context.chainAccount.scope.accountId
      )
    }
  })
  return Object.freeze({ controller, portfolio, discovery })
}

function getBackgroundBitcoinRuntime(): BackgroundBitcoinRuntime {
  backgroundBitcoinRuntime ??= createBackgroundBitcoinRuntime()
  return backgroundBitcoinRuntime
}

export function createBackgroundBitcoinTransferController(): BackgroundBitcoinTransferController {
  return getBackgroundBitcoinRuntime().controller
}

export function createBackgroundBitcoinPortfolioCoordinator(): BitcoinPortfolioCoordinator {
  return getBackgroundBitcoinRuntime().portfolio
}

export function scanBackgroundBitcoinAddressType(addressType: BitcoinSupportedAddressType) {
  return getBackgroundBitcoinRuntime().discovery.scanActive({ addressType })
}

export async function reloadBackgroundBitcoinRuntime(
  customRpcUrl?: string,
  cancelAwaitingApprovals = true
): Promise<void> {
  if (backgroundBitcoinRuntime && cancelAwaitingApprovals) {
    await backgroundBitcoinRuntime.controller.cancelAllAwaitingApprovals()
  }
  backgroundBitcoinRuntime = createBackgroundBitcoinRuntime(customRpcUrl)
}
