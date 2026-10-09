import type { EvmNetworkConfig } from '@/config/networks'
import { Eip1193ProviderError } from '@/core/dapp/eip1193'
import {
  RHEA_SWAP_CHAIN_CATALOG,
  resolveRheaPrivateTransferToken,
  type RheaSwapService,
  type RheaSwapSubmissionView
} from '@/core/services/rhea-swap'
import { parseRheaSwapTransactionBinding } from '@/core/transactions/domain'
import type { EvmTransferIntent, PeaEvmExecutionAccount } from '@/infrastructure/chains/evm'
import type { BackgroundEvmTransferController } from './evm-transfer-controller'
import type { RheaSwapEvmSignatureCoordinator } from './rhea-swap-evm-signature'

const DEFAULT_SLIPPAGE_BPS = 100
const DEFAULT_WAIT_MS = 15 * 60 * 1_000
const DEFAULT_POLL_MS = 5_000
const SUBMISSION_CACHE_MS = 20 * 60 * 1_000
const COMPLETED_CACHE_MS = 5 * 60 * 1_000

export interface EvmDAppPrivateTransferInput {
  readonly origin: string
  readonly chainId: string
  readonly account: Readonly<{
    keyDomainId: string
    accountId: string
    address: string
    addressIndex: number
  }>
  readonly intent: EvmTransferIntent
  readonly tokenContract?: string
  readonly tabInfo: Readonly<{ title?: string; favIconUrl?: string; pageUrl?: string }>
  readonly ensureIdentity: () => Promise<void>
}

export interface EvmDAppPrivateTransferPort {
  readonly send: (input: EvmDAppPrivateTransferInput) => Promise<string>
}

interface StoredSubmission {
  readonly schemaVersion: 1
  readonly fingerprint: string
  readonly quoteHandle: string
  readonly destinationHash: string | null
  readonly expiresAt: number
}

export interface PrivateTransferSubmissionStore {
  readonly get: (fingerprint: string) => Promise<StoredSubmission | null>
  readonly put: (submission: StoredSubmission) => Promise<void>
  readonly delete: (fingerprint: string) => Promise<void>
}

function parseStoredSubmission(value: unknown): StoredSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored Confidential dApp transfer is invalid')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.fingerprint) ||
    typeof record.quoteHandle !== 'string' ||
    !record.quoteHandle.startsWith('rhea-quote:') ||
    (record.destinationHash !== null &&
      (typeof record.destinationHash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(record.destinationHash))) ||
    !Number.isSafeInteger(record.expiresAt) ||
    (record.expiresAt as number) <= 0
  ) {
    throw new Error('Stored Confidential dApp transfer fields are invalid')
  }
  return Object.freeze({
    schemaVersion: 1,
    fingerprint: record.fingerprint,
    quoteHandle: record.quoteHandle,
    destinationHash:
      record.destinationHash === null ? null : (record.destinationHash as string).toLowerCase(),
    expiresAt: record.expiresAt as number
  })
}

export class ChromeSessionEvmDAppPrivateTransferStore implements PrivateTransferSubmissionStore {
  async get(fingerprint: string): Promise<StoredSubmission | null> {
    const key = this.key(fingerprint)
    const value = (await chrome.storage.session.get(key))[key]
    if (value === undefined) return null
    const parsed = parseStoredSubmission(value)
    if (parsed.expiresAt <= Date.now()) {
      await chrome.storage.session.remove(key)
      return null
    }
    return parsed
  }

  async put(submission: StoredSubmission): Promise<void> {
    const parsed = parseStoredSubmission(submission)
    await chrome.storage.session.set({ [this.key(parsed.fingerprint)]: parsed })
  }

  async delete(fingerprint: string): Promise<void> {
    await chrome.storage.session.remove(this.key(fingerprint))
  }

  private key(fingerprint: string): string {
    if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
      throw new Error('Confidential transfer key is invalid')
    }
    return `evm_dapp_private_transfer:${fingerprint}`
  }
}

