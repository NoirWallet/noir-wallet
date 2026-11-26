import {
  buildActivityReadModel,
  type ActivityItem,
  type ActivityReadModel,
  type ActivityScope
} from '@/core/activity'
import type { TransactionGraph } from '@/core/transactions/domain'
import type { Transaction } from '@/types'
import type { StorageV2ReadRepository, TransactionRepository } from '@/ports/repositories'
import { normalizeTxHash } from '@/lib/tx-history-dedup'
import {
  collectConfidentialHistoryOrderKeys,
  projectConfidentialHistoryEntry,
  type ConfidentialHistoryPage
} from '@/core/services/near-intents/confidential-history'
import { ConfidentialHistoryCache } from './confidential-history-cache'
import {
  mapZcashSelfTransferReceipt,
  mapZcashV1TransactionToActivityItem
} from './zcash-v1-activity-source'

type ActivityStorageRepository = Pick<StorageV2ReadRepository, 'getActivePointer' | 'getSnapshot'>

export interface ActivityCoordinatorOptions {
  readonly storageRepository: ActivityStorageRepository
  readonly transactionRepository: TransactionRepository
  readonly loadZcashTransactions: (
    scope: ActivityScope,
    options: ActivityReadOptions
  ) => Promise<readonly Transaction[]>
  readonly loadSupplementalItems?: (
    scope: ActivityScope,
    accountMode: 'main' | 'private' | 'all',
    chainIds?: readonly string[],
    historyPageCount?: number
  ) => Promise<readonly ActivityItem[]>
  readonly loadSupplementalHasMore?: (
    scope: ActivityScope,
    accountMode: 'main' | 'private' | 'all',
    chainIds?: readonly string[]
  ) => Promise<boolean>
  readonly loadCachedSupplementalItems?: (
    scope: ActivityScope,
    accountMode: 'main' | 'private' | 'all'
  ) => Promise<readonly ActivityItem[]>
  readonly loadPrivateExecutionAddresses?: (
    scope: ActivityScope,
    localGraphs: readonly TransactionGraph[]
  ) => Promise<readonly string[]>
  readonly filterLocalGraphs?: (
    scope: ActivityScope,
    graphs: readonly TransactionGraph[],
    privateExecutionAddresses: readonly string[]
  ) => Promise<readonly TransactionGraph[]>
  readonly confidentialHistory?: {
    readonly canRead: () => Promise<boolean>
    readonly readPage: (
      scope: ActivityScope,
      prevCursor: string | undefined,
      isCurrent: () => Promise<boolean>
    ) => Promise<ConfidentialHistoryPage | null>
    readonly loadOrderKeys: (
      scope: ActivityScope,
      graphs: readonly TransactionGraph[]
    ) => Promise<ReadonlySet<string>>
    readonly getAssets: () => Parameters<typeof projectConfidentialHistoryEntry>[2]
  }
}

export interface ActivityReadOptions {
  readonly includeSupplemental?: boolean
  readonly accountMode?: 'main' | 'private' | 'all'
  readonly chainIds?: readonly string[]
  readonly historyPageCount?: number
  readonly protocolProvider?: 'Confidential Intents'
}

export class ActivityCoordinator {
  private readonly confidentialHistory?: ConfidentialHistoryCache
  private confidentialHistoryGeneration = 0

  constructor(private readonly options: ActivityCoordinatorOptions) {
    if (options.confidentialHistory) {
      this.confidentialHistory = new ConfidentialHistoryCache(options.confidentialHistory.readPage)
    }
  }

  clearConfidentialHistory(): void {
    this.confidentialHistoryGeneration += 1
    this.confidentialHistory?.clear()
  }

