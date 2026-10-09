import { parseAccountId } from '@/core/accounts/domain'
import { parseKeyDomainId } from '@/core/keyring/domain'
import { backgroundZcashWalletRuntime } from './zcash-wallet-runtime'
import {
  deleteIndexedDbBitcoinChangeReservations,
  IndexedDbBitcoinChangeReservationRepository
} from '@/infrastructure/chains/bitcoin/bitcoin-change-reservation-repository'
import {
  deleteIndexedDbBitcoinDiscovery,
  IndexedDbBitcoinDiscoveryRepository
} from '@/infrastructure/chains/bitcoin/bitcoin-discovery-repository'
import {
  deleteIndexedDbBitcoinInputReservations,
  IndexedDbBitcoinInputReservationRepository
} from '@/infrastructure/chains/bitcoin/bitcoin-input-reservation-repository'
import { CredentialRemovalCoordinator } from '@/infrastructure/keyring/migration'
import {
  deleteStorageV2Persistence,
  deleteIndexedDbPortfolioCache,
  deleteIndexedDbTransactionPersistence,
  IndexedDbCredentialRepository,
  IndexedDbPortfolioCacheRepository,
  IndexedDbStorageV2Repository,
  IndexedDbTransactionRepository
} from '@/infrastructure/persistence/repositories'
import {
  deleteHistoryCache,
  deleteHistoryCacheByAccountScope
} from '@/infrastructure/chains/evm/evm-activity-history-cache'
import { rehydrateAccountDataStore } from '@/store/account-data-store'
import { flushWalletStore, rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import {
  commitWalletMetadataDeletion,
  completeWalletMetadataDeletion,
  getWalletDeletionRecord,
  resetWalletMetadata
} from '@/lib/wallet-metadata-storage'
import { dappHandler } from './dapp-handler'
import { syncScheduler } from './sync-scheduler'
import { transactionMonitor } from './transaction-monitor'
import { zcashTxMonitor } from './zcash-tx-monitor'
import { credentialSession } from './credential-session'
import { accountContextTransition } from './account-context-transition'
import { WalletMetadataCoordinator } from '@/infrastructure/keyring/wallet-metadata-coordinator'
import { pendingRequestsManager } from './pending-requests'
import {
  getDetectedEvmAssetCatalogStorageKey,
  getUserEvmAssetCatalogStorageKey
} from '@/infrastructure/chains/evm'
import {
  getLegacyEvmAssetVisibilityStorageKey,
  getTokenVisibilityStorageKey
} from '@/infrastructure/portfolio/chrome-token-visibility'
import {
  DEFI_LLAMA_MARKET_CACHE_STORAGE_KEY,
  USER_ASSET_DEX_POOL_CACHE_STORAGE_KEY,
  USER_ASSET_MARKET_CACHE_STORAGE_KEY,
  USER_ASSET_ONE_CLICK_PRICE_CACHE_STORAGE_KEY
} from '@/infrastructure/prices'
import { deleteLendingMarketCache } from '@/infrastructure/lending/chrome-lending-market-cache'
import {
  LENDING_MARKET_CACHE_STORAGE_KEY,
  SWAP_TOKEN_CATALOG_CACHE_STORAGE_KEY
} from '@/config/extension'
import { ActivityHistoryCache } from './activity-history-cache'
import { dappExecutionModeCoordinator } from './dapp-execution-mode'
import type { WalletBackupVerification } from '@/core/wallet/secret-phrase-backup'

type ActiveAccount = {
  walletId: string | null
  accountId: string | null
}

function isNativeStorageV2Wallet(
  keyDomain: Readonly<{ readonly id: string; readonly source: { readonly kind: string } }>
): boolean {
  return (
    (keyDomain.source.kind === 'hardware' && keyDomain.id.startsWith('wallet:keystone-v2:')) ||
    (keyDomain.source.kind === 'private-key' && keyDomain.id.startsWith('wallet:private-key-v2:'))
  )
}

export class WalletCleanupCoordinator {
  private queue: Promise<void> = Promise.resolve()
  private readonly credentialRepository = new IndexedDbCredentialRepository()
  private readonly storageRepository = new IndexedDbStorageV2Repository()
  private readonly credentialRemoval = new CredentialRemovalCoordinator({
    credentialRepository: this.credentialRepository,
    storageRepository: this.storageRepository
  })
  private readonly walletMetadata = new WalletMetadataCoordinator({
    credentialRepository: this.credentialRepository,
    storageRepository: this.storageRepository
  })
  private readonly bitcoinDiscovery = new IndexedDbBitcoinDiscoveryRepository()
  private readonly bitcoinChangeReservations = new IndexedDbBitcoinChangeReservationRepository()
  private readonly bitcoinInputReservations = new IndexedDbBitcoinInputReservationRepository()
  private readonly transactionRepository = new IndexedDbTransactionRepository()
  private readonly portfolioCache = new IndexedDbPortfolioCacheRepository()
  private readonly activityHistoryCache = new ActivityHistoryCache('mainnet')

  constructor(
    private readonly notifyAccountSwitched: (options?: {
      refreshPortfolio?: boolean
    }) => Promise<void>,
    private readonly clearPendingMultichainTransfers: () => Promise<void> = async () => {},
    private readonly removePendingCrossChainAccount: (
      walletId: string,
      accountId?: string
    ) => Promise<void> = async () => {}
  ) {}

  private enqueue<T>(mutation: () => Promise<T>): Promise<T> {
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        syncScheduler.pauseForTx()
        try {
          return await mutation()
        } finally {
          syncScheduler.resumeAfterTx()
        }
      })
    this.queue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  private getActiveAccount(): ActiveAccount {
    const { currentWalletId, currentAccountId } = useWalletStore.getState()
    return {
      walletId: currentWalletId,
      accountId: currentAccountId
    }
  }

  private async hydrateStores(): Promise<void> {
    await Promise.all([rehydrateWalletStore(), rehydrateAccountDataStore()])
  }

  private async resumeAfterMutation(
    previous: ActiveAccount,
    resumeCurrentWallet: boolean
  ): Promise<void> {
    const current = this.getActiveAccount()
    const currentChanged =
      current.walletId !== previous.walletId || current.accountId !== previous.accountId

    if (current.walletId && current.accountId && (currentChanged || resumeCurrentWallet)) {
      await backgroundZcashWalletRuntime.initialize()
      if (!backgroundZcashWalletRuntime.isLocked()) {
        await backgroundZcashWalletRuntime.ensureWalletCoreAccount(
          current.walletId,
          current.accountId
        )
      }
      syncScheduler.onAccountSwitched(current.walletId)
    }

    if (currentChanged) {
      await this.notifyAccountSwitched()
    }
  }

  private async refreshCredentialSessionAfterWalletRemoval(password: string | null): Promise<void> {
    if (!password) return
    try {
      await credentialSession.unlock(password)
    } catch {
      await credentialSession.lock().catch(() => {})
      await backgroundZcashWalletRuntime.lock()
    }
  }

  removeAccount(
    walletId: string,
    accountId: string,
    verification?: WalletBackupVerification
  ): Promise<void> {
    return this.enqueue(async () => {
      await this.hydrateStores()
      const previous = this.getActiveAccount()
      const wallet = useWalletStore.getState().getWallet(walletId)
      const account = wallet?.accounts.find(candidate => candidate.id === accountId)
      if (!wallet || !account) {
        if (await getWalletDeletionRecord(walletId)) {
          await this.removeNativeStorageV2Wallet(walletId, previous)
        }
        return
      }

      const totalAccounts = useWalletStore
        .getState()
        .wallets.reduce((sum, item) => sum + item.accounts.length, 0)
      if (totalAccounts <= 1) {
        throw new Error('Cannot remove the last account')
      }

      await accountContextTransition.runScopedMutation([{ walletId, accountId }], async () => {
        const removesWallet = wallet.accounts.length === 1
        const sessionPassword = removesWallet
          ? backgroundZcashWalletRuntime.getSessionPassword()
          : null
        if (removesWallet) {
          await backgroundZcashWalletRuntime.verifyWalletBackupForRemoval(walletId, verification)
          await commitWalletMetadataDeletion(
            walletId,
            wallet.accounts.map(item => item.id)
          )
          await this.credentialRemoval.removeWallet(walletId)
        } else {
          await this.credentialRemoval.removeAccount(walletId, accountId)
        }
        if (removesWallet) {
          await syncScheduler.prepareWalletRemoval(walletId)
          await Promise.all([
            transactionMonitor.removeAccount(walletId),
            zcashTxMonitor.removeAccount(walletId),
            this.removePendingCrossChainAccount(walletId),
            dappHandler.removeAccountReferences(walletId)
          ])
        } else {
          await syncScheduler.prepareAccountRemoval(walletId)
          await Promise.all([
            transactionMonitor.removeAccount(walletId, accountId),
            zcashTxMonitor.removeAccount(walletId, accountId),
            this.removePendingCrossChainAccount(walletId, accountId),
            dappHandler.removeAccountReferences(walletId, accountId)
          ])
        }
        await this.removeMultichainAccountData(walletId, accountId)

        await backgroundZcashWalletRuntime.removeAccountAuthoritatively(walletId, accountId)
        if (removesWallet) {
          await this.refreshCredentialSessionAfterWalletRemoval(sessionPassword)
        }
        await this.resumeAfterMutation(previous, !removesWallet)
        if (removesWallet) await completeWalletMetadataDeletion(walletId)
      })
    })
  }

  removeWallet(walletId: string, verification?: WalletBackupVerification): Promise<void> {
    return this.enqueue(async () => {
      await this.hydrateStores()
      const previous = this.getActiveAccount()
      const wallet = useWalletStore.getState().getWallet(walletId)
      if (!wallet) {
        await this.removeNativeStorageV2Wallet(walletId, previous)
        return
      }
      await accountContextTransition.runScopedMutation(
        wallet.accounts.map(account => ({ walletId, accountId: account.id })),
        async () => {
          const sessionPassword = backgroundZcashWalletRuntime.getSessionPassword()
          await backgroundZcashWalletRuntime.verifyWalletBackupForRemoval(walletId, verification)
          await commitWalletMetadataDeletion(
            walletId,
            wallet.accounts.map(item => item.id)
          )
          await this.credentialRemoval.removeWallet(walletId)
          await syncScheduler.prepareWalletRemoval(walletId)
          await Promise.all([
            transactionMonitor.removeAccount(walletId),
            zcashTxMonitor.removeAccount(walletId),
            this.removePendingCrossChainAccount(walletId),
            dappHandler.removeAccountReferences(walletId)
          ])
          await Promise.all(
            wallet.accounts.map(account => this.removeMultichainAccountData(walletId, account.id))
          )
          await backgroundZcashWalletRuntime.removeWalletAuthoritatively(walletId)
          await this.refreshCredentialSessionAfterWalletRemoval(sessionPassword)
          await this.resumeAfterMutation(previous, false)
          await completeWalletMetadataDeletion(walletId)
        }
      )
    })
  }

  renameAccount(walletId: string, accountId: string, displayName: string): Promise<void> {
    return this.enqueue(() =>
      accountContextTransition.runActiveOperation(async () => {
        if (!(await credentialSession.hasUnlockSession())) throw new Error('Wallet is locked')
        await this.hydrateStores()
        const wallet = useWalletStore.getState().getWallet(walletId)
        const account = wallet?.accounts.find(candidate => candidate.id === accountId)
        if (!wallet || !account) throw new Error('Account not found')

        const previousName = useWalletStore.getState().getAccountDisplayName(walletId, accountId)
        const previousDisplayName = previousName ?? account.name
        const result = await this.walletMetadata.renameAccount({
          keyDomainId: walletId,
          accountId,
          displayName
        })
        if (result.status === 'storage-v2-inactive') throw new Error('Account not found')

        useWalletStore.getState().setAccountDisplayName(walletId, accountId, displayName)
        try {
          await flushWalletStore()
        } catch (error) {
          useWalletStore.getState().setAccountDisplayName(walletId, accountId, previousName)
          try {
            await this.walletMetadata.renameAccount({
              keyDomainId: walletId,
              accountId,
              displayName: previousDisplayName
            })
          } catch {
            throw new Error('Account rename failed and its metadata rollback could not be verified')
          }
          throw error
        }
      })
    )
  }

  setAccountPinned(walletId: string, accountId: string, pinned: boolean): Promise<void> {
    return this.setAccountPreference(walletId, accountId, 'isPinned', pinned)
  }

  setAccountHidden(walletId: string, accountId: string, hidden: boolean): Promise<void> {
    return this.setAccountPreference(walletId, accountId, 'isHidden', hidden)
  }

  private setAccountPreference(
    walletId: string,
    accountId: string,
    preference: 'isPinned' | 'isHidden',
    value: boolean
  ): Promise<void> {
    return this.enqueue(async () => {
      if (!(await credentialSession.hasUnlockSession())) throw new Error('Wallet is locked')
      await this.hydrateStores()
      const account = useWalletStore.getState().getAccount(walletId, accountId)
      if (!account) throw new Error('Account not found')
      const previousValue = account[preference]
      if (previousValue === value) return

      useWalletStore.getState().updateAccountInWallets(walletId, accountId, { [preference]: value })
      try {
        await flushWalletStore()
      } catch (error) {
        useWalletStore
          .getState()
          .updateAccountInWallets(walletId, accountId, { [preference]: previousValue })
        throw error
      }
    })
  }

  renameNativeWallet(walletId: string, displayName: string) {
    return this.enqueue(async () => {
      if (!(await credentialSession.hasUnlockSession())) throw new Error('Wallet is locked')
      const pointer = await this.storageRepository.getActivePointer()
      if (!pointer) throw new Error('Wallet not found')
      const snapshot = await this.storageRepository.getSnapshot(pointer.generationId)
      if (!snapshot) throw new Error('Active Storage V2 generation is missing')
      const keyDomain = snapshot.keyDomains.find(item => item.id === walletId)
      if (!keyDomain || !isNativeStorageV2Wallet(keyDomain)) {
        throw new Error('Wallet metadata is not managed by the native Wallet inventory')
      }
      const result = await this.walletMetadata.renameWallet({
        keyDomainId: walletId,
        displayName
      })
      if (result.status === 'storage-v2-inactive') throw new Error('Wallet not found')
      await this.notifyAccountSwitched()
      return result
    })
  }

  reset(): Promise<void> {
    return this.enqueue(async () => {
      await this.hydrateStores()
      const wallets = useWalletStore.getState().wallets
      await accountContextTransition.runActiveOperation(async () => {
        for (const wallet of wallets) {
          await syncScheduler.prepareWalletRemoval(wallet.id)
        }
        await credentialSession.lock()
        await resetWalletMetadata()
        await this.clearPendingMultichainTransfers()
        await Promise.all([
          transactionMonitor.clear(),
          zcashTxMonitor.clear(),
          dappHandler.clearConnections()
        ])
        await Promise.all([
          deleteIndexedDbTransactionPersistence(),
          deleteIndexedDbPortfolioCache(),
          deleteIndexedDbBitcoinDiscovery(),
          deleteIndexedDbBitcoinChangeReservations(),
          deleteIndexedDbBitcoinInputReservations(),
          deleteHistoryCache(),
          this.activityHistoryCache.clear(),
          dappExecutionModeCoordinator.clear(),
          chrome.storage.local.remove([
            getUserEvmAssetCatalogStorageKey('mainnet'),
            getUserEvmAssetCatalogStorageKey('testnet'),
            getDetectedEvmAssetCatalogStorageKey('mainnet'),
            getDetectedEvmAssetCatalogStorageKey('testnet'),
            getTokenVisibilityStorageKey('mainnet'),
            getTokenVisibilityStorageKey('testnet'),
            getLegacyEvmAssetVisibilityStorageKey('mainnet'),
            getLegacyEvmAssetVisibilityStorageKey('testnet'),
            USER_ASSET_DEX_POOL_CACHE_STORAGE_KEY,
            USER_ASSET_MARKET_CACHE_STORAGE_KEY,
            USER_ASSET_ONE_CLICK_PRICE_CACHE_STORAGE_KEY,
            DEFI_LLAMA_MARKET_CACHE_STORAGE_KEY,
            'coin_gecko_market_change_cache_v1',
            LENDING_MARKET_CACHE_STORAGE_KEY,
            SWAP_TOKEN_CATALOG_CACHE_STORAGE_KEY
          ])
        ])
        await backgroundZcashWalletRuntime.resetWalletDataAuthoritatively()
        await this.notifyAccountSwitched({ refreshPortfolio: false })
        await deleteStorageV2Persistence()
      })
    })
  }

  private async removeMultichainAccountData(walletId: string, accountId: string): Promise<void> {
    const scope = {
      keyDomainId: parseKeyDomainId(walletId),
      accountId: parseAccountId(accountId)
    }
    await Promise.all([
      this.bitcoinDiscovery.deleteByAccountScope(scope),
      this.bitcoinChangeReservations.deleteByAccountScope(scope),
      this.bitcoinInputReservations.deleteByAccountScope(scope),
      deleteHistoryCacheByAccountScope(scope),
      this.transactionRepository.deleteByAccountScope(scope),
      this.portfolioCache.deleteByAccountScope(scope),
      deleteLendingMarketCache(walletId, accountId),
      this.activityHistoryCache.deleteByScope(scope),
      dappExecutionModeCoordinator.removeAccount(walletId, accountId)
    ])
  }

  private async removeNativeStorageV2Wallet(
    walletId: string,
    previous: ActiveAccount
  ): Promise<void> {
    const pointer = await this.storageRepository.getActivePointer()
    const deletedAccountIds = await getWalletDeletionRecord(walletId)
    if (!pointer && !deletedAccountIds) throw new Error('Wallet not found')
    const snapshot = pointer ? await this.storageRepository.getSnapshot(pointer.generationId) : null
    if (pointer && !snapshot) throw new Error('Active Storage V2 generation is missing')
    const keyDomain = snapshot?.keyDomains.find(item => item.id === walletId)
    if (!keyDomain && !deletedAccountIds) throw new Error('Wallet not found')
    if (keyDomain && !isNativeStorageV2Wallet(keyDomain) && !deletedAccountIds) {
      throw new Error('Wallet metadata is not managed by the native Wallet inventory')
    }
    if (!deletedAccountIds && (snapshot?.keyDomains.length ?? 0) <= 1) {
      throw new Error('Cannot remove the last wallet. Use Reset Wallet instead.')
    }
    const accountIds =
      deletedAccountIds ??
      snapshot?.accounts
        .filter(account => account.keyDomainId === walletId)
        .map(account => account.id) ??
      []
    if (accountIds.length === 0) throw new Error('Wallet has no Accounts')
    const password = await credentialSession.getProvisioningPassword().catch(() => null)

    await accountContextTransition.runScopedMutation(
      accountIds.map(accountId => ({ walletId, accountId })),
      async () => {
        let committed = false
        try {
          await syncScheduler.prepareMetadataOnlyWalletRemoval(walletId)
          pendingRequestsManager.cancelContext(walletId)
          await commitWalletMetadataDeletion(walletId, accountIds)
          await this.credentialRemoval.removeWallet(walletId)
          committed = true
          const cleanup = await Promise.allSettled([
            transactionMonitor.removeAccount(walletId),
            zcashTxMonitor.removeAccount(walletId),
            dappHandler.removeAccountReferences(walletId),
            this.removePendingCrossChainAccount(walletId),
            ...accountIds.map(accountId => this.removeMultichainAccountData(walletId, accountId))
          ])
          const cleanupIncomplete = cleanup.some(result => result.status === 'rejected')
          await this.refreshCredentialSessionAfterWalletRemoval(password)
          if (deletedAccountIds) {
            await backgroundZcashWalletRuntime.removeWalletAuthoritatively(walletId, accountIds)
          }
          await this.resumeAfterMutation(previous, false)
          await this.notifyAccountSwitched()
          if (cleanupIncomplete)
            throw new Error('Wallet removal cleanup is incomplete; retry removal')
          await completeWalletMetadataDeletion(walletId)
        } catch (error) {
          if (!committed) await syncScheduler.cancelWalletRemoval(walletId)
          throw error
        }
      }
    )
  }
}