export interface EvmDAppPrivateTransferCoordinatorOptions {
  readonly network: EvmNetworkConfig
  readonly service: Pick<
    RheaSwapService,
    | 'listTokens'
    | 'quote'
    | 'prepare'
    | 'readEvmTransactionPlan'
    | 'readEvmSignaturePlan'
    | 'recordTransactionSubmission'
    | 'reportSubmission'
    | 'getOrderStatus'
    | 'discard'
  >
  readonly signatureCoordinator: Pick<
    RheaSwapEvmSignatureCoordinator,
    'prepare' | 'confirm' | 'cancel'
  >
  readonly transferController: BackgroundEvmTransferController
  readonly approval: Readonly<{
    requestExternalApproval: (
      origin: string,
      action: string,
      data?: unknown
    ) => Promise<{ readonly approved: boolean; readonly requestId: string }>
  }>
  readonly store?: PrivateTransferSubmissionStore
  readonly readSlippageBps?: () => Promise<number>
  readonly now?: () => number
  readonly waitMs?: number
  readonly pollMs?: number
  readonly sleep?: (ms: number) => Promise<void>
}

function metadata(input: EvmDAppPrivateTransferInput): Readonly<Record<string, string>> {
  return Object.freeze({
    ...(input.tabInfo.favIconUrl === undefined ? {} : { favicon: input.tabInfo.favIconUrl }),
    ...(input.tabInfo.pageUrl === undefined ? {} : { faviconPageUrl: input.tabInfo.pageUrl })
  })
}