  async readActive(options: ActivityReadOptions = {}): Promise<ActivityReadModel | null> {
    const generation = this.confidentialHistoryGeneration
    const scope = await this.loadActiveScope()
    if (!scope) return null
    const accountMode = options.accountMode ?? 'main'
    const confidentialPageCount = options.historyPageCount ?? 1
    if (
      options.protocolProvider &&
      (!Number.isSafeInteger(confidentialPageCount) ||
        confidentialPageCount < 1 ||
        confidentialPageCount > 10)
    ) {
      throw new Error('Confidential Activity page count is invalid')
    }
    const confidentialLimit = confidentialPageCount * 200
    const [storedLocalGraphs, zcashTransactions, supplementalItems] = await Promise.all([
      this.options.transactionRepository.list({
        scope,
        limit: options.protocolProvider ? 10_000 : 200,
        ...(options.protocolProvider ? { protocolProvider: options.protocolProvider } : {})
      }),
      options.protocolProvider
        ? Promise.resolve([])
        : this.options.loadZcashTransactions(scope, options),
      options.protocolProvider
        ? Promise.resolve([])
        : this.loadSupplementalItems(scope, accountMode, options)
    ])
    const privateExecutionAddresses = await this.loadPrivateExecutionAddresses(
      scope,
      storedLocalGraphs
    )
    const localGraphs = this.options.filterLocalGraphs
      ? await this.options.filterLocalGraphs(scope, storedLocalGraphs, privateExecutionAddresses)
      : storedLocalGraphs
    const provider = options.protocolProvider ? this.options.confidentialHistory : undefined
    const isCurrent = async () => {
      if (generation !== this.confidentialHistoryGeneration) return false
      const active = await this.loadActiveScope()
      return (
        active?.keyDomainId === scope.keyDomainId &&
        active.accountId === scope.accountId &&
        (await provider?.canRead()) === true &&
        generation === this.confidentialHistoryGeneration
      )
    }
    let remoteItems: readonly ActivityItem[] = []
    let remoteHasMore = false
    let remoteUnavailable = false
    if (provider && (await isCurrent())) {
      const history = await this.confidentialHistory?.read(
        scope,
        isCurrent,
        options.includeSupplemental !== false,
        options.historyPageCount
      )
      if (!(await isCurrent())) return null
      if (history) {
        if (history.pages.some(page => page.entries.length > 0)) {
          const keys = collectConfidentialHistoryOrderKeys(storedLocalGraphs)
          for (const key of await provider.loadOrderKeys(scope, storedLocalGraphs)) keys.add(key)
          const assets = provider.getAssets()
          remoteItems = history.pages.flatMap(page =>
            page.entries.flatMap(entry => {
              if (keys.has(entry.key)) return []
              keys.add(entry.key)
              return [projectConfidentialHistoryEntry(entry, scope, assets)]
            })
          )
          if (!(await isCurrent())) return null
        }
        remoteHasMore = !!history.pages.at(-1)?.prevCursor && history.pages.length < 10
        remoteUnavailable = history.unavailable === true
      }
    }
    const destinationReceipts = new Map<string, Transaction[]>()
    for (const transaction of zcashTransactions) {
      if (transaction.type !== 'receive') continue
      const hash = normalizeTxHash(transaction.txHash)
      if (!hash) continue
      destinationReceipts.set(hash, [...(destinationReceipts.get(hash) ?? []), transaction])
    }
    const hasMore = options.protocolProvider
      ? remoteHasMore || (confidentialPageCount < 10 && localGraphs.length > confidentialLimit)
      : await this.options
          .loadSupplementalHasMore?.(scope, accountMode, options.chainIds)
          .catch(() => false)
    const model = buildActivityReadModel({
      scope,
      localGraphs: options.protocolProvider ? localGraphs.slice(0, confidentialLimit) : localGraphs,
      supplementalItems: Object.freeze([
        ...zcashTransactions.flatMap(transaction => {
          const matchingReceipts = destinationReceipts
            .get(normalizeTxHash(transaction.destinationTxHash))
            ?.filter(
              receipt =>
                receipt.network === transaction.network &&
                receipt.fromType === 'transparent' &&
                receipt.to === transaction.quoteBinding?.recipient &&
                (receipt.confirmations ?? 0) > 0
            )
          const item = mapZcashV1TransactionToActivityItem(
            transaction,
            scope,
            matchingReceipts?.length === 1 ? matchingReceipts[0] : undefined
          )
          const receipt = mapZcashSelfTransferReceipt(transaction, item)
          if (!receipt) return [item]
          const destinationPool = transaction.type === 'unshield' ? 'transparent' : 'shielded'
          const observedReceipt = destinationReceipts
            .get(normalizeTxHash(transaction.txHash))
            ?.some(
              observation =>
                observation.network === transaction.network &&
                observation.fromType === destinationPool &&
                observation.amount === (transaction.settledSelfTransferAmount ?? transaction.amount)
            )
          return observedReceipt ? [item] : [item, receipt]
        }),
        ...supplementalItems,
        ...remoteItems
      ]),
      privateExecutionAddresses,
      limit: options.protocolProvider
        ? Math.min(2_000, confidentialLimit + remoteItems.length)
        : 2_000,
      hasMore
    })
    return remoteUnavailable ? { ...model, confidentialHistoryUnavailable: true } : model
  }

  private async loadSupplementalItems(
    scope: ActivityScope,
    accountMode: 'main' | 'private' | 'all',
    options: ActivityReadOptions
  ): Promise<readonly ActivityItem[]> {
    if (options.includeSupplemental !== false && this.options.loadSupplementalItems) {
      try {
        return await this.options.loadSupplementalItems(
          scope,
          accountMode,
          options.chainIds,
          options.historyPageCount
        )
      } catch (error) {
        if ((options.historyPageCount ?? 1) > 1) throw error
        console.warn(
          '[Activity] Supplemental refresh failed:',
          error instanceof Error ? error.name : 'UnknownError'
        )
      }
    }
    try {
      return (await this.options.loadCachedSupplementalItems?.(scope, accountMode)) ?? []
    } catch (error) {
      console.warn(
        '[Activity] Supplemental cache read failed:',
        error instanceof Error ? error.name : 'UnknownError'
      )
      return []
    }
  }

  private async loadPrivateExecutionAddresses(
    scope: ActivityScope,
    localGraphs: readonly TransactionGraph[]
  ): Promise<readonly string[]> {
    try {
      return (await this.options.loadPrivateExecutionAddresses?.(scope, localGraphs)) ?? []
    } catch (error) {
      // Optional address classification must not prevent reading persisted transactions.
      console.warn(
        '[Activity] Private address lookup failed:',
        error instanceof Error ? error.name : 'UnknownError'
      )
      return []
    }
  }

  private async loadActiveScope(): Promise<ActivityScope | null> {
    const pointer = await this.options.storageRepository.getActivePointer()
    if (!pointer) return null
    const snapshot = await this.options.storageRepository.getSnapshot(pointer.generationId)
    if (!snapshot) throw new Error('Active Storage V2 generation is missing')
    if (
      snapshot.manifest.status !== 'verified' ||
      snapshot.manifest.generationId !== pointer.generationId ||
      snapshot.manifest.sourceFingerprint !== pointer.sourceFingerprint
    ) {
      throw new Error('Active Storage V2 generation does not match its pointer')
    }
    const active = snapshot.manifest.activeAccount
    if (!active) return null
    return Object.freeze({
      keyDomainId: active.keyDomainId,
      accountId: active.accountId
    })
  }
}
