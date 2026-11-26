import { buildActivityReadModel, type ActivityReadModel, type ActivityScope } from '@/core/activity'
import type { EvmNetworkConfig } from '@/config/networks'
import type { AssetRegistry } from '@/core/chains/registry'
import type { Network } from '@/types'
import type { TransactionGraph } from '@/core/transactions/domain'
import type {
  ConfidentialFundingPlan,
  ConfidentialPortfolioAssetMapping,
  ExternalShieldDeposit
} from '@/core/services/confidential-funding'
import type { SwapToken } from '@/core/services/intents-api'
import { resolveManagedIntentsAssets } from '@/core/services/intents-managed-assets'
import type { TransactionListQuery } from '@/ports/repositories'
import {
  collectConfidentialHistoryOrderKeys,
  confidentialHistoryOrderKey,
  projectConfidentialHistoryEntry,
  type ConfidentialHistoryPage
} from '@/core/services/near-intents/confidential-history'
import { logDevelopmentError } from '@/lib/development-console'
import {
  ConfidentialFundingApiError,
  type ConfidentialFundingApi,
  type ConfidentialSession
} from '@/infrastructure/near-intents/confidential-funding-api'

const MAX_PAGES = 10
const LOCAL_PAGE_SIZE = 200

export interface ConfidentialActivitySource {
  readonly network: Network
  readonly canRead: () => Promise<boolean>
  readonly api: Pick<ConfidentialFundingApi, 'getHistory'>
  readonly readSession: (
    scope: ActivityScope,
    isCurrent: () => Promise<boolean>,
    rejectedAccessToken?: string
  ) => Promise<Pick<ConfidentialSession, 'accessToken'> | null>
  readonly assetCatalog: {
    readonly assets: Pick<AssetRegistry, 'get'>
    readonly assetMappings: readonly ConfidentialPortfolioAssetMapping[]
    readonly evmNetworks: readonly EvmNetworkConfig[]
    readonly getProtocolTokens: () => readonly SwapToken[]
  }
  readonly fundingStore: {
    getPlansForTransactions(
      ids: readonly string[]
    ): Promise<ReadonlyMap<string, ConfidentialFundingPlan>>
    listExternalDeposits(): Promise<readonly ExternalShieldDeposit[]>
  }
}

interface ConfidentialActivityLocalSource {
  readScope(): Promise<ActivityScope | null>
  readGraphs(query: TransactionListQuery): Promise<{
    storedLocalGraphs: readonly TransactionGraph[]
    localGraphs: readonly TransactionGraph[]
    privateExecutionAddresses: readonly string[]
  }>
}

interface ConfidentialActivityReadOptions {
  readonly includeSupplemental?: boolean
  readonly historyPageCount?: number
}

interface HistoryWindow {
  readonly pages: readonly ConfidentialHistoryPage[]
  readonly unavailable?: true
}

interface HistoryContext {
  readonly key: string
  window: HistoryWindow
  pending?: { pageCount?: number; promise: Promise<HistoryWindow> }
}

const EMPTY: HistoryWindow = { pages: [] }

export class ConfidentialActivityService {
  private context?: HistoryContext
  private generation = 0

  constructor(
    private readonly local: ConfidentialActivityLocalSource,
    private readonly source?: ConfidentialActivitySource
  ) {}

  clear(): void {
    this.generation += 1
    this.context = undefined
  }

  async readActive(options: ConfidentialActivityReadOptions): Promise<ActivityReadModel | null> {
    const generation = this.generation
    const pageCount = options.historyPageCount ?? 1
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
      throw new Error('Confidential Activity page count is invalid')
    }
    const scope = await this.local.readScope()
    if (!scope || generation !== this.generation) return null
    const { storedLocalGraphs, localGraphs, privateExecutionAddresses } =
      await this.local.readGraphs({
        scope,
        protocolProvider: 'Confidential Intents',
        limit: 10_000
      })
    const isActiveScope = async () => {
      if (generation !== this.generation) return false
      const active = await this.local.readScope()
      return (
        generation === this.generation &&
        active?.keyDomainId === scope.keyDomainId &&
        active.accountId === scope.accountId
      )
    }
    const source = this.source
    const isCurrent = async () => (await source?.canRead()) === true && (await isActiveScope())
    const history =
      source && (await isCurrent())
        ? await this.readHistory(source, scope, isCurrent, options)
        : undefined
    if (!(await (history ? isCurrent() : isActiveScope()))) return null
    const hasRemoteEntries = history?.pages.some(page => page.entries.length > 0)
    const remoteItems =
      source && history && hasRemoteEntries
        ? await this.projectHistory(source, scope, storedLocalGraphs, history)
        : []
    if (hasRemoteEntries && !(await isCurrent())) return null

