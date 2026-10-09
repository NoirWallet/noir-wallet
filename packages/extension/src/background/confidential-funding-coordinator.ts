import type { Network } from '@/types'
import type { PortfolioReadModel } from '@/core/portfolio'
import type { ChainId } from '@/core/chains/domain'
import { parseAccountId } from '@/core/accounts/domain'
import { parseKeyDomainId } from '@/core/keyring/domain'
import type { AssetRegistry } from '@/core/chains/registry'
import { parseAssetId, parseChainId } from '@/core/chains/registry'
import {
  CONFIDENTIAL_WITHDRAW_DEFAULT_COUNT,
  aggregateConfidentialSettlement,
  assertConfidentialIntentBinding,
  assertConfidentialQuoteBinding,
  createConfidentialFundingGraph,
  fingerprintConfidentialValue,
  mergeConfidentialBalancesIntoPortfolio,
  mergeConfidentialWithdrawObservation,
  normalizeConfidentialWithdrawRequest,
  splitConfidentialFundingAmount,
  type ConfidentialFundingPlan,
  type ConfidentialFundingReview,
  type ConfidentialPortfolioAssetMapping,
  type ConfidentialQuote,
  type ConfidentialWithdrawRequest,
  type ConfidentialWithdrawRow
} from '@/core/services/confidential-funding'
import {
  parseTransactionEventId,
  parseTransactionId,
  parseTransactionSegmentId,
  type TransactionSegmentEvidence,
  type TransactionFailureCode,
  type TransactionLifecycleStatus
} from '@/core/transactions/domain'
import type { TransactionRepository } from '@/ports/repositories'
import {
  buildEvmTransfer,
  broadcastSignedEvmTransaction,
  createConfiguredEvmRpcClient,
  createEvmTransactionSegmentEvent,
  observeEvmTransaction,
  parsePreparedEvmTransfer,
  type EvmBroadcastRpc,
  type EvmTransactionRpc
} from '@/infrastructure/chains/evm'
import type { EvmNetworkConfig } from '@/config/networks'
import type { NetworkFeeTier } from '@/core/transactions/domain'
import { ConfidentialFundingApi, ConfidentialFundingApiError } from './confidential-funding-api'
import {
  ConfidentialFundingSigner,
  type ConfidentialSigningIdentity
} from './confidential-funding-signer'
import { ChromeConfidentialFundingStore } from './confidential-funding-store'

const SESSION_REFRESH_BUFFER_MS = 60_000
export const CONFIDENTIAL_FUNDING_MONITOR_ALARM = 'confidential-funding-monitor'
const TERMINAL_PHASES = new Set<ConfidentialFundingPlan['phase']>([
  'ready',
  'partial',
  'refunded',
  'failed',
  'expired',
  'cancelled'
])

function isTerminalPhase(phase: ConfidentialFundingPlan['phase']): boolean {
  return TERMINAL_PHASES.has(phase)
}

function isRecoverableLocalFailure(plan: ConfidentialFundingPlan): boolean {
  return (
    plan.phase === 'failed' &&
    plan.errorStatus === 'LOCAL_PROCESSING_FAILED' &&
    plan.requiresDeposit &&
    Boolean(plan.preparedDeposit?.transactionHash)
  )
}

export interface PrepareConfidentialFundingInput {
  readonly source: Readonly<{
    chainId: string
    chainName: string
    assetId: string
    protocolAssetId: string
    amountRaw: string
  }>
  readonly destination: Readonly<{
    chainId: string
    chainName: string
    assetId: string
    protocolAssetId: string
  }>
  readonly slippageBps: number
  readonly feeTier?: NetworkFeeTier
  readonly dedupKey?: string
}

export interface ConfidentialFundingCoordinatorOptions {
  readonly network: Network
  readonly api: ConfidentialFundingApi
  readonly store: ChromeConfidentialFundingStore
  readonly signer: ConfidentialFundingSigner
  readonly repository: TransactionRepository
  readonly assets: AssetRegistry
  readonly evmNetworks: readonly EvmNetworkConfig[]
  readonly assetMappings: readonly ConfidentialPortfolioAssetMapping[]
  readonly scheduleMonitoring?: () => Promise<void>
  readonly refreshPortfolio?: () => Promise<void>
  readonly now?: () => number
  readonly createId?: () => string
}

function isPositiveRaw(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value)
}

function isBoundedLabel(value: string, maximumLength = 64): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  )
}

function availableForAsset(
  balances: readonly Readonly<{ tokenId: string; available: string }>[],
  assetId: string
): string {
  const suffix = `:${assetId}`
  const row = balances.find(item => item.tokenId === assetId || item.tokenId.endsWith(suffix))
  return row && /^\d+$/.test(row.available) ? row.available : '0'
}

function quoteDeadline(quote: ConfidentialQuote): number {
  const value = Date.parse(quote.quote.deadline)
  if (!Number.isSafeInteger(value)) throw new Error('Confidential quote deadline is invalid')
  return value
}

function minimumAmountError(error: unknown): boolean {
  return (
    error instanceof ConfidentialFundingApiError &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    /minimum|min(?:imum)? amount|too small|below/i.test(error.message)
  )
}

function authenticationError(error: unknown): boolean {
  if (error instanceof ConfidentialFundingApiError && [401, 403].includes(error.status ?? -1)) {
    return true
  }
  return (
    error instanceof Error &&
    /active software evm account|wallet account changed|locked|unlock|credential|authorization|session/i.test(
      error.message
    )
  )
}

function retryableFundingError(error: unknown): boolean {
  return (
    error instanceof ConfidentialFundingApiError &&
    (error.ambiguous ||
      error.status === null ||
      error.status >= 500 ||
      [408, 409, 425, 429].includes(error.status))
  )
}

function normalizeStatus(value: string): string {
  return value.trim().toUpperCase()
}

function failureCode(status: string): TransactionFailureCode {
  const normalized = normalizeStatus(status)
  if (normalized === 'REFUNDED') return 'refunded'
  if (normalized === 'EXPIRED') return 'expired'
  if (normalized === 'CANCELLED') return 'cancelled'
  return 'relay-failed'
}

function phaseForSettlement(
  settlement: ReturnType<typeof aggregateConfidentialSettlement>
): ConfidentialFundingPlan['phase'] {
  switch (settlement) {
    case 'success':
      return 'ready'
    case 'partial':
      return 'partial'
    case 'refunded':
      return 'refunded'
    case 'expired':
      return 'expired'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
    default:
      return 'processing'
  }
}

