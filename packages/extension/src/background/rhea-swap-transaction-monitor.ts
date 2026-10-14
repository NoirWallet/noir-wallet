import type { RheaSwapService } from '@/core/services/rhea-swap'
import type { SwapStatus } from '@/core/services/intents-api'
import {
  parseTransactionEventId,
  type TransactionAccountScope,
  type TransactionGraph,
  type TransactionLifecycleStatus,
  type TransactionSegment,
  type TransactionSegmentEvent
} from '@/core/transactions/domain'
import {
  IndexedDbStorageV2Repository,
  IndexedDbTransactionRepository
} from '@/infrastructure/persistence/repositories'
import type { TransactionRepository } from '@/ports/repositories'
import { loadTransactions } from '@/lib/indexed-db'
import { getCrossChainCompletionStatus } from '@/lib/cross-chain-transaction'
import { transactionRecorder } from './transaction-recorder'
import { parseAssetId } from '@/core/chains/registry'
import { parseAccountId } from '@/core/accounts/domain'
import { parseKeyDomainId } from '@/core/keyring/domain'
import { getRheaSwapProgressStatus } from '@/lib/swap-progress'

export const RHEA_SWAP_TRANSACTION_MONITOR_ALARM = 'rhea-swap-transaction-monitor-alarm'

const STORAGE_KEY = 'rhea_swap_pending_transactions'
const POLL_DELAY_MINUTES = 0.5

export interface PendingRheaSwapTransaction {
  readonly quoteHandle: string
  readonly accountKey: string
  readonly walletId: TransactionAccountScope['keyDomainId']
  readonly accountId: TransactionAccountScope['accountId']
  readonly transactionId: string
  readonly isCrossChain: boolean
  readonly destinationAsset?: string
  readonly destinationChain?: string
}

export interface RheaSwapPortfolioRefreshRequest {
  readonly scope: TransactionAccountScope
  readonly chainIds: readonly string[]
}

export interface RheaSwapTransactionMonitorOptions {
  readonly refreshPortfolio?: (request: RheaSwapPortfolioRefreshRequest) => Promise<void>
  readonly notifyStatus?: (quoteHandle: string, status: SwapStatus) => void
}

function parsePending(value: unknown): PendingRheaSwapTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid pending RHEA Swap transaction')
  }
  const record = value as Record<string, unknown>
  const required = [
    'quoteHandle',
    'accountKey',
    'walletId',
    'accountId',
    'transactionId',
    'isCrossChain'
  ]
  const optional = ['destinationAsset', 'destinationChain']
  const allowed = new Set([...required, ...optional])
  if (
    required.some(key => !Object.prototype.hasOwnProperty.call(record, key)) ||
    Object.keys(record).some(key => !allowed.has(key)) ||
    typeof record.isCrossChain !== 'boolean'
  ) {
    throw new Error('Invalid pending RHEA Swap transaction fields')
  }
  const read = (key: string, maximum = 512): string => {
    const candidate = record[key]
    if (
      typeof candidate !== 'string' ||
      candidate.length === 0 ||
      candidate.length > maximum ||
      candidate.trim() !== candidate ||
      /[\u0000-\u001f\u007f-\u009f]/.test(candidate)
    ) {
      throw new Error(`Invalid pending RHEA Swap ${key}`)
    }
    return candidate
  }
  return Object.freeze({
    quoteHandle: read('quoteHandle', 160),
    accountKey: read('accountKey'),
    walletId: parseKeyDomainId(read('walletId')),
    accountId: parseAccountId(read('accountId')),
    transactionId: read('transactionId'),
    isCrossChain: record.isCrossChain,
    ...(record.destinationAsset === undefined
      ? {}
      : { destinationAsset: parseAssetId(read('destinationAsset')).id }),
    ...(record.destinationChain === undefined
      ? {}
      : { destinationChain: read('destinationChain', 64) })
  })
}

export class RheaSwapTransactionMonitor {
  private readonly pending = new Map<string, PendingRheaSwapTransaction>()
  private readonly repository: TransactionRepository = new IndexedDbTransactionRepository()
  private readonly storageRepository = new IndexedDbStorageV2Repository()

  constructor(
    private readonly service: RheaSwapService,
    private readonly options: RheaSwapTransactionMonitorOptions = {}
  ) {}

  async init(): Promise<void> {
    await this.load()
    const graphPending = await this.pollGraphs()
    this.schedule(graphPending)
  }

