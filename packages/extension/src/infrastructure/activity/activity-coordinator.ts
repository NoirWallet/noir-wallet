import {
  buildActivityReadModel,
  type ActivityItem,
  type ActivityReadModel,
  type ActivityScope
} from '@/core/activity'
import type { TransactionGraph } from '@/core/transactions/domain'
import type { Transaction } from '@/types'
import type { StorageV2ReadRepository, TransactionRepository } from '@/ports/repositories'
import { mapZcashV1TransactionToActivityItem } from './zcash-v1-activity-source'

type ActivityStorageRepository = Pick<StorageV2ReadRepository, 'getActivePointer' | 'getSnapshot'>

export interface ActivityCoordinatorOptions {
  readonly storageRepository: ActivityStorageRepository
  readonly transactionRepository: TransactionRepository
  readonly loadZcashTransactions: (scope: ActivityScope) => Promise<readonly Transaction[]>
  readonly loadSupplementalItems?: (
    scope: ActivityScope,
    accountMode: 'main' | 'private' | 'all',
    chainIds?: readonly string[]
  ) => Promise<readonly ActivityItem[]>
  readonly loadCachedSupplementalItems?: (
    scope: ActivityScope,
    accountMode: 'main' | 'private' | 'all'
  ) => Promise<readonly ActivityItem[]>
  readonly loadPrivateExecutionAddresses?: (scope: ActivityScope) => Promise<readonly string[]>
  readonly filterLocalGraphs?: (
    scope: ActivityScope,
    graphs: readonly TransactionGraph[]
  ) => Promise<readonly TransactionGraph[]>
}

export interface ActivityReadOptions {
  readonly includeSupplemental?: boolean
  readonly accountMode?: 'main' | 'private' | 'all'
  readonly chainIds?: readonly string[]
}

export class ActivityCoordinator {
  constructor(private readonly options: ActivityCoordinatorOptions) {}

  async readActive(options: ActivityReadOptions = {}): Promise<ActivityReadModel | null> {
    const scope = await this.loadActiveScope()
    if (!scope) return null
    const accountMode = options.accountMode ?? 'main'
    const supplementalItemsPromise =
      options.includeSupplemental === false
        ? (this.options.loadCachedSupplementalItems?.(scope, accountMode) ??
          Promise.resolve(Object.freeze([])))
        : (this.options.loadSupplementalItems?.(scope, accountMode, options.chainIds) ??
          Promise.resolve(Object.freeze([])))
    const [storedLocalGraphs, zcashTransactions, supplementalItems, privateExecutionAddresses] =
      await Promise.all([
        this.options.transactionRepository.list({ scope, limit: 200 }),
        this.options.loadZcashTransactions(scope),
        supplementalItemsPromise,
        this.options.loadPrivateExecutionAddresses?.(scope) ?? Promise.resolve(Object.freeze([]))
      ])
    const localGraphs = this.options.filterLocalGraphs
      ? await this.options.filterLocalGraphs(scope, storedLocalGraphs)
      : storedLocalGraphs
    return buildActivityReadModel({
      scope,
      localGraphs: localGraphs as readonly TransactionGraph[],
      supplementalItems: Object.freeze([
        ...zcashTransactions.map(transaction =>
          mapZcashV1TransactionToActivityItem(transaction, scope)
        ),
        ...supplementalItems
      ]),
      privateExecutionAddresses,
      limit: 200
    })
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
