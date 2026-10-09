import { NOIR_SWAP_REFERRAL, type ConfidentialFundingNetworkConfig } from '@/config/intents'
import { readRheaDestinationHash } from '@/core/services/rhea-swap/rhea-order-status'
import type {
  ConfidentialQuote,
  ConfidentialSignedPayload
} from '@/core/services/confidential-funding'

const REQUEST_TIMEOUT_MS = 30_000
const INTENTS_CONTRACT = 'intents.near'
const VERSIONED_NONCE_PREFIX = new Uint8Array([86, 40, 246, 198])

export interface ConfidentialSession {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly refreshExpiresAt: number
}

export interface ConfidentialBalance {
  readonly tokenId: string
  readonly available: string
  readonly source: string
}

export interface ConfidentialStatus {
  readonly status: string
  readonly transactionHash?: string
  readonly errorStatus?: string
  readonly amountOutRaw?: string
}

export class ConfidentialFundingApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly ambiguous: boolean
  ) {
    super(message)
    this.name = 'ConfidentialFundingApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing`)
  return value.trim()
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveRaw(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function optionalRaw(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined
}

function base64Encode(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function parseQuote(value: unknown): ConfidentialQuote {
  if (!isRecord(value) || !isRecord(value.quote) || !isRecord(value.quoteRequest)) {
    throw new Error('Confidential quote response is invalid')
  }
  const quote = value.quote
  const deadline =
    optionalString(quote, 'deadline') ??
    optionalString(quote, 'timeWhenInactive') ??
    optionalString(value.quoteRequest, 'deadline')
  if (!deadline || !Number.isFinite(Date.parse(deadline))) {
    throw new Error('Confidential quote deadline is invalid')
  }
  return Object.freeze({
    correlationId: requiredString(value, 'correlationId', 'Confidential correlation ID'),
    quoteRequest: Object.freeze({ ...value.quoteRequest }),
    quote: Object.freeze({
      amountIn: positiveRaw(quote.amountIn, 'Confidential input amount'),
      amountOut: positiveRaw(quote.amountOut, 'Confidential output amount'),
      minAmountOut: positiveRaw(
        quote.minAmountOut ?? quote.amountOut,
        'Confidential minimum output'
      ),
      depositAddress: optionalString(quote, 'depositAddress') ?? '',
      deadline
    })
  })
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    throw new ConfidentialFundingApiError(
      response.ok
        ? 'Confidential service returned invalid data'
        : `Confidential request failed (${response.status})`,
      response.status,
      false
    )
  }
  if (!response.ok) {
    const message = isRecord(body)
      ? (optionalString(body, 'message') ??
        optionalString(body, 'msg') ??
        optionalString(body, 'error'))
      : undefined
    throw new ConfidentialFundingApiError(
      message ?? `Confidential request failed (${response.status})`,
      response.status,
      false
    )
  }
  if (isRecord(body) && typeof body.code === 'number') {
    if (body.code !== 0) {
      throw new ConfidentialFundingApiError(
        optionalString(body, 'msg') ??
          optionalString(body, 'message') ??
          'Confidential request failed',
        response.status,
        false
      )
    }
    return body.data
  }
  return body
}

async function requestJson(
  url: string,
  init: RequestInit = {},
  accessToken?: string
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const signal = init.signal
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers
      }
    })
    return await readJson(response)
  } catch (error) {
    if (error instanceof ConfidentialFundingApiError) throw error
    throw new ConfidentialFundingApiError(
      'Confidential service is temporarily unavailable',
      null,
      true
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function parseSession(value: unknown, previous?: ConfidentialSession): ConfidentialSession {
  if (!isRecord(value)) throw new Error('Confidential session response is invalid')
  const expiresIn = Number(value.expiresIn)
  const refreshExpiresIn = Number(value.refreshExpiresIn)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Confidential access token expiry is invalid')
  }
  const now = Date.now()
  return Object.freeze({
    accessToken: requiredString(value, 'accessToken', 'Confidential access token'),
    refreshToken: optionalString(value, 'refreshToken') ?? previous?.refreshToken ?? '',
    expiresAt: now + expiresIn * 1_000,
    refreshExpiresAt:
      Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
        ? now + refreshExpiresIn * 1_000
        : (previous?.refreshExpiresAt ?? 0)
  })
}

export class ConfidentialFundingApi {
  constructor(
    private readonly config: ConfidentialFundingNetworkConfig,
    private readonly nearRpcUrl: string,
    private readonly rheaAccessToken: string
  ) {}

  private oneClickUrl(path: string): string {
    return `${this.config.oneClickApiUrl}${path}`
  }

  async createAuthPayload(
    signerId: string
  ): Promise<Readonly<{ standard: 'erc191'; payload: string }>> {
    const response = await requestJson(this.nearRpcUrl, {
      method: 'POST',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'confidential-auth-salt',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: INTENTS_CONTRACT,
          method_name: 'current_salt',
          args_base64: 'e30='
        }
      })
    })
    if (
      !isRecord(response) ||
      !isRecord(response.result) ||
      !Array.isArray(response.result.result)
    ) {
      throw new Error('NEAR Intents nonce salt response is invalid')
    }
    const encoded = String.fromCharCode(...response.result.result.map(Number))
    const saltHex = JSON.parse(encoded) as unknown
    if (typeof saltHex !== 'string' || !/^[0-9a-fA-F]{8}$/.test(saltHex)) {
      throw new Error('NEAR Intents nonce salt is invalid')
    }
    const now = new Date()
    const deadline = new Date(now.getTime() + 5 * 60_000)
    const nonce = new Uint8Array(32)
    nonce.set(VERSIONED_NONCE_PREFIX, 0)
    nonce[4] = 0
    nonce.set(
      Uint8Array.from(saltHex.match(/.{2}/g) ?? [], byte => Number.parseInt(byte, 16)),
      5
    )
    new DataView(nonce.buffer).setBigUint64(9, BigInt(deadline.getTime()) * 1_000_000n, true)
    const random = new Uint8Array(15)
    crypto.getRandomValues(random)
    new DataView(random.buffer).setBigInt64(0, BigInt(now.getTime()) * 1_000_000n, true)
    nonce.set(random, 17)
    return Object.freeze({
      standard: 'erc191' as const,
      payload: JSON.stringify({
        signer_id: signerId,
        verifying_contract: INTENTS_CONTRACT,
        deadline: deadline.toISOString(),
        nonce: base64Encode(nonce),
        intents: []
      })
    })
  }

  async authenticate(signedData: ConfidentialSignedPayload): Promise<ConfidentialSession> {
    return parseSession(
      await requestJson(this.oneClickUrl('/auth/authenticate'), {
        method: 'POST',
        body: JSON.stringify({ signedData })
      })
    )
  }

  async refresh(session: ConfidentialSession): Promise<ConfidentialSession> {
    return parseSession(
      await requestJson(this.oneClickUrl('/auth/refresh'), {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken })
      }),
      session
    )
  }

  async getBalances(accessToken: string): Promise<readonly ConfidentialBalance[]> {
    const value = await requestJson(this.oneClickUrl('/account/balances'), {}, accessToken)
    if (!isRecord(value) || !Array.isArray(value.balances)) {
      throw new Error('Confidential balances response is invalid')
    }
    return Object.freeze(
      value.balances.flatMap(item => {
        if (!isRecord(item)) return []
        const tokenId = optionalString(item, 'tokenId')
        const available = optionalString(item, 'available')
        if (!tokenId || !available || !/^\d+$/.test(available)) return []
        return [Object.freeze({ tokenId, available, source: optionalString(item, 'source') ?? '' })]
      })
    )
  }

  async quote(input: {
    readonly originAsset: string
    readonly destinationAsset: string
    readonly amountRaw: string
    readonly signerId: string
    readonly recipient: string
    readonly depositType: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
    readonly refundType: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
    readonly recipientType: 'CONFIDENTIAL_INTENTS' | 'DESTINATION_CHAIN'
    readonly slippageBps: number
    readonly dry: boolean
  }): Promise<ConfidentialQuote> {
    const value = await requestJson(this.oneClickUrl('/quote'), {
      method: 'POST',
      body: JSON.stringify({
        dry: input.dry,
        swapType: 'EXACT_INPUT',
        slippageTolerance: input.slippageBps,
        originAsset: input.originAsset,
        depositType: input.depositType,
        destinationAsset: input.destinationAsset,
        amount: input.amountRaw,
        refundTo: input.signerId,
        refundType: input.refundType,
        recipient: input.recipient,
        recipientType: input.recipientType,
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
        referral: NOIR_SWAP_REFERRAL,
        quoteWaitingTimeMs: 0,
        appFees: [{ recipient: 'crosschaindexfee.near', fee: 2 }],
        confidentiality: 'basic'
      })
    })
    return parseQuote(value)
  }

  async generateIntent(input: {
    readonly signerId: string
    readonly depositAddress: string
  }): Promise<Readonly<{ intent: unknown; correlationId: string }>> {
    const value = await requestJson(this.oneClickUrl('/generate-intent'), {
      method: 'POST',
      body: JSON.stringify({
        type: 'swap_transfer',
        standard: 'erc191',
        signerId: input.signerId,
        depositAddress: input.depositAddress
      })
    })
    if (!isRecord(value) || !value.intent)
      throw new Error('Generated confidential intent is invalid')
    return Object.freeze({
      intent: value.intent,
      correlationId: requiredString(value, 'correlationId', 'Confidential correlation ID')
    })
  }

  async submitIntent(
    signedData: ConfidentialSignedPayload,
    accessToken: string
  ): Promise<Readonly<{ intentHash: string; correlationId: string }>> {
    const value = await requestJson(
      this.oneClickUrl('/submit-intent'),
      {
        method: 'POST',
        body: JSON.stringify({ type: 'swap_transfer', signedData })
      },
      accessToken
    )
    if (!isRecord(value)) throw new Error('Submitted confidential intent response is invalid')
    return Object.freeze({
      intentHash: requiredString(value, 'intentHash', 'Confidential intent hash'),
      correlationId: requiredString(value, 'correlationId', 'Confidential correlation ID')
    })
  }

  async getStatus(depositAddress: string, chainId: string): Promise<ConfidentialStatus> {
    if (!this.rheaAccessToken) {
      throw new Error('RHEA Swap is unavailable')
    }
    const query = new URLSearchParams({
      orderId: depositAddress,
      router: 'nearintents',
      chainId
    })
    const value = await requestJson(
      `${this.config.rheaSwapApiUrl}/api/swap/order-status?${query.toString()}`,
      {},
      this.rheaAccessToken
    )
    if (!isRecord(value)) throw new Error('RHEA confidential status response is invalid')
    const details = isRecord(value.swapDetails) ? value.swapDetails : {}
    const transactionHash = readRheaDestinationHash(value)
    const quoteResponse = isRecord(value.quoteResponse) ? value.quoteResponse : {}
    const statusQuote = isRecord(quoteResponse.quote) ? quoteResponse.quote : {}
    const amountOutRaw =
      optionalRaw(details.amountOut) ??
      optionalRaw(details.depositedAmount) ??
      optionalRaw(statusQuote.amountOut)
    return Object.freeze({
      status: requiredString(value, 'status', 'Confidential status'),
      ...(transactionHash ? { transactionHash } : {}),
      ...(amountOutRaw ? { amountOutRaw } : {}),
      ...(optionalString(details, 'refundReason')
        ? { errorStatus: optionalString(details, 'refundReason') }
        : {})
    })
  }
}