  async add(value: unknown): Promise<void> {
    const transaction = parsePending(value)
    this.pending.set(transaction.quoteHandle, transaction)
    await this.save()
    this.schedule(false)
  }

  async handleAlarm(): Promise<void> {
    await this.load()
    await Promise.allSettled([...this.pending.values()].map(value => this.check(value)))
    const graphPending = await this.pollGraphs()
    this.schedule(graphPending)
  }

  async recheckNow(): Promise<boolean> {
    await this.load()
    await Promise.allSettled([...this.pending.values()].map(value => this.check(value)))
    const graphPending = await this.pollGraphs()
    this.schedule(graphPending)
    return this.pending.size > 0 || graphPending
  }

  async removeAccount(walletId: string, accountId?: string): Promise<void> {
    await this.load()
    for (const [quoteHandle, value] of this.pending) {
      if (
        value.walletId === walletId &&
        (accountId === undefined || value.accountId === accountId)
      ) {
        this.pending.delete(quoteHandle)
      }
    }
    await this.save()
    this.schedule(false)
  }

  async clear(): Promise<void> {
    this.pending.clear()
    await this.save()
    this.schedule(false)
  }

  private async check(value: PendingRheaSwapTransaction): Promise<void> {
    try {
      await this.service.reportSubmission(value.quoteHandle)
    } catch {
      if (!value.isCrossChain) return
    }

    let status:
      | 'pending'
      | 'processing'
      | 'completed'
      | 'failed'
      | 'refunded'
      | 'expired'
      | 'unknown'
    let destinationHash: string | null = null
    try {
      const observation = await this.service.getOrderStatus(value.quoteHandle)
      status = observation.status
      destinationHash = observation.destinationHash
    } catch (error) {
      if (value.isCrossChain) return
      const transactions = await loadTransactions(value.accountKey)
      const transaction = transactions.find(candidate => candidate.id === value.transactionId)
      if (!transaction?.confirmations || transaction.confirmations <= 0) return
      status = 'completed'
    }

    if (status === 'pending' || status === 'processing' || status === 'unknown') {
      if (destinationHash) {
        await transactionRecorder.updateTransaction(value.accountKey, value.transactionId, {
          destinationTxHash: destinationHash
        })
      }
      return
    }
    if (status === 'completed') {
      await transactionRecorder.updateTransaction(value.accountKey, value.transactionId, {
        status: getCrossChainCompletionStatus('swap', value),
        ...(destinationHash ? { destinationTxHash: destinationHash } : {}),
        notified: true
      })
      await this.refreshPortfolio(
        { keyDomainId: value.walletId, accountId: value.accountId },
        value.destinationAsset ? [parseAssetId(value.destinationAsset).chainId] : []
      )
    } else {
      await transactionRecorder.updateTransaction(value.accountKey, value.transactionId, {
        status: 'failed',
        ...(destinationHash ? { destinationTxHash: destinationHash } : {}),
        memo: status === 'refunded' ? 'Refunded' : undefined,
        notified: true
      })
    }
    await this.service.discard(value.quoteHandle).catch(() => {})
    this.pending.delete(value.quoteHandle)
    await this.save()
  }

  private async load(): Promise<void> {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
    if (stored === undefined) return
    if (!Array.isArray(stored) || stored.length > 128) {
      throw new Error('Invalid persisted RHEA Swap monitor state')
    }
    this.pending.clear()
    for (const value of stored) {
      const parsed = parsePending(value)
      this.pending.set(parsed.quoteHandle, parsed)
    }
  }