function reviewFromPlan(
  plan: ConfidentialFundingPlan,
  assets: AssetRegistry
): ConfidentialFundingReview {
  const prepared = plan.preparedDeposit
    ? parsePreparedEvmTransfer(plan.preparedDeposit.preparedTransfer)
    : null
  const sourceFeeAsset = prepared
    ? assets.list(parseChainId(plan.source.chainId).id).find(entry => entry.asset.kind === 'native')
    : undefined
  return Object.freeze({
    planId: plan.planId,
    transactionId: plan.transactionId,
    phase: plan.phase,
    payloadFingerprint: plan.approvalFingerprint,
    expiresAt: plan.approvalExpiresAt,
    requiresDeposit: plan.requiresDeposit,
    ...(plan.depositQuote?.quote.depositAddress
      ? { depositAddress: plan.depositQuote.quote.depositAddress }
      : {}),
    sourceAmountRaw: plan.source.amountRaw,
    expectedOutputRaw: plan.expectedOutputRaw,
    minimumOutputRaw: plan.minimumOutputRaw,
    sourceAddress: plan.source.address,
    destinationAddress: plan.destination.address,
    withdrawCount: plan.withdraws.length,
    estimatedDurationMinutes: 10 as const,
    ...(prepared && sourceFeeAsset
      ? {
          sourceNetworkFee: Object.freeze({
            raw: (
              BigInt(prepared.transaction.gasLimit) * BigInt(prepared.transaction.maxFeePerGas)
            ).toString(),
            symbol: sourceFeeAsset.metadata.symbol,
            decimals: sourceFeeAsset.metadata.decimals
          })
        }
      : {})
  })
}

export class ConfidentialFundingCoordinator {
  private readonly rpcByChain = new Map<string, EvmTransactionRpc & EvmBroadcastRpc>()
  private readonly continuingByPlan = new Map<string, Promise<ConfidentialFundingPlan>>()
  private prepareQueue: Promise<void> = Promise.resolve()
  private readonly now: () => number
  private readonly createId: () => string