async function fingerprintInput(input: EvmDAppPrivateTransferInput): Promise<string> {
  const value = JSON.stringify({
    origin: input.origin,
    chainId: input.chainId,
    keyDomainId: input.account.keyDomainId,
    accountId: input.account.accountId,
    sender: input.account.address.toLowerCase(),
    assetId: input.intent.assetId,
    recipient: input.intent.recipient.toLowerCase(),
    amountRaw: input.intent.amountRaw
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export class EvmDAppPrivateTransferCoordinator implements EvmDAppPrivateTransferPort {
  private readonly store: PrivateTransferSubmissionStore
  private readonly now: () => number
  private readonly waitMs: number
  private readonly pollMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly inFlight = new Map<string, Promise<string>>()

  constructor(private readonly options: EvmDAppPrivateTransferCoordinatorOptions) {
    this.store = options.store ?? new ChromeSessionEvmDAppPrivateTransferStore()
    this.now = options.now ?? Date.now
    this.waitMs = options.waitMs ?? DEFAULT_WAIT_MS
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  async send(input: EvmDAppPrivateTransferInput): Promise<string> {
    const fingerprint = await fingerprintInput(input)
    const existing = this.inFlight.get(fingerprint)
    if (existing) return existing
    const operation = this.sendExclusive(input, fingerprint).finally(() => {
      if (this.inFlight.get(fingerprint) === operation) this.inFlight.delete(fingerprint)
    })
    this.inFlight.set(fingerprint, operation)
    return operation
  }

  private async sendExclusive(
    input: EvmDAppPrivateTransferInput,
    fingerprint: string
  ): Promise<string> {
    const stored = await this.store.get(fingerprint)
    if (stored?.destinationHash) return stored.destinationHash
    if (stored) return this.waitForDestination(stored)

    const descriptor = RHEA_SWAP_CHAIN_CATALOG.find(
      candidate => candidate.apiChainId === String(this.options.network.numericChainId)
    )
    if (!descriptor) {
      throw new Eip1193ProviderError(
        4200,
        'Confidential transfers are unavailable on this network.'
      )
    }
    const catalog = await this.options.service.listTokens({
      direction: 'from',
      tokenListChainIds: [descriptor.tokenListChainId]
    })
    const token = resolveRheaPrivateTransferToken(catalog.tokens, input.tokenContract ?? null)
    if (!token) {
      throw new Eip1193ProviderError(
        4200,
        'This asset is not supported by the Confidential transfer route.'
      )
    }
    const requestedSlippage = this.options.readSlippageBps
      ? await this.options.readSlippageBps().catch(() => undefined)
      : undefined
    const slippageBps =
      Number.isSafeInteger(requestedSlippage) &&
      requestedSlippage! >= 0 &&
      requestedSlippage! <= 5_000
        ? requestedSlippage!
        : DEFAULT_SLIPPAGE_BPS
    const quote = await this.options.service.quote({
      fromChain: token.rheaChainId,
      toChain: token.rheaChainId,
      tokenIn: { chain: token.rheaChainId, address: token.rheaAddress },
      tokenOut: { chain: token.rheaChainId, address: token.rheaAddress },
      amountIn: input.intent.amountRaw,
      slippageBps,
      sender: input.account.address,
      recipient: input.intent.recipient,
      confidentiality: 'basic'
    })
    const review = await this.options.service.prepare(quote.quoteHandle)
    if (review.execution.kind !== 'evm-signature' && review.execution.kind !== 'evm-transaction') {
      await this.options.service.discard(quote.quoteHandle).catch(() => {})
      throw new Eip1193ProviderError(
        4200,
        'The Confidential route cannot be signed by this wallet.'
      )
    }
    const sourceTarget =
      review.execution.kind === 'evm-signature' ? input.account.address : review.execution.target
    if (!sourceTarget) throw new Error('Confidential transfer route has no source target')
    const binding = parseRheaSwapTransactionBinding({
      schemaVersion: 1,
      provider: 'rhea-cross-chain-dex',
      kind: 'swap',
      userAction: 'transfer',
      quoteHandle: quote.quoteHandle,
      executionId: review.executionId,
      router: review.router,
      sourceTarget,
      sender: input.account.address,
      originAmountRaw: review.amountIn,
      expiresAt: quote.expiresAt ?? quote.receivedAt + 30_000,
      // Confidential settlement crosses the Intents boundary even for same-chain assets.
      isCrossChain: true,
      origin: {
        chainId: input.chainId,
        assetId: input.intent.assetId,
        protocolChainId: token.rheaChainId,
        protocolAssetId: token.assetId
      },
      destination: {
        chainId: input.chainId,
        assetId: input.intent.assetId,
        protocolChainId: token.rheaChainId,
        protocolAssetId: token.assetId,
        recipient: input.intent.recipient,
        expectedAmountRaw: quote.estimatedOut,
        minimumAmountRaw: quote.minAmountOut
      }
    })
    const executionAccount: PeaEvmExecutionAccount = Object.freeze({
      kind: 'pea',
      address: input.account.address,
      addressIndex: input.account.addressIndex
    })

    let approvalPrepared: Awaited<
      ReturnType<BackgroundEvmTransferController['prepareContractCall']>
    > | null = null
    let routePrepared: Awaited<
      ReturnType<BackgroundEvmTransferController['prepareContractCall']>
    > | null = null
    let signatureReview: Awaited<ReturnType<RheaSwapEvmSignatureCoordinator['prepare']>> | null =
      null
    let executionStarted = false
    try {
      const plan =
        review.execution.kind === 'evm-transaction'
          ? await this.options.service.readEvmTransactionPlan(quote.quoteHandle)
          : null
      const signaturePlan =
        review.execution.kind === 'evm-signature'
          ? await this.options.service.readEvmSignaturePlan(quote.quoteHandle)
          : null
      const approvalCall = plan?.approval ?? signaturePlan?.approval ?? null
      if (approvalCall) {
        approvalPrepared = await this.options.transferController.prepareContractCall(
          {
            chainId: input.chainId,
            contractAddress: approvalCall.transaction.to,
            valueRaw: approvalCall.transaction.value,
            calldata: approvalCall.transaction.data
          },
          undefined,
          undefined,
          executionAccount
        )
      }
      if (plan && !approvalCall) {
        routePrepared = await this.options.transferController.prepareContractCall(
          {
            chainId: input.chainId,
            contractAddress: plan.transaction.to,
            valueRaw: plan.transaction.value,
            calldata: plan.transaction.data
          },
          undefined,
          binding,
          executionAccount
        )
      }
      if (signaturePlan && !approvalCall) {
        signatureReview = await this.options.signatureCoordinator.prepare(
          quote.quoteHandle,
          binding,
          'private'
        )
      }
      const decision = await this.options.approval.requestExternalApproval(
        input.origin,
        'evmPrivateTransfer',
        {
          chainId: this.options.network.numericChainId,
          chainName: this.options.network.displayName,
          iconChain: this.options.network.iconChain,
          sourceAddress: input.account.address,
          recipient: input.intent.recipient,
          asset: { symbol: token.symbol, decimals: token.decimals },
          amountRaw: input.intent.amountRaw,
          estimatedOutputRaw: quote.estimatedOut,
          minimumOutputRaw: quote.minAmountOut,
          router: review.router,
          expiresAt: binding.expiresAt,
          approvalRequired: approvalPrepared !== null,
          ...metadata(input)
        }
      )
      if (!decision.approved) {
        throw new Eip1193ProviderError(4001, 'User rejected the Confidential transfer request.')
      }
      await input.ensureIdentity()
      const storedSubmission = parseStoredSubmission({
        schemaVersion: 1,
        fingerprint,
        quoteHandle: quote.quoteHandle,
        destinationHash: null,
        expiresAt: this.now() + SUBMISSION_CACHE_MS
      })
      // Persist the request identity before the first irreversible action. If
      // the worker stops after signing or broadcast, a dApp retry waits for
      // this quote instead of creating a second debit.
      await this.store.put(storedSubmission)
      executionStarted = true
      if (approvalPrepared) {
        await this.options.transferController.approveForDApp(
          approvalPrepared.graph.root.id,
          approvalPrepared.review.payloadFingerprint.digestHex,
          async () => input.ensureIdentity()
        )
        approvalPrepared = null
        await input.ensureIdentity()
        if (plan) {
          routePrepared = await this.options.transferController.prepareContractCall(
            {
              chainId: input.chainId,
              contractAddress: plan.transaction.to,
              valueRaw: plan.transaction.value,
              calldata: plan.transaction.data
            },
            undefined,
            binding,
            executionAccount
          )
        } else if (signaturePlan) {
          signatureReview = await this.options.signatureCoordinator.prepare(
            quote.quoteHandle,
            binding,
            'private'
          )
        }
      }
      await input.ensureIdentity()
      let submission: RheaSwapSubmissionView
      if (signatureReview) {
        const result = await this.options.signatureCoordinator.confirm(
          signatureReview.quoteHandle,
          signatureReview.payloadFingerprint
        )
        submission = result.submission
        signatureReview = null
      } else if (routePrepared) {
        const result = await this.options.transferController.approveForDApp(
          routePrepared.graph.root.id,
          routePrepared.review.payloadFingerprint.digestHex,
          async () => input.ensureIdentity()
        )
        routePrepared = null
        const sourceHash = result.graph.segments.find(segment => segment.role === 'origin')
          ?.evidence?.transactionHash
        if (!sourceHash) throw new Error('Confidential transfer source hash is unavailable')
        submission = await this.options.service.recordTransactionSubmission(
          quote.quoteHandle,
          sourceHash
        )
        await this.options.service.reportSubmission(quote.quoteHandle).catch(() => {})
      } else {
        throw new Error('Confidential transfer execution is unavailable')
      }
      if (!submission.orderId) throw new Error('Confidential transfer has no settlement order')
      return this.waitForDestination(storedSubmission)
    } finally {
      // Once approval, signing, or broadcast can have started, retain the
      // fingerprint and prepared graph. A retry must observe the same order;
      // deleting them here could create a second debit after an ambiguous
      // extension-worker or provider response.
      if (!executionStarted) {
        await this.store.delete(fingerprint).catch(() => {})
        if (approvalPrepared) {
          await this.options.transferController
            .reject(approvalPrepared.graph.root.id)
            .catch(() => {})
        }
        if (routePrepared) {
          await this.options.transferController.reject(routePrepared.graph.root.id).catch(() => {})
        }
        if (signatureReview) {
          await this.options.signatureCoordinator
            .cancel(signatureReview.quoteHandle)
            .catch(() => {})
        }
        await this.options.service.discard(quote.quoteHandle).catch(() => {})
      }
    }
  }

  private async waitForDestination(submission: StoredSubmission): Promise<string> {
    const deadline = this.now() + this.waitMs
    while (this.now() < deadline) {
      const status = await this.options.service
        .getOrderStatus(submission.quoteHandle)
        .catch(() => null)
      if (status?.destinationHash && status.status === 'completed') {
        const completed = parseStoredSubmission({
          ...submission,
          destinationHash: status.destinationHash,
          expiresAt: this.now() + COMPLETED_CACHE_MS
        })
        await this.store.put(completed)
        return status.destinationHash
      }
      if (
        status &&
        (status.status === 'failed' || status.status === 'refunded' || status.status === 'expired')
      ) {
        await this.store.delete(submission.fingerprint)
        throw new Eip1193ProviderError(
          -32000,
          `The Confidential transfer ${status.status}. Check Wallet Activity for details.`
        )
      }
      await this.sleep(Math.min(this.pollMs, Math.max(0, deadline - this.now())))
    }
    throw new Eip1193ProviderError(
      -32000,
      'The Confidential transfer was submitted and is still processing. Check Wallet Activity for its final status.'
    )
  }
}