    const localLimit = pageCount * LOCAL_PAGE_SIZE
    const model = buildActivityReadModel({
      scope,
      localGraphs: localGraphs.slice(0, localLimit),
      supplementalItems: remoteItems,
      privateExecutionAddresses,
      limit: Math.min(MAX_PAGES * LOCAL_PAGE_SIZE, localLimit + remoteItems.length),
      hasMore:
        (pageCount < MAX_PAGES && localGraphs.length > localLimit) ||
        Boolean(history?.pages.at(-1)?.prevCursor && history.pages.length < MAX_PAGES)
    })
    return history?.unavailable ? { ...model, confidentialHistoryUnavailable: true } : model
  }

  private async projectHistory(
    source: ConfidentialActivitySource,
    scope: ActivityScope,
    graphs: readonly TransactionGraph[],
    history: HistoryWindow
  ) {
    const ids = new Set<string>(graphs.map(graph => graph.root.id))
    const [plans, external] = await Promise.all([
      source.fundingStore.getPlansForTransactions([...ids]),
      [...ids].some(id => id.startsWith('tx:confidential-external:'))
        ? source.fundingStore.listExternalDeposits()
        : []
    ])
    const keys = collectConfidentialHistoryOrderKeys(graphs)
    const matchesScope = (record: { network: Network; keyDomainId: string; accountId: string }) =>
      record.network === source.network &&
      record.keyDomainId === scope.keyDomainId &&
      record.accountId === scope.accountId
    for (const plan of plans.values()) {
      if (!matchesScope(plan)) continue
      for (const quote of [plan.depositQuote?.quote, plan.swapQuote?.quote]) {
        if (quote?.depositAddress) {
          keys.add(confidentialHistoryOrderKey(quote.depositAddress, quote.depositMemo))
        }
      }
      for (const row of plan.withdraws) {
        if (row.depositAddress) {
          keys.add(confidentialHistoryOrderKey(row.depositAddress, row.oneClickOrder?.depositMemo))
        }
      }
    }
    for (const record of external) {
      if (ids.has(record.transactionId) && matchesScope(record)) {
        keys.add(confidentialHistoryOrderKey(record.depositAddress, record.depositMemo))
      }
    }
    const assets = this.resolveHistoryAssets(source)
    return history.pages.flatMap(page =>
      page.entries.flatMap(entry => {
        if (keys.has(entry.key)) return []
        keys.add(entry.key)
        return [projectConfidentialHistoryEntry(entry, scope, assets)]
      })
    )
  }

  private resolveHistoryAssets({ network, assetCatalog }: ConfidentialActivitySource) {
    const assets = new Map<string, { assetId: string; decimals: number }>()
    const { assetMappings, evmNetworks, getProtocolTokens } = assetCatalog
    const tokens = getProtocolTokens()
    try {
      for (const asset of resolveManagedIntentsAssets(tokens, network, evmNetworks)) {
        assets.set(asset.protocolAssetId, asset)
      }
    } catch (error) {
      logDevelopmentError('[Confidential Activity] History asset catalog unavailable', error)
    }
    for (const { assetId, protocolAssetId } of assetMappings) {
      const asset = assetCatalog.assets.get(assetId)
      if (asset) assets.set(protocolAssetId, { assetId, decimals: asset.metadata.decimals })
    }
    return assets
  }

  private async readPage(
    source: ConfidentialActivitySource,
    scope: ActivityScope,
    prevCursor: string | undefined,
    isCurrent: () => Promise<boolean>
  ): Promise<ConfidentialHistoryPage | null> {
    let rejectedAccessToken: string | undefined
    for (const retry of [false, true]) {
      if (!(await isCurrent())) return null
      const session = await source.readSession(scope, isCurrent, rejectedAccessToken)
      if (!session || !(await isCurrent())) return null
      try {
        return await source.api.getHistory(session.accessToken, prevCursor)
      } catch (error) {
        if (!(error instanceof ConfidentialFundingApiError)) throw error
        if (error.status === 403) return null
        if (error.status !== 401) throw error
        if (retry) return null
        rejectedAccessToken = session.accessToken
      }
    }
    return null
  }

  private async readHistory(
    source: ConfidentialActivitySource,
    scope: ActivityScope,
    isActiveScope: () => Promise<boolean>,
    options: ConfidentialActivityReadOptions
  ): Promise<HistoryWindow> {
    const pageCount = options.historyPageCount
    const key = JSON.stringify([source.network, scope.keyDomainId, scope.accountId])
    if (this.context?.key !== key) this.context = { key, window: EMPTY }
    const context = this.context
    if (options.includeSupplemental === false) return context.window
    while (context.pending) {
      if (context.pending.pageCount === pageCount) return context.pending.promise
      await context.pending.promise.catch(() => {})
      if (this.context !== context) return EMPTY
    }
    const existing = context.window
    const extend = pageCount !== undefined && existing.pages.length > 0
    if (extend && existing.pages.length >= pageCount) return existing
    const target = pageCount ?? Math.max(1, existing.pages.length)
    const isCurrent = async () =>
      this.context === context && (await isActiveScope()) && this.context === context
    const promise = this.refresh(source, scope, context, isCurrent, target, extend).finally(() => {
      context.pending = undefined
    })
    context.pending = { pageCount, promise }
    return promise
  }

  private async refresh(
    source: ConfidentialActivitySource,
    scope: ActivityScope,
    context: HistoryContext,
    isCurrent: () => Promise<boolean>,
    target: number,
    extend: boolean
  ): Promise<HistoryWindow> {
    const existing = context.window
    const pages = extend ? [...existing.pages] : []
    const requestedCursors = new Set<string>()
    for (const page of pages.slice(0, -1)) {
      if (page.prevCursor) requestedCursors.add(page.prevCursor)
    }
    try {
      while (pages.length < target) {
        const prevCursor = pages.at(-1)?.prevCursor
        if (pages.length && (!prevCursor || requestedCursors.has(prevCursor))) break
        if (prevCursor) requestedCursors.add(prevCursor)
        const page = await this.readPage(source, scope, prevCursor, isCurrent)
        if (!(await isCurrent())) return EMPTY
        if (!page) {
          context.window = EMPTY
          return context.window
        }
        pages.push(
          page.prevCursor && requestedCursors.has(page.prevCursor)
            ? { entries: page.entries }
            : page
        )
      }
      context.window = { pages }
    } catch {
      if (!(await isCurrent())) return EMPTY
      if (extend) throw new Error('Could not load older Confidential activity')
      context.window = { ...existing, unavailable: true }
    }
    return context.window
  }
}