  constructor(private readonly options: ConfidentialFundingCoordinatorOptions) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? (() => crypto.randomUUID())
    for (const network of options.evmNetworks) {
      this.rpcByChain.set(network.chainId, createConfiguredEvmRpcClient(options.network, network))
    }
  }

  async prepare(value: PrepareConfidentialFundingInput): Promise<ConfidentialFundingReview> {
    const previous = this.prepareQueue.catch(() => {})
    let release!: () => void
    this.prepareQueue = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      return await this.prepareExclusive(value)
    } finally {
      release()
    }
  }

  private async prepareExclusive(
    value: PrepareConfidentialFundingInput
  ): Promise<ConfidentialFundingReview> {
    const input = this.parseInput(value)
    const sourceIdentity = await this.options.signer.resolveIdentity(input.source.chainId)
    const destinationIdentity = await this.options.signer.resolveIdentity(input.destination.chainId)
    this.assertSameAccount(sourceIdentity, destinationIdentity)

    const accountPlans = (await this.options.store.listPlans()).filter(
      plan =>
        plan.network === this.options.network &&
        plan.keyDomainId === sourceIdentity.context.chainAccount.scope.keyDomainId &&
        plan.accountId === sourceIdentity.context.chainAccount.scope.accountId
    )
    for (const expired of accountPlans.filter(
      plan => plan.phase === 'prepared' && plan.approvalExpiresAt <= this.now()
    )) {
      if (expired.preparedDeposit) {
        await this.options.signer
          .cancelTransaction({
            identity: sourceIdentity,
            commandId: expired.preparedDeposit.commandId
          })
          .catch(() => {})
      }
      await this.options.store.deletePlan(expired.planId)
    }
    const activePlans = accountPlans.filter(
      plan =>
        !(plan.phase === 'prepared' && plan.approvalExpiresAt <= this.now()) &&
        (!isTerminalPhase(plan.phase) || isRecoverableLocalFailure(plan))
    )
    const dedupKey =
      input.dedupKey ??
      `private-funding:${await fingerprintConfidentialValue({
        source: input.source,
        destination: input.destination,
        slippageBps: input.slippageBps
      })}`
    const sourcePlans = activePlans
      .filter(plan => plan.source.protocolAssetId === input.source.protocolAssetId)
      .sort((left, right) => left.createdAt - right.createdAt)
    const duplicate = sourcePlans.find(plan => plan.dedupKey === dedupKey)
    if (duplicate) {
      if (duplicate.phase === 'prepared' || duplicate.phase === 'needs-auth') {
        return reviewFromPlan(duplicate, this.options.assets)
      }
      if (duplicate.phase === 'authorized' && !duplicate.preparedDeposit?.transactionHash) {
        if (duplicate.preparedDeposit) {
          return reviewFromPlan(
            await this.updatePlan(duplicate, { phase: 'prepared' }),
            this.options.assets
          )
        }
        await this.options.store.deletePlan(duplicate.planId)
      } else {
        return reviewFromPlan(await this.continuePlan(duplicate.planId), this.options.assets)
      }
    }

    for (const unsigned of sourcePlans.filter(plan => plan.phase === 'prepared')) {
      if (unsigned.preparedDeposit) {
        await this.options.signer
          .cancelTransaction({
            identity: sourceIdentity,
            commandId: unsigned.preparedDeposit.commandId
          })
          .catch(() => {})
      }
      await this.options.store.deletePlan(unsigned.planId)
    }
    let existing = sourcePlans.find(plan => plan.phase !== 'prepared')
    if (existing?.phase === 'authorized' && !existing.preparedDeposit?.transactionHash) {
      if (!existing.preparedDeposit) {
        await this.options.store.deletePlan(existing.planId)
        existing = undefined
      } else {
        existing = await this.updatePlan(existing, { phase: 'prepared' })
      }
    } else if (existing) {
      existing = await this.continuePlan(existing.planId)
    }
    if (existing) {
      console.info('[Confidential Funding] Resuming active source plan', {
        planId: existing.planId,
        phase: existing.phase
      })
      return reviewFromPlan(existing, this.options.assets)
    }

    const session = await this.readUsableSession(sourceIdentity)
    // The approved source is the Main account. Existing Confidential funds are
    // tracked as the baseline and must never replace this transfer's deposit.
    const balances = session
      ? await this.readAndCacheBalances(sourceIdentity, session.accessToken)
      : Object.freeze([])
    const baseline = availableForAsset(balances, input.source.protocolAssetId)
    const requiresDeposit = true
    const depositQuote = await this.options.api.quote({
      originAsset: input.source.protocolAssetId,
      destinationAsset: input.source.protocolAssetId,
      amountRaw: input.source.amountRaw,
      signerId: sourceIdentity.address,
      recipient: sourceIdentity.address,
      depositType: 'ORIGIN_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipientType: 'CONFIDENTIAL_INTENTS',
      slippageBps: input.slippageBps,
      dry: false
    })
    if (!depositQuote.quote.depositAddress) {
      throw new Error('Confidential deposit quote has no destination')
    }
    assertConfidentialQuoteBinding(
      depositQuote,
      {
        originAsset: input.source.protocolAssetId,
        destinationAsset: input.source.protocolAssetId,
        amountRaw: input.source.amountRaw,
        signerId: sourceIdentity.address,
        recipient: sourceIdentity.address,
        depositType: 'ORIGIN_CHAIN',
        refundType: 'ORIGIN_CHAIN',
        recipientType: 'CONFIDENTIAL_INTENTS',
        slippageBps: input.slippageBps
      },
      this.now()
    )
    const spendRaw = depositQuote.quote.amountOut
    const previews = await this.prepareWithdrawPreviews({
      sourceAsset: input.source.protocolAssetId,
      destinationAsset: input.destination.protocolAssetId,
      spendRaw,
      signerId: sourceIdentity.address,
      recipient: destinationIdentity.peaAddress,
      slippageBps: input.slippageBps
    })

    const prepared = await buildEvmTransfer({
      chainId: input.source.chainId,
      chainAccount: sourceIdentity.context.chainAccount,
      assets: this.options.assets,
      intent: {
        assetId: input.source.assetId,
        recipient: depositQuote.quote.depositAddress,
        amountRaw: input.source.amountRaw
      },
      rpc: this.requireRpc(input.source.chainId),
      feeTier: input.feeTier
    })
    const signing = await this.options.signer.prepareTransaction({
      identity: sourceIdentity,
      prepared
    })
    const preparedDeposit: ConfidentialFundingPlan['preparedDeposit'] = Object.freeze({
      ...signing,
      preparedTransfer: prepared
    })

    const planId = this.createId()
    const createdAt = this.now()
    const expectedOutputRaw = previews.quotes
      .reduce((sum, quote) => sum + BigInt(quote.quote.amountOut), 0n)
      .toString()
    const minimumOutputRaw = previews.quotes
      .reduce((sum, quote) => sum + BigInt(quote.quote.minAmountOut), 0n)
      .toString()
    const approvalExpiresAt = Math.min(
      preparedDeposit?.expiresAt ?? Number.MAX_SAFE_INTEGER,
      quoteDeadline(depositQuote),
      ...previews.quotes.map(quoteDeadline)
    )
    const approvalFingerprint = await fingerprintConfidentialValue({
      network: this.options.network,
      source: input.source,
      destination: { ...input.destination, address: destinationIdentity.peaAddress },
      signerId: sourceIdentity.address,
      splitSourceAmounts: previews.amounts,
      expectedOutputRaw,
      minimumOutputRaw,
      depositAddress: depositQuote.quote.depositAddress,
      depositFingerprint: preparedDeposit.payloadFingerprint,
      expiresAt: approvalExpiresAt
    })
    const plan: ConfidentialFundingPlan = Object.freeze({
      schemaVersion: 1,
      planId,
      network: this.options.network,
      keyDomainId: sourceIdentity.context.chainAccount.scope.keyDomainId,
      accountId: sourceIdentity.context.chainAccount.scope.accountId,
      transactionId: `tx:confidential:${planId}`,
      phase: 'prepared',
      source: Object.freeze({ ...input.source, address: sourceIdentity.address }),
      destination: Object.freeze({ ...input.destination, address: destinationIdentity.peaAddress }),
      signerId: sourceIdentity.address,
      addressIndex: sourceIdentity.addressIndex,
      slippageBps: input.slippageBps,
      requiresDeposit,
      confidentialBaselineRaw: baseline,
      depositQuote,
      preparedDeposit,
      approvalFingerprint,
      approvalExpiresAt,
      expectedOutputRaw,
      minimumOutputRaw,
      splitSourceAmounts: previews.amounts,
      withdraws: Object.freeze(
        previews.quotes.map((quote, sequence) =>
          Object.freeze({
            sequence,
            sourceAmountRaw: previews.amounts[sequence],
            amountRaw: quote.quote.amountOut,
            depositAddress: '',
            destinationAddress: destinationIdentity.peaAddress,
            destinationChain: input.destination.chainName,
            token: input.destination.protocolAssetId,
            deadline: quoteDeadline(quote),
            status: 'PREPARED'
          })
        )
      ),
      dedupKey,
      createdAt,
      updatedAt: createdAt
    })
    await this.options.store.putPlan(plan)
    return reviewFromPlan(plan, this.options.assets)
  }

  async confirm(planId: string, approvalFingerprint: string): Promise<ConfidentialFundingPlan> {
    let plan = await this.requirePlan(planId)
    if (
      plan.approvalFingerprint !== approvalFingerprint ||
      !/^[0-9a-f]{64}$/.test(approvalFingerprint)
    ) {
      throw new Error('Confidential funding approval does not match the prepared plan')
    }
    if (
      (plan.phase !== 'prepared' && plan.phase !== 'needs-auth') ||
      (plan.phase === 'prepared' && plan.approvalExpiresAt <= this.now())
    ) {
      throw new Error('Confidential funding approval is unavailable or expired')
    }
    const identity = await this.requirePlanIdentity(plan)
    await this.ensureSession(identity, true)
    if (plan.phase === 'needs-auth') {
      plan = await this.updatePlan(plan, {
        phase: plan.resumePhase ?? 'authorized',
        resumePhase: undefined
      })
      void this.continuePlan(plan.planId)
      return plan
    }

    plan = await this.reconcileDepositRequirement(plan, identity)
    plan = await this.updatePlan(plan, { phase: 'authorized' })

    if (!plan.requiresDeposit) {
      await this.ensureGraph(plan)
      void this.continuePlan(plan.planId)
      return plan
    }
    if (!plan.preparedDeposit) throw new Error('Confidential funding deposit was not prepared')
    const signed = await this.options.signer.confirmTransaction({
      identity,
      commandId: plan.preparedDeposit.commandId,
      preparedTransfer: plan.preparedDeposit.preparedTransfer
    })
    plan = await this.updatePlan(plan, {
      phase: 'deposit-signed',
      preparedDeposit: Object.freeze({
        ...plan.preparedDeposit,
        rawTransaction: signed.rawTransaction,
        transactionHash: signed.transactionHash
      })
    })
    await this.ensureGraph(plan)
    try {
      await broadcastSignedEvmTransaction({
        rawTransaction: signed.rawTransaction,
        expectedTransactionHash: signed.transactionHash,
        rpc: this.requireRpc(plan.source.chainId)
      })
      plan = await this.updatePlan(plan, { phase: 'deposit-confirming' })
      await this.applyGraphStatus(plan, 'origin', 'broadcast', {
        transactionHash: signed.transactionHash
      })
    } catch {
      await this.scheduleMonitoring()
      throw new Error('Confidential funding deposit is signed and will retry broadcasting')
    }
    await this.scheduleMonitoring()
    void this.continuePlan(plan.planId)
    return plan
  }

  async getPlan(planId: string): Promise<ConfidentialFundingPlan> {
    return this.requirePlan(planId)
  }

  async enrichPortfolio(model: PortfolioReadModel): Promise<PortfolioReadModel> {
    const cached = await this.options.store.getBalances(
      this.options.network,
      model.scope.keyDomainId,
      model.scope.accountId
    )
    const firstEvm = this.options.evmNetworks[0]
    if (!firstEvm) {
      return mergeConfidentialBalancesIntoPortfolio(model, this.options.assetMappings, cached)
    }
    const identity = await this.options.signer
      .resolveIdentity(parseChainId(firstEvm.chainId).id)
      .catch(() => null)
    if (
      !identity ||
      model.scope.keyDomainId !== identity.context.chainAccount.scope.keyDomainId ||
      model.scope.accountId !== identity.context.chainAccount.scope.accountId
    ) {
      return mergeConfidentialBalancesIntoPortfolio(model, this.options.assetMappings, cached)
    }
    const session = await this.readUsableSession(identity)
    const balances = session
      ? await this.readAndCacheBalances(identity, session.accessToken).catch(() =>
          Promise.resolve(cached)
        )
      : cached
    return mergeConfidentialBalancesIntoPortfolio(model, this.options.assetMappings, balances)
  }

  async cancel(planId: string): Promise<void> {
    const plan = await this.requirePlan(planId)
    if (plan.phase !== 'prepared') {
      throw new Error('Confidential funding can no longer be cancelled')
    }
    if (plan.preparedDeposit) {
      const identity = await this.requirePlanIdentity(plan)
      await this.options.signer
        .cancelTransaction({ identity, commandId: plan.preparedDeposit.commandId })
        .catch(() => {})
    }
    await this.options.store.deletePlan(planId)
  }

  async resumeAll(): Promise<number> {
    const plans = (await this.options.store.listPlans()).filter(
      plan =>
        plan.network === this.options.network &&
        plan.phase !== 'prepared' &&
        (!isTerminalPhase(plan.phase) || isRecoverableLocalFailure(plan))
    )
    const results = await Promise.allSettled(plans.map(plan => this.continuePlan(plan.planId)))
    if (plans.some((_, index) => results[index].status === 'rejected'))
      await this.scheduleMonitoring()
    return results.filter(result => result.status === 'fulfilled').length
  }

  async continuePlan(planId: string): Promise<ConfidentialFundingPlan> {
    const existing = this.continuingByPlan.get(planId)
    if (existing) return existing
    const operation = this.continuePlanExclusive(planId)
      .catch(error => this.handleContinuationError(planId, error))
      .finally(() => {
        if (this.continuingByPlan.get(planId) === operation) {
          this.continuingByPlan.delete(planId)
        }
      })
    this.continuingByPlan.set(planId, operation)
    return operation
  }

  private async continuePlanExclusive(planId: string): Promise<ConfidentialFundingPlan> {
    let plan = await this.requirePlan(planId)
    if (isRecoverableLocalFailure(plan)) {
      plan = await this.updatePlan(plan, {
        phase: 'deposit-confirming',
        errorStatus: undefined
      })
    } else if (isTerminalPhase(plan.phase)) return plan
    if (plan.phase === 'needs-auth') return plan
    const session = await this.readUsableSessionForPlan(plan)
    if (!session) {
      return this.updatePlan(plan, {
        phase: 'needs-auth',
        resumePhase: plan.phase
      })
    }
    if (plan.phase === 'submitting' || plan.phase === 'processing') await this.ensureGraph(plan)

    if (
      plan.phase === 'deposit-signed' &&
      plan.preparedDeposit?.rawTransaction &&
      plan.preparedDeposit.transactionHash
    ) {
      try {
        await broadcastSignedEvmTransaction({
          rawTransaction: plan.preparedDeposit.rawTransaction,
          expectedTransactionHash: plan.preparedDeposit.transactionHash,
          rpc: this.requireRpc(plan.source.chainId)
        })
      } catch (error) {
        if (!(error instanceof Error && /already known|known transaction/i.test(error.message))) {
          await this.scheduleMonitoring()
          return plan
        }
      }
      const transactionHash = plan.preparedDeposit.transactionHash
      plan = await this.updatePlan(plan, { phase: 'deposit-confirming' })
      await this.applyGraphStatus(plan, 'origin', 'broadcast', {
        transactionHash
      })
    }

    if (plan.requiresDeposit && plan.phase === 'deposit-confirming') {
      const transactionHash = plan.preparedDeposit?.transactionHash
      if (transactionHash) {
        const observation = await observeEvmTransaction(
          transactionHash,
          this.requireRpc(plan.source.chainId)
        ).catch(() => null)
        if (observation) {
          await this.applyEvmObservation(plan, observation)
          if (observation.status === 'failed') {
            return this.updatePlan(plan, { phase: 'failed', errorStatus: 'DEPOSIT_REVERTED' })
          }
        }
      }
      const status = await this.readStatus(plan, plan.depositQuote!.quote.depositAddress, 'deposit')
      if (status?.transactionHash) {
        await this.applyGraphStatus(plan, 'relay', 'confirming', {
          transactionHash: status.transactionHash
        })
      }
      const balances = await this.readAndCacheBalancesForPlan(plan, session.accessToken).catch(
        () => null
      )
      const available = availableForAsset(balances ?? [], plan.source.protocolAssetId)
      const expectedCredit = plan.splitSourceAmounts.reduce(
        (sum, amountRaw) => sum + BigInt(amountRaw),
        0n
      )
      const expectedAvailable = BigInt(plan.confidentialBaselineRaw) + expectedCredit
      const credited = balances !== null && BigInt(available) >= expectedAvailable
      const normalizedStatus = normalizeStatus(status?.status ?? '')
      if (['FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(normalizedStatus)) {
        const phase = phaseForSettlement(
          normalizedStatus === 'REFUNDED'
            ? 'refunded'
            : normalizedStatus === 'EXPIRED'
              ? 'expired'
              : normalizedStatus === 'CANCELLED'
                ? 'cancelled'
                : 'failed'
        )
        await this.applyGraphStatus(
          plan,
          'origin',
          'failed',
          undefined,
          failureCode(normalizedStatus)
        )
        return this.updatePlan(plan, {
          phase,
          ...(status?.errorStatus ? { errorStatus: status.errorStatus } : {})
        })
      }
      const reportedTooLittle =
        status?.amountOutRaw !== undefined && BigInt(status.amountOutRaw) < expectedCredit
      const depositExpired = quoteDeadline(plan.depositQuote!) <= this.now()
      if (
        normalizedStatus === 'SUCCESS' &&
        !credited &&
        (reportedTooLittle || (balances !== null && depositExpired))
      ) {
        await this.applyGraphStatus(plan, 'origin', 'failed', undefined, 'relay-failed')
        return this.updatePlan(plan, {
          phase: 'failed',
          errorStatus: 'DEPOSIT_AMOUNT_TOO_LOW'
        })
      }
      if (!credited || normalizedStatus !== 'SUCCESS') {
        await this.scheduleMonitoring()
        return plan
      }
      await this.applyGraphStatus(plan, 'origin', 'final', { transactionHash })
      await this.applyGraphStatus(plan, 'relay', 'confirming')
      plan = await this.updatePlan(plan, { phase: 'signing-withdraws' })
    }

    if (!plan.requiresDeposit && plan.phase === 'authorized') {
      await this.ensureGraph(plan)
      await this.applyGraphStatus(plan, 'relay', 'confirming')
      plan = await this.updatePlan(plan, { phase: 'signing-withdraws' })
    }

    if (plan.phase === 'signing-withdraws') {
      const identity = await this.requirePlanIdentity(plan)
      plan = await this.signAndFreezeWithdraws(plan, identity)
    }
    if (plan.phase === 'submitting') plan = await this.recoverOrSubmit(plan, session.accessToken)
    if (plan.phase === 'processing' || plan.phase === 'partial') {
      plan = await this.refreshSettlement(plan, session.accessToken)
    }
    if (!isTerminalPhase(plan.phase)) {
      await this.scheduleMonitoring()
    }
    return plan
  }

  private parseInput(value: PrepareConfidentialFundingInput): PrepareConfidentialFundingInput & {
    readonly source: PrepareConfidentialFundingInput['source'] & {
      readonly chainId: ChainId
    }
    readonly destination: PrepareConfidentialFundingInput['destination'] & {
      readonly chainId: ChainId
    }
  } {
    const sourceChain = parseChainId(value.source.chainId)
    const destinationChain = parseChainId(value.destination.chainId)
    if (sourceChain.namespace !== 'eip155' || destinationChain.namespace !== 'eip155') {
      throw new Error('Confidential funding currently requires EVM source and destination chains')
    }
    if (
      parseAssetId(value.source.assetId).chainId !== sourceChain.id ||
      parseAssetId(value.destination.assetId).chainId !== destinationChain.id ||
      !this.options.assets.get(value.source.assetId) ||
      !this.options.assets.get(value.destination.assetId) ||
      !this.options.assetMappings.some(
        mapping =>
          mapping.assetId === value.source.assetId &&
          mapping.protocolAssetId === value.source.protocolAssetId
      ) ||
      !this.options.assetMappings.some(
        mapping =>
          mapping.assetId === value.destination.assetId &&
          mapping.protocolAssetId === value.destination.protocolAssetId
      ) ||
      !isPositiveRaw(value.source.amountRaw) ||
      !value.source.protocolAssetId ||
      !value.destination.protocolAssetId ||
      !isBoundedLabel(value.source.chainName) ||
      !isBoundedLabel(value.destination.chainName) ||
      !Number.isSafeInteger(value.slippageBps) ||
      value.slippageBps < 0 ||
      value.slippageBps > 10_000 ||
      (value.feeTier !== undefined && !['low', 'standard', 'fast'].includes(value.feeTier)) ||
      (value.dedupKey !== undefined && !isBoundedLabel(value.dedupKey, 160))
    ) {
      throw new Error('Confidential funding request is invalid')
    }
    return Object.freeze({
      source: Object.freeze({
        chainId: sourceChain.id,
        chainName: value.source.chainName,
        assetId: value.source.assetId,
        protocolAssetId: value.source.protocolAssetId,
        amountRaw: value.source.amountRaw
      }),
      destination: Object.freeze({
        chainId: destinationChain.id,
        chainName: value.destination.chainName,
        assetId: value.destination.assetId,
        protocolAssetId: value.destination.protocolAssetId
      }),
      slippageBps: value.slippageBps,
      ...(value.feeTier ? { feeTier: value.feeTier } : {}),
      ...(value.dedupKey ? { dedupKey: value.dedupKey } : {})
    })
  }

  private async prepareWithdrawPreviews(input: {
    readonly sourceAsset: string
    readonly destinationAsset: string
    readonly spendRaw: string
    readonly signerId: string
    readonly recipient: string
    readonly slippageBps: number
  }): Promise<Readonly<{ amounts: readonly string[]; quotes: readonly ConfidentialQuote[] }>> {
    const attempt = async (count: number) => {
      const amounts = splitConfidentialFundingAmount(input.spendRaw, count)
      const quotes = await Promise.all(
        amounts.map(amountRaw =>
          this.options.api.quote({
            originAsset: input.sourceAsset,
            destinationAsset: input.destinationAsset,
            amountRaw,
            signerId: input.signerId,
            recipient: input.recipient,
            depositType: 'CONFIDENTIAL_INTENTS',
            refundType: 'CONFIDENTIAL_INTENTS',
            recipientType: 'DESTINATION_CHAIN',
            slippageBps: input.slippageBps,
            dry: true
          })
        )
      )
      quotes.forEach((quote, index) => {
        assertConfidentialQuoteBinding(
          quote,
          {
            originAsset: input.sourceAsset,
            destinationAsset: input.destinationAsset,
            amountRaw: amounts[index],
            signerId: input.signerId,
            recipient: input.recipient,
            depositType: 'CONFIDENTIAL_INTENTS',
            refundType: 'CONFIDENTIAL_INTENTS',
            recipientType: 'DESTINATION_CHAIN',
            slippageBps: input.slippageBps
          },
          this.now()
        )
      })
      return Object.freeze({ amounts, quotes: Object.freeze(quotes) })
    }
    try {
      return await attempt(CONFIDENTIAL_WITHDRAW_DEFAULT_COUNT)
    } catch (error) {
      if (!minimumAmountError(error)) throw error
      return attempt(2)
    }
  }

  private async signAndFreezeWithdraws(
    plan: ConfidentialFundingPlan,
    identity: ConfidentialSigningIdentity
  ): Promise<ConfidentialFundingPlan> {
    const quotes = await Promise.all(
      plan.splitSourceAmounts.map(sourceAmountRaw =>
        this.options.api.quote({
          originAsset: plan.source.protocolAssetId,
          destinationAsset: plan.destination.protocolAssetId,
          amountRaw: sourceAmountRaw,
          signerId: plan.signerId,
          recipient: plan.destination.address,
          depositType: 'CONFIDENTIAL_INTENTS',
          refundType: 'CONFIDENTIAL_INTENTS',
          recipientType: 'DESTINATION_CHAIN',
          slippageBps: plan.slippageBps,
          dry: false
        })
      )
    )
    quotes.forEach((quote, sequence) => {
      assertConfidentialQuoteBinding(
        quote,
        {
          originAsset: plan.source.protocolAssetId,
          destinationAsset: plan.destination.protocolAssetId,
          amountRaw: plan.splitSourceAmounts[sequence],
          signerId: plan.signerId,
          recipient: plan.destination.address,
          depositType: 'CONFIDENTIAL_INTENTS',
          refundType: 'CONFIDENTIAL_INTENTS',
          recipientType: 'DESTINATION_CHAIN',
          slippageBps: plan.slippageBps
        },
        this.now()
      )
      if (
        !quote.quote.depositAddress ||
        quote.quote.amountIn !== plan.splitSourceAmounts[sequence]
      ) {
        throw new Error('Confidential withdraw quote does not match the approved batch')
      }
    })
    const formalExpectedRaw = quotes
      .reduce((sum, quote) => sum + BigInt(quote.quote.amountOut), 0n)
      .toString()
    const formalMinimumRaw = quotes
      .reduce((sum, quote) => sum + BigInt(quote.quote.minAmountOut), 0n)
      .toString()
    if (
      BigInt(formalExpectedRaw) < BigInt(plan.minimumOutputRaw) ||
      BigInt(formalMinimumRaw) < BigInt(plan.minimumOutputRaw)
    ) {
      await this.applyGraphStatus(plan, 'relay', 'failed', undefined, 'relay-failed')
      return this.updatePlan(plan, {
        phase: 'failed',
        errorStatus: 'QUOTE_CHANGED'
      })
    }

    const rows: ConfidentialWithdrawRow[] = []
    const requestRows: ConfidentialWithdrawRequest['withdraws'][number][] = []
    for (let sequence = 0; sequence < plan.splitSourceAmounts.length; sequence += 1) {
      const sourceAmountRaw = plan.splitSourceAmounts[sequence]
      const quote = quotes[sequence]
      const generated = await this.options.api.generateIntent({
        signerId: plan.signerId,
        depositAddress: quote.quote.depositAddress
      })
      const binding = assertConfidentialIntentBinding({
        intent: generated.intent,
        quote,
        signerId: plan.signerId,
        sourceAsset: plan.source.protocolAssetId,
        sourceAmountRaw,
        destinationAsset: plan.destination.protocolAssetId,
        destinationAddress: plan.destination.address
      })
      const signedPayload = await this.options.signer.signMessage({
        identity,
        chainId: parseChainId(plan.destination.chainId).id,
        payload: binding.payload
      })
      const amountRaw = quote.quote.amountOut
      rows.push(
        Object.freeze({
          sequence,
          sourceAmountRaw,
          amountRaw,
          depositAddress: quote.quote.depositAddress,
          destinationAddress: plan.destination.address,
          destinationChain: plan.destination.chainName,
          token: plan.destination.protocolAssetId,
          deadline: binding.deadline,
          status: 'SIGNED',
          signedPayload
        })
      )
      requestRows.push(
        Object.freeze({
          amount: amountRaw,
          deposit_address: quote.quote.depositAddress,
          destination_address: plan.destination.address,
          destination_chain: plan.destination.chainName,
          execution_type: 'CONFIDENTIAL_1CLICK' as const,
          sequence,
          signed_payload: signedPayload,
          token: plan.destination.protocolAssetId
        })
      )
    }
    const frozenRequest = normalizeConfidentialWithdrawRequest({
      from_amount: plan.source.amountRaw,
      from_chain: plan.source.chainName,
      from_token: plan.source.protocolAssetId,
      mode: plan.source.protocolAssetId === plan.destination.protocolAssetId ? 'TRANSFER' : 'SWAP',
      signer_id: plan.signerId,
      withdraws: Object.freeze(requestRows)
    })
    const requestFingerprint = await fingerprintConfidentialValue(frozenRequest)
    plan = await this.updatePlan(plan, {
      phase: 'submitting',
      withdraws: Object.freeze(rows),
      frozenRequest,
      requestFingerprint,
      expectedOutputRaw: formalExpectedRaw,
      minimumOutputRaw: formalMinimumRaw
    })
    await this.ensureGraph(plan)
    await this.applyGraphStatus(plan, 'relay', 'confirming')
    for (const row of rows) {
      await this.applyGraphStatus(plan, `withdraw:${row.sequence}`, 'confirming', {
        externalReference: row.depositAddress
      })
    }
    return plan
  }

  private async recoverOrSubmit(
    plan: ConfidentialFundingPlan,
    accessToken: string
  ): Promise<ConfidentialFundingPlan> {
    if (!plan.frozenRequest || !plan.requestFingerprint) {
      throw new Error('Frozen private withdraw request is unavailable')
    }
    const frozenRequest = normalizeConfidentialWithdrawRequest(plan.frozenRequest)
    if ((await fingerprintConfidentialValue(frozenRequest)) !== plan.requestFingerprint) {
      throw new Error('Frozen private withdraw request was modified')
    }
    let current = plan
    for (const requestRow of frozenRequest.withdraws) {
      const row = current.withdraws[requestRow.sequence]
      if (!row || normalizeStatus(row.status) !== 'SIGNED') continue

      const priorStatus = await this.readStatus(
        current,
        row.depositAddress,
        'before-submit',
        row.sequence
      )
      const prior = normalizeStatus(priorStatus?.status ?? '')
      let intentHash: string | undefined
      let observedStatus = priorStatus
      if (!prior || prior === 'PENDING_DEPOSIT' || prior === 'INCOMPLETE_DEPOSIT') {
        if (row.deadline <= this.now()) {
          const expiredRows = current.withdraws.map(item =>
            item.sequence === requestRow.sequence
              ? Object.freeze({ ...item, status: 'EXPIRED', errorStatus: 'SIGNED_PAYLOAD_EXPIRED' })
              : item
          )
          current = await this.updatePlan(current, {
            withdraws: Object.freeze(expiredRows)
          })
          continue
        }
        try {
          const submitted = await this.options.api.submitIntent(
            requestRow.signed_payload,
            accessToken
          )
          intentHash = submitted.intentHash
          observedStatus = null
          console.info('[Confidential Funding] Intent submitted', {
            planId: current.planId,
            phase: current.phase,
            sequence: requestRow.sequence,
            intentHash: submitted.intentHash
          })
        } catch (error) {
          if (authenticationError(error)) throw error
          observedStatus = await this.readStatus(
            current,
            row.depositAddress,
            'submit-recovery',
            row.sequence
          )
          const recoveredStatus = normalizeStatus(observedStatus?.status ?? '')
          if (
            !recoveredStatus ||
            recoveredStatus === 'PENDING_DEPOSIT' ||
            recoveredStatus === 'INCOMPLETE_DEPOSIT'
          ) {
            if (error instanceof ConfidentialFundingApiError && error.ambiguous) {
              await this.scheduleMonitoring()
              return current
            }
            throw error
          }
        }
      }

      const nextRows = current.withdraws.map(item =>
        item.sequence === requestRow.sequence
          ? Object.freeze({
              ...item,
              status: observedStatus?.status ?? 'PROCESSING',
              ...(intentHash ? { intentHash } : {}),
              ...(observedStatus?.transactionHash
                ? { transactionHash: observedStatus.transactionHash }
                : {}),
              ...(observedStatus?.errorStatus ? { errorStatus: observedStatus.errorStatus } : {})
            })
          : item
      )
      current = await this.updatePlan(current, { withdraws: Object.freeze(nextRows) })
    }

    const sanitizedRows = current.withdraws.map(({ signedPayload: _signedPayload, ...row }) =>
      Object.freeze({
        ...row,
        status: normalizeStatus(row.status) === 'SIGNED' ? 'PROCESSING' : row.status
      })
    )
    return this.updatePlan(current, {
      phase: 'processing',
      orderId: undefined,
      backendStatus: undefined,
      frozenRequest: undefined,
      withdraws: Object.freeze(sanitizedRows)
    })
  }

  private async refreshSettlement(
    plan: ConfidentialFundingPlan,
    accessToken: string
  ): Promise<ConfidentialFundingPlan> {
    const statuses = await Promise.all(
      plan.withdraws.map(row =>
        this.readStatus(plan, row.depositAddress, 'settlement', row.sequence)
      )
    )
    const rows = plan.withdraws.map((row, index) => {
      const status = statuses[index]
      return mergeConfidentialWithdrawObservation(row, {
        status: status?.status ?? row.status,
        transactionHash: status?.transactionHash,
        errorStatus: status?.errorStatus
      })
    })
    const settlement = aggregateConfidentialSettlement(rows.map(row => row.status))
    for (const row of rows) {
      const status = normalizeStatus(row.status)
      if (status === 'SUCCESS' || status === 'COMPLETED') {
        await this.applyGraphStatus(plan, `withdraw:${row.sequence}`, 'final', {
          ...(row.transactionHash ? { transactionHash: row.transactionHash } : {})
        })
      } else if (['FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED'].includes(status)) {
        await this.applyGraphStatus(
          plan,
          `withdraw:${row.sequence}`,
          'failed',
          row.transactionHash ? { transactionHash: row.transactionHash } : undefined,
          failureCode(status)
        )
      } else {
        await this.applyGraphStatus(
          plan,
          `withdraw:${row.sequence}`,
          'confirming',
          row.transactionHash ? { transactionHash: row.transactionHash } : undefined
        )
      }
    }
    const next = await this.updatePlan(plan, {
      phase: phaseForSettlement(settlement),
      withdraws: Object.freeze(rows),
      backendStatus: undefined,
      errorStatus: undefined
    })
    if (settlement === 'success') {
      await this.applyGraphStatus(next, 'relay', 'final')
    } else if (settlement !== 'confirming') {
      const aggregateFailure: TransactionFailureCode =
        settlement === 'refunded'
          ? 'refunded'
          : settlement === 'expired'
            ? 'expired'
            : settlement === 'cancelled'
              ? 'cancelled'
              : 'relay-failed'
      await this.applyGraphStatus(next, 'relay', 'failed', undefined, aggregateFailure)
    }
    if (isTerminalPhase(next.phase)) {
      await this.readAndCacheBalancesForPlan(next, accessToken).catch(() => [])
      await this.options.refreshPortfolio?.().catch(() => {})
    }
    return next
  }

  private async handleContinuationError(
    planId: string,
    error: unknown
  ): Promise<ConfidentialFundingPlan> {
    const plan = await this.options.store.getPlan(planId)
    if (!plan || plan.network !== this.options.network) throw error
    if (isTerminalPhase(plan.phase)) return plan
    console.error('[Confidential Funding] Continuation failed', {
      planId: plan.planId,
      phase: plan.phase,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      serviceStatus: error instanceof ConfidentialFundingApiError ? error.status : null,
      retryable: retryableFundingError(error)
    })
    if (authenticationError(error)) {
      if (error instanceof ConfidentialFundingApiError && [401, 403].includes(error.status ?? -1)) {
        await this.options.store.deleteSession(plan.network, plan.keyDomainId, plan.accountId)
      }
      return this.updatePlan(plan, {
        phase: 'needs-auth',
        resumePhase: plan.phase === 'needs-auth' ? plan.resumePhase : plan.phase
      })
    }
    if (retryableFundingError(error)) {
      await this.scheduleMonitoring()
      return plan
    }
    return this.updatePlan(plan, {
      errorStatus:
        error instanceof ConfidentialFundingApiError && error.status !== null
          ? `SERVICE_${error.status}`
          : 'LOCAL_PROCESSING_FAILED'
    })
  }

  private async readUsableSession(identity: ConfidentialSigningIdentity) {
    return this.readUsableSessionForScope(
      identity.context.chainAccount.scope.keyDomainId,
      identity.context.chainAccount.scope.accountId
    )
  }

  private async readUsableSessionForPlan(plan: ConfidentialFundingPlan) {
    return this.readUsableSessionForScope(plan.keyDomainId, plan.accountId)
  }

  private async readUsableSessionForScope(keyDomainId: string, accountId: string) {
    const session = await this.options.store.getSession(
      this.options.network,
      keyDomainId,
      accountId
    )
    if (!session) return null
    if (session.expiresAt > this.now() + SESSION_REFRESH_BUFFER_MS) return session
    if (session.refreshExpiresAt <= this.now()) return null
    try {
      const refreshed = await this.options.api.refresh(session)
      await this.options.store.putSession(this.options.network, keyDomainId, accountId, refreshed)
      return refreshed
    } catch {
      return null
    }
  }

  private async reconcileDepositRequirement(
    plan: ConfidentialFundingPlan,
    identity: ConfidentialSigningIdentity
  ): Promise<ConfidentialFundingPlan> {
    const session = await this.readUsableSession(identity)
    if (!session) throw new Error('Confidential authorization session is unavailable')
    const balances = await this.readAndCacheBalances(identity, session.accessToken)
    const available = availableForAsset(balances, plan.source.protocolAssetId)
    if (!plan.requiresDeposit) {
      if (BigInt(available) < BigInt(plan.source.amountRaw)) {
        throw new Error('Confidential balance changed. Review the transfer again.')
      }
      return this.updatePlan(plan, { confidentialBaselineRaw: available })
    }
    return this.updatePlan(plan, { confidentialBaselineRaw: available })
  }

  private async ensureSession(identity: ConfidentialSigningIdentity, authenticate: boolean) {
    const session = await this.readUsableSession(identity)
    if (session || !authenticate) return session
    const unsigned = await this.options.api.createAuthPayload(identity.address)
    const signed = await this.options.signer.signMessage({
      identity,
      chainId: identity.context.chainAccount.scope.chainId,
      payload: unsigned.payload
    })
    const authenticated = await this.options.api.authenticate(signed)
    await this.options.store.putSession(
      this.options.network,
      identity.context.chainAccount.scope.keyDomainId,
      identity.context.chainAccount.scope.accountId,
      authenticated
    )
    return authenticated
  }

  private async readAndCacheBalances(identity: ConfidentialSigningIdentity, accessToken: string) {
    const balances = await this.options.api.getBalances(accessToken)
    await this.options.store.putBalances(
      this.options.network,
      identity.context.chainAccount.scope.keyDomainId,
      identity.context.chainAccount.scope.accountId,
      balances
    )
    return balances
  }

  private async readAndCacheBalancesForPlan(plan: ConfidentialFundingPlan, accessToken: string) {
    const balances = await this.options.api.getBalances(accessToken)
    await this.options.store.putBalances(
      this.options.network,
      plan.keyDomainId,
      plan.accountId,
      balances
    )
    return balances
  }

  private async ensureGraph(plan: ConfidentialFundingPlan): Promise<void> {
    if (!plan.requiresDeposit && !plan.requestFingerprint) return
    const scope = {
      keyDomainId: parseKeyDomainId(plan.keyDomainId),
      accountId: parseAccountId(plan.accountId)
    }
    if (await this.options.repository.get(scope, parseTransactionId(plan.transactionId))) return
    const prepared = plan.preparedDeposit
      ? parsePreparedEvmTransfer(plan.preparedDeposit.preparedTransfer)
      : null
    const feeAsset = prepared
      ? this.options.assets
          .list(parseChainId(plan.source.chainId).id)
          .find(entry => entry.asset.kind === 'native')?.asset.id
      : undefined
    const graph = createConfidentialFundingGraph({
      planId: plan.planId,
      scope,
      source: {
        chainId: plan.source.chainId,
        assetId: plan.source.assetId,
        amountRaw: plan.source.amountRaw,
        address: plan.source.address,
        ...(feeAsset && prepared
          ? {
              feeAssetId: feeAsset,
              maximumFeeRaw: (
                BigInt(prepared.transaction.gasLimit) * BigInt(prepared.transaction.maxFeePerGas)
              ).toString()
            }
          : {}),
        ...(plan.preparedDeposit?.transactionHash
          ? { transactionHash: plan.preparedDeposit.transactionHash }
          : {})
      },
      destination: {
        chainId: plan.destination.chainId,
        assetId: plan.destination.assetId,
        expectedAmountRaw: plan.expectedOutputRaw,
        address: plan.destination.address
      },
      withdrawDepositAddresses: plan.withdraws.map(row => row.depositAddress || null),
      requiresDeposit: plan.requiresDeposit,
      signedWithdrawFingerprint: plan.requestFingerprint,
      now: plan.createdAt
    })
    const result = await this.options.repository.create(graph)
    if (result.status === 'id-conflict') {
      throw new Error('Confidential funding transaction ID conflicts')
    }
  }

  private async applyEvmObservation(
    plan: ConfidentialFundingPlan,
    observation: NonNullable<Awaited<ReturnType<typeof observeEvmTransaction>>>
  ): Promise<void> {
    const scope = {
      keyDomainId: parseKeyDomainId(plan.keyDomainId),
      accountId: parseAccountId(plan.accountId)
    }
    const transactionId = parseTransactionId(plan.transactionId)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = await this.options.repository.get(scope, transactionId)
      if (!graph) return
      const segment = graph.segments.find(item => item.id.endsWith(':origin'))
      if (!segment) return
      const event = createEvmTransactionSegmentEvent({
        segment,
        observation,
        eventId: parseTransactionEventId(`event:confidential:${crypto.randomUUID()}`),
        observedAt: this.now()
      })
      if (!event) return
      const result = await this.options.repository.applySegmentEvent({
        scope,
        transactionId,
        segmentId: segment.id,
        event,
        expectedRootRevision: graph.root.revision,
        expectedSegmentRevision: segment.revision
      })
      if (result.status !== 'revision-conflict') return
    }
  }

  private async applyGraphStatus(
    plan: ConfidentialFundingPlan,
    segment: 'origin' | 'relay' | `withdraw:${number}`,
    status: TransactionLifecycleStatus,
    evidence?: TransactionSegmentEvidence,
    failure?: TransactionFailureCode
  ): Promise<void> {
    const scope = {
      keyDomainId: parseKeyDomainId(plan.keyDomainId),
      accountId: parseAccountId(plan.accountId)
    }
    const transactionId = parseTransactionId(plan.transactionId)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const graph = await this.options.repository.get(scope, transactionId)
      if (!graph) return
      const segmentId = parseTransactionSegmentId(`segment:confidential:${plan.planId}:${segment}`)
      const current = graph.segments.find(item => item.id === segmentId)
      if (!current || current.status === 'final' || current.status === 'failed') return
      const now = this.now()
      const event = {
        id: parseTransactionEventId(`event:confidential:${crypto.randomUUID()}`),
        status,
        cause: status === 'failed' ? ('failure' as const) : ('progress' as const),
        observedAt: now,
        ...(evidence ? { evidence } : {}),
        ...(status === 'failed'
          ? { failure: { code: failure ?? 'relay-failed', occurredAt: now } }
          : {})
      }
      const result = await this.options.repository.applySegmentEvent({
        scope,
        transactionId,
        segmentId,
        event,
        expectedRootRevision: graph.root.revision,
        expectedSegmentRevision: current.revision
      })
      if (result.status !== 'revision-conflict') return
    }
  }

  private async requirePlan(planId: string): Promise<ConfidentialFundingPlan> {
    const plan = await this.options.store.getPlan(planId)
    if (!plan || plan.network !== this.options.network) {
      throw new Error('Confidential funding plan was not found')
    }
    return plan
  }

  private async readStatus(
    plan: ConfidentialFundingPlan,
    depositAddress: string,
    stage: 'deposit' | 'before-submit' | 'submit-recovery' | 'settlement',
    sequence?: number
  ) {
    try {
      const chainId = parseChainId(
        stage === 'deposit' ? plan.source.chainId : plan.destination.chainId
      ).reference
      return await this.options.api.getStatus(depositAddress, chainId)
    } catch (error) {
      console.warn('[Confidential Funding] Status request failed', {
        planId: plan.planId,
        phase: plan.phase,
        stage,
        ...(sequence === undefined ? {} : { sequence }),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error),
        serviceStatus: error instanceof ConfidentialFundingApiError ? error.status : null
      })
      return null
    }
  }

  private async requirePlanIdentity(plan: ConfidentialFundingPlan) {
    const identity = await this.options.signer.resolveIdentity(
      parseChainId(plan.destination.chainId).id
    )
    if (
      identity.context.chainAccount.scope.keyDomainId !== plan.keyDomainId ||
      identity.context.chainAccount.scope.accountId !== plan.accountId ||
      identity.address !== plan.signerId ||
      identity.addressIndex !== plan.addressIndex ||
      identity.peaAddress.toLowerCase() !== plan.destination.address.toLowerCase()
    ) {
      throw new Error('Active Wallet Account changed before private funding completed')
    }
    return identity
  }

  private assertSameAccount(
    source: ConfidentialSigningIdentity,
    destination: ConfidentialSigningIdentity
  ): void {
    if (
      source.context.chainAccount.scope.keyDomainId !==
        destination.context.chainAccount.scope.keyDomainId ||
      source.context.chainAccount.scope.accountId !==
        destination.context.chainAccount.scope.accountId ||
      source.address !== destination.address ||
      source.addressIndex !== destination.addressIndex
    ) {
      throw new Error(
        'Confidential funding source and destination do not belong to the same Account'
      )
    }
  }

  private requireRpc(chainId: string): EvmTransactionRpc & EvmBroadcastRpc {
    const rpc = this.rpcByChain.get(chainId)
    if (!rpc) throw new Error('Confidential funding EVM network is unavailable')
    return rpc
  }

  private async updatePlan(
    plan: ConfidentialFundingPlan,
    changes: Partial<ConfidentialFundingPlan>
  ): Promise<ConfidentialFundingPlan> {
    const next = Object.freeze({ ...plan, ...changes, updatedAt: this.now() })
    await this.options.store.putPlan(next)
    return next
  }

  private async scheduleMonitoring(): Promise<void> {
    await (this.options.scheduleMonitoring?.() ??
      chrome.alarms.create(CONFIDENTIAL_FUNDING_MONITOR_ALARM, { delayInMinutes: 0.1 }))
  }
}