  private async save(): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEY]: [...this.pending.values()] })
  }

  private async pollGraphs(): Promise<boolean> {
    const scopes = await this.loadPersistedScopes()
    const graphs = (
      await Promise.all(
        scopes.map(scope =>
          this.repository.list({ scope, statuses: ['broadcast', 'confirming'], limit: 200 })
        )
      )
    ).flat()
    const work = graphs.filter(
      graph => graph.root.intent?.protocol?.provider === 'rhea-cross-chain-dex'
    )
    if (work.length === 0) return false
    const results = await Promise.allSettled(work.map(graph => this.checkGraph(graph)))
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return
      const binding = work[index]?.root.intent?.protocol
      console.warn('[RHEA Swap Monitor] Graph poll failed', {
        quoteHandle: binding?.provider === 'rhea-cross-chain-dex' ? binding.quoteHandle : 'unknown',
        errorName: result.reason instanceof Error ? result.reason.name : 'UnknownError',
        errorMessage:
          result.reason instanceof Error ? result.reason.message : 'RHEA Swap graph poll failed'
      })
    })
    return results.some(
      result => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value)
    )
  }

  private async loadPersistedScopes(): Promise<readonly TransactionAccountScope[]> {
    const pointer = await this.storageRepository.getActivePointer()
    if (!pointer) return Object.freeze([])
    const snapshot = await this.storageRepository.getSnapshot(pointer.generationId)
    if (
      !snapshot ||
      snapshot.manifest.status !== 'verified' ||
      snapshot.manifest.generationId !== pointer.generationId ||
      snapshot.manifest.sourceFingerprint !== pointer.sourceFingerprint
    ) {
      throw new Error('Active Storage V2 generation is invalid')
    }
    const scopes = new Map<string, TransactionAccountScope>()
    for (const chainAccount of snapshot.chainAccounts) {
      const scope = Object.freeze({
        keyDomainId: chainAccount.scope.keyDomainId,
        accountId: chainAccount.scope.accountId
      })
      scopes.set(JSON.stringify([scope.keyDomainId, scope.accountId]), scope)
    }
    return Object.freeze([...scopes.values()])
  }

  private async checkGraph(graph: TransactionGraph): Promise<boolean> {
    const binding = graph.root.intent?.protocol
    if (!binding || binding.provider !== 'rhea-cross-chain-dex') return true
    const origins = graph.segments.filter(segment => segment.role === 'origin')
    if (origins.length === 0) return false
    const pendingOnchainOrigin = origins.some(
      origin =>
        origin.target.kind === 'onchain' &&
        origin.status !== 'broadcast' &&
        origin.status !== 'confirming' &&
        origin.status !== 'final'
    )
    if (pendingOnchainOrigin) return false
    const sourceHashes = origins
      .map(origin => origin.evidence?.transactionHash)
      .filter((value): value is string => value !== undefined)
    const sourceHash = sourceHashes.at(-1)
    const orderReference = origins.at(-1)?.evidence?.externalReference
    if (!sourceHash && !orderReference) return false
    if (sourceHash) {
      await this.service.recordTransactionSubmission(binding.quoteHandle, sourceHash)
    }
    try {
      await this.service.reportSubmission(binding.quoteHandle)
    } catch (error) {
      if (!binding.isCrossChain) throw error
    }

    if (!binding.isCrossChain) {
      if (origins.some(origin => origin.target.kind === 'onchain' && origin.status !== 'final')) {
        return false
      }
      await this.applyGraphSegment(graph.root.scope, graph.root.id, 'relay', 'final', {
        externalReference: binding.quoteHandle
      })
      await this.applyGraphSegment(graph.root.scope, graph.root.id, 'destination', 'final', {
        ...(sourceHash === undefined
          ? { externalReference: orderReference }
          : { transactionHash: sourceHash })
      })
      await this.refreshPortfolio(graph.root.scope, [
        binding.origin.chainId,
        binding.destination.chainId
      ])
      await this.notifyStatus(graph, 'SUCCESS')
      await this.service.discard(binding.quoteHandle).catch(() => {})
      return true
    }

    console.info('[RHEA Swap Monitor] Polling order status', {
      quoteHandle: binding.quoteHandle,
      transactionId: graph.root.id
    })
    const orderStatus = await this.service.getOrderStatus(binding.quoteHandle)
    const status = orderStatus.status
    console.info('[RHEA Swap Monitor] Order status received', {
      quoteHandle: binding.quoteHandle,
      status
    })
    if (orderStatus.destinationHash) {
      const destination = graph.segments.find(segment => segment.role === 'destination')
      if (destination && !destination.evidence?.transactionHash) {
        await this.applyGraphSegment(
          graph.root.scope,
          graph.root.id,
          'destination',
          destination.status === 'confirming' ? 'confirming' : 'broadcast',
          { transactionHash: orderStatus.destinationHash }
        )
      }
    }
    if (status === 'pending' || status === 'unknown') return false
    if (status === 'processing') {
      await this.applyGraphSegment(graph.root.scope, graph.root.id, 'relay', 'confirming', {
        externalReference: binding.quoteHandle
      })
      await this.notifyStatus(graph, 'PROCESSING')
      return false
    }
    if (status === 'completed') {
      await this.applyGraphSegment(graph.root.scope, graph.root.id, 'relay', 'final', {
        externalReference: binding.quoteHandle
      })
      await this.applyGraphSegment(graph.root.scope, graph.root.id, 'destination', 'final', {
        externalReference: binding.executionId,
        ...(orderStatus.destinationHash ? { transactionHash: orderStatus.destinationHash } : {})
      })
      await this.refreshPortfolio(graph.root.scope, [
        binding.origin.chainId,
        binding.destination.chainId
      ])
      await this.notifyStatus(graph, 'SUCCESS')
      await this.service.discard(binding.quoteHandle).catch(() => {})
      return true
    }
    if (status === 'refunded') {
      await this.applyGraphSegment(graph.root.scope, graph.root.id, 'refund', 'final', {
        externalReference: binding.quoteHandle
      })
    }
    await this.applyGraphSegment(graph.root.scope, graph.root.id, 'relay', 'failed', undefined, {
      code: status === 'refunded' ? 'refunded' : status === 'expired' ? 'expired' : 'relay-failed',
      occurredAt: Date.now()
    })
    await this.notifyStatus(graph, status === 'refunded' ? 'REFUNDED' : 'FAILED')
    await this.service.discard(binding.quoteHandle).catch(() => {})
    return true
  }

  private async notifyStatus(graph: TransactionGraph, status: SwapStatus['status']): Promise<void> {
    const latest = await this.repository.get(graph.root.scope, graph.root.id)
    const binding = latest?.root.intent?.protocol
    if (!latest || binding?.provider !== 'rhea-cross-chain-dex') return
    const value = getRheaSwapProgressStatus(latest.segments, {
      status,
      originAsset: binding.origin.assetId,
      destinationAsset: binding.destination.assetId
    })
    if (this.options.notifyStatus) {
      this.options.notifyStatus(binding.quoteHandle, value)
      return
    }
    void chrome.runtime
      .sendMessage({
        type: 'CROSS_CHAIN_STATUS_UPDATED',
        quoteHandle: binding.quoteHandle,
        status: value
      })
      .catch(() => {})
  }

  private async applyGraphSegment(
    scope: TransactionAccountScope,
    transactionId: TransactionGraph['root']['id'],
    role: TransactionSegment['role'],
    status: TransactionLifecycleStatus,
    evidence?: TransactionSegmentEvent['evidence'],
    failure?: TransactionSegmentEvent['failure']
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const graph = await this.repository.get(scope, transactionId)
      const segment = graph?.segments.find(candidate => candidate.role === role)
      if (!graph || !segment || segment.status === 'final' || segment.status === 'failed') {
        return false
      }
      const observedAt = Date.now()
      const result = await this.repository.applySegmentEvent({
        scope,
        transactionId,
        segmentId: segment.id,
        event: Object.freeze({
          id: parseTransactionEventId(`event:rhea-swap:${crypto.randomUUID()}`),
          status,
          cause: status === 'failed' ? 'failure' : 'progress',
          observedAt,
          ...(evidence === undefined ? {} : { evidence }),
          ...(failure === undefined ? {} : { failure })
        }),
        expectedRootRevision: graph.root.revision,
        expectedSegmentRevision: segment.revision
      })
      if (result.status === 'applied') return true
      if (
        result.status === 'duplicate-event' ||
        result.status === 'ignored-stale' ||
        result.status === 'not-found'
      ) {
        return false
      }
      if (result.status !== 'revision-conflict') {
        throw new Error('RHEA Swap monitor could not persist its observation')
      }
    }
    return false
  }

  private async refreshPortfolio(
    scope: TransactionAccountScope,
    chainIds: readonly string[]
  ): Promise<void> {
    if (!this.options.refreshPortfolio || chainIds.length === 0) return
    try {
      await this.options.refreshPortfolio({
        scope,
        chainIds: Object.freeze([...new Set(chainIds)])
      })
    } catch (error) {
      console.warn('[RHEA Swap Monitor] Portfolio refresh after completion failed:', error)
    }
  }

  private schedule(graphPending: boolean): void {
    if (this.pending.size === 0 && !graphPending) {
      void chrome.alarms.clear(RHEA_SWAP_TRANSACTION_MONITOR_ALARM)
      return
    }
    chrome.alarms.create(RHEA_SWAP_TRANSACTION_MONITOR_ALARM, {
      delayInMinutes: POLL_DELAY_MINUTES
    })
  }
}
