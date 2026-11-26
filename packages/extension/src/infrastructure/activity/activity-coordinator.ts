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
  ConfidentialActivityService,
  type ConfidentialActivitySource
} from './confidential-activity-service'
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
  readonly confidentialHistory?: ConfidentialActivitySource
}

export interface ActivityReadOptions {
  readonly includeSupplemental?: boolean
  readonly accountMode?: 'main' | 'private' | 'all'
  readonly chainIds?: readonly string[]
  readonly historyPageCount?: number
  readonly protocolProvider?: 'Confidential Intents'
}

export class ActivityCoordinator {
  private readonly confidentialActivity: ConfidentialActivityService

  constructor(private readonly options: ActivityCoordinatorOptions) {
    this.confidentialActivity = new ConfidentialActivityService(
      {
        readScope: () => this.loadActiveScope(),
        readGraphs: async query =>
          this.projectLocalGraphs(query.scope, await options.transactionRepository.list(query))
      },
      options.confidentialHistory
    )
  }

  clearConfidentialHistory(): void {
    this.confidentialActivity.clear()
  }

  async readActive(options: ActivityReadOptions = {}): Promise<ActivityReadModel | null> {
    if (options.protocolProvider === 'Confidential Intents') {
      return this.confidentialActivity.readActive(options)
    }
    const scope = await this.loadActiveScope()
    if (!scope) return null
    const accountMode = options.accountMode ?? 'main'
    const [storedLocalGraphs, zcashTransactions, supplementalItems] = await Promise.all([
      this.options.transactionRepository.list({ scope, limit: 200 }),
      this.options.loadZcashTransactions(scope, options),
      this.loadSupplementalItems(scope, accountMode, options)
    ])
    const { localGraphs, privateExecutionAddresses } = await this.projectLocalGraphs(
      scope,
      storedLocalGraphs
    )
    const destinationReceipts = new Map<string, Transaction[]>()
    for (const transaction of zcashTransactions) {
      if (transaction.type !== 'receive') continue
      const hash = normalizeTxHash(transaction.txHash)
      if (!hash) continue
      destinationReceipts.set(hash, [...(destinationReceipts.get(hash) ?? []), transaction])
    }
    const hasMore = await this.options
      .loadSupplementalHasMore?.(scope, accountMode, options.chainIds)
      .catch(() => false)
    return buildActivityReadModel({
      scope,
      localGraphs,
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
        ...supplementalItems
      ]),
      privateExecutionAddresses,
      limit: 2_000,
      hasMore
    })
  }

  private async projectLocalGraphs(
    scope: ActivityScope,
    storedLocalGraphs: readonly TransactionGraph[]
  ) {
    const privateExecutionAddresses = await this.loadPrivateExecutionAddresses(
      scope,
      storedLocalGraphs
    )
    const localGraphs = this.options.filterLocalGraphs
      ? await this.options.filterLocalGraphs(scope, storedLocalGraphs, privateExecutionAddresses)
      : storedLocalGraphs
    return { storedLocalGraphs, localGraphs, privateExecutionAddresses }
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
