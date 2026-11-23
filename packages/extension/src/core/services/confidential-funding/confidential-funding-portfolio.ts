import Big from '@/lib/big'
import { formatBaseUnitDecimalAmount } from '@/lib/number-format'
import type {
  PortfolioAssetView,
  PortfolioReadModel,
  ConfidentialPortfolioView
} from '@/core/portfolio'
import type { AssetRegistry } from '@/core/chains/registry'
import { getZcashChainId } from '@/core/chains/registry'
import type { SwapToken } from '@/core/services/intents-api'
import { isDeprecatedIntentsToken } from '@/core/services/intents-evm-assets'
import type { IntentsManagedAsset } from '@/core/services/intents-managed-assets'
import type { Network } from '@/types'

export interface ConfidentialPortfolioBalance {
  readonly tokenId: string
  readonly available: string
}

export interface ConfidentialPortfolioAssetMapping {
  readonly assetId: string
  readonly protocolAssetId: string
}

export function filterConfidentialPortfolioMappings(
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  network: Network
): readonly ConfidentialPortfolioAssetMapping[] {
  const zcashAssetId = `${getZcashChainId(network)}/slip44:133`
  return mappings.filter(
    mapping => mapping.assetId.startsWith('eip155:') || mapping.assetId === zcashAssetId
  )
}

// Mainnet uses this shared treasury namespace; arbitrary IMT suffix matches are not equivalent assets.
// https://docs.near-intents.org/integration/market-makers/confidential-intents
export const CONFIDENTIAL_PRIVATE_TREASURY_ACCOUNT_ID =
  '51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe'

export function confidentialPrivateTokenId(protocolAssetId: string): string {
  return `imt:${CONFIDENTIAL_PRIVATE_TREASURY_ACCOUNT_ID}:${protocolAssetId}`
}

export function getConfidentialAvailableForAsset(
  balances: readonly ConfidentialPortfolioBalance[],
  protocolAssetId: string
): string | null {
  const row =
    balances.find(balance => balance.tokenId === confidentialPrivateTokenId(protocolAssetId)) ??
    balances.find(balance => balance.tokenId === protocolAssetId)
  return row && /^(0|[1-9][0-9]*)$/.test(row.available) ? row.available : null
}

export function buildConfidentialPortfolioView(
  balances: readonly ConfidentialPortfolioBalance[],
  tokens: readonly SwapToken[],
  managedAssets: readonly IntentsManagedAsset[],
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  assets: AssetRegistry
): ConfidentialPortfolioView {
  const treasuryPrefix = `imt:${CONFIDENTIAL_PRIVATE_TREASURY_ACCOUNT_ID}:`
  const byProtocolId = new Map<
    string,
    { balance: ConfidentialPortfolioBalance; priority: number }
  >()
  for (const balance of balances) {
    if (!/^(0|[1-9][0-9]*)$/.test(balance.available)) {
      throw new Error('Invalid Confidential balance')
    }
    const verifiedImt = balance.tokenId.startsWith(treasuryPrefix)
    const protocolAssetId = verifiedImt
      ? balance.tokenId.slice(treasuryPrefix.length)
      : balance.tokenId
    if (!protocolAssetId) throw new Error('Invalid Confidential token ID')
    const priority = verifiedImt ? 1 : 0
    const previous = byProtocolId.get(protocolAssetId)
    if (previous && previous.priority === priority) {
      throw new Error('Duplicate Confidential balance')
    }
    if (!previous || priority > previous.priority)
      byProtocolId.set(protocolAssetId, { balance, priority })
  }

  const tokenById = new Map(tokens.map(token => [token.assetId, token]))
  const managedById = new Map(managedAssets.map(asset => [asset.protocolAssetId, asset]))
  const mappedById = new Map(mappings.map(mapping => [mapping.protocolAssetId, mapping.assetId]))
  const entries = [...byProtocolId].flatMap(([protocolAssetId, { balance }]) => {
    if (balance.available === '0') return []
    const token = tokenById.get(protocolAssetId)
    if (isDeprecatedIntentsToken({ assetId: protocolAssetId, symbol: token?.symbol })) return []
    const managed = managedById.get(protocolAssetId)
    const mappedAssetId = mappedById.get(protocolAssetId)
    const registered = mappedAssetId ? assets.get(mappedAssetId) : undefined
    const assetId = managed?.assetId ?? registered?.asset.id
    const chainId = managed?.chainId ?? registered?.asset.chainId
    const bundledMetadata =
      token &&
      registered?.source === 'bundled' &&
      assetId === registered.asset.id &&
      token.decimals === registered.metadata.decimals
        ? registered.metadata
        : null
    const iconUrl = token ? (token.icon ?? token.coingeckoIcon ?? undefined) : undefined
    const priceUsd = token && token.price > 0 ? new Big(token.price).toFixed() : undefined
    return [
      Object.freeze({
        tokenId: balance.tokenId,
        protocolAssetId,
        availableRaw: balance.available,
        ...(assetId ? { assetId } : {}),
        ...(chainId ? { chainId } : {}),
        ...(token
          ? {
              blockchain: token.blockchain,
              symbol: bundledMetadata?.symbol ?? token.symbol,
              name: bundledMetadata?.name ?? token.symbol,
              decimals: token.decimals,
              ...(iconUrl ? { iconUrl } : {}),
              ...(token.coingeckoId ? { coingeckoId: token.coingeckoId } : {}),
              ...(priceUsd && priceUsd.length <= 128
                ? {
                    priceUsd,
                    priceUpdatedAt: token.priceUpdatedAt
                  }
                : {})
            }
          : {})
      })
    ]
  })
  return Object.freeze({ status: 'ready', assets: Object.freeze(entries) })
}

export interface ShieldDappBalance {
  readonly symbol: string
  readonly chainId: string
  readonly chainName: string
  readonly assetId: string
  readonly amount: string
}

/** Public balance rows for a dApp. Amounts are decimal strings, not raw base units. */
export function projectShieldDappBalances(
  view: ConfidentialPortfolioView,
  chainNameFor: (chainId: string) => string
): readonly ShieldDappBalance[] {
  const rows = view.assets.map(asset => {
    const chainId = asset.chainId ?? ''
    const amount =
      asset.decimals === undefined
        ? asset.availableRaw
        : formatBaseUnitDecimalAmount(asset.availableRaw, asset.decimals)
    return Object.freeze({
      symbol: asset.symbol && asset.symbol.length > 0 ? asset.symbol : asset.protocolAssetId,
      chainId,
      chainName: chainId.length > 0 ? chainNameFor(chainId) : '',
      assetId: asset.assetId ?? asset.protocolAssetId,
      amount
    })
  })
  rows.sort((left, right) => {
    const leftKey = `${left.symbol}:${left.chainName}`
    const rightKey = `${right.symbol}:${right.chainName}`
    if (leftKey < rightKey) return -1
    if (leftKey > rightKey) return 1
    return 0
  })
  return Object.freeze(rows)
}

export interface ShieldDappChain {
  readonly chainId: string
  readonly name: string
}

export interface ShieldDappToken {
  readonly chainId: string
  readonly assetId: string
  readonly symbol: string
  readonly decimals: number
}

/**
 * Destination chain keeps the source token. A shared identity wins over the
 * symbol. Without an identity, the symbol is used only when it is unique.
 */
export function selectShieldSameTokenAsset(input: {
  readonly sourceAssetId: string
  readonly sourceSymbol: string
  readonly destinationChainId: string
  readonly tokens: readonly ShieldDappToken[]
  readonly identityFor: (assetId: string) => string | null
}): ShieldDappToken | null {
  const onChain = input.tokens.filter(token => token.chainId === input.destinationChainId)
  const source = onChain.find(token => token.assetId === input.sourceAssetId)
  if (source) return source
  const sourceIdentity = input.identityFor(input.sourceAssetId)
  if (sourceIdentity) {
    const matches = onChain.filter(token => input.identityFor(token.assetId) === sourceIdentity)
    return matches.length === 1 ? matches[0] : null
  }
  const symbols = onChain.filter(token => token.symbol === input.sourceSymbol)
  return symbols.length === 1 ? symbols[0] : null
}

interface CatalogAsset {
  readonly asset: {
    readonly chainId: string
    readonly kind: string
  }
  readonly metadata: {
    readonly decimals: number
  }
}

function compareCodePoint(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/**
 * Shield funding candidates already used by the wallet: managed EVM tokens,
 * plus mapped native EVM assets and ZEC. Route quotes are not evaluated here.
 */
export function projectShieldDappCatalog(input: {
  readonly tokens: readonly SwapToken[]
  readonly managedAssets: readonly IntentsManagedAsset[]
  readonly mappings: readonly ConfidentialPortfolioAssetMapping[]
  readonly assets: { readonly get: (assetId: string) => CatalogAsset | undefined }
  readonly network: Network
  readonly acceptChain: (chainId: string) => boolean
  readonly chainNameFor: (chainId: string) => string
}): Readonly<{ chains: readonly ShieldDappChain[]; tokens: readonly ShieldDappToken[] }> {
  const tokenById = new Map(input.tokens.map(token => [token.assetId, token]))
  const zcashChainId = getZcashChainId(input.network)
  const seen = new Set<string>()
  const rows: ShieldDappToken[] = []
  const push = (row: ShieldDappToken, protocolAssetId: string) => {
    if (seen.has(protocolAssetId) || !input.acceptChain(row.chainId)) return
    if (!Number.isInteger(row.decimals) || row.decimals < 0 || row.decimals > 255) return
    if (row.symbol.trim().length === 0 || row.assetId.length === 0 || row.chainId.length === 0) {
      return
    }
    seen.add(protocolAssetId)
    rows.push(
      Object.freeze({
        chainId: row.chainId,
        assetId: row.assetId,
        symbol: row.symbol.trim(),
        decimals: row.decimals
      })
    )
  }
  for (const managed of input.managedAssets) {
    if (managed.management !== 'evm') continue
    const token = tokenById.get(managed.protocolAssetId)
    if (!token || token.decimals !== managed.decimals || token.blockchain !== managed.blockchain) {
      continue
    }
    push(
      {
        chainId: managed.chainId,
        assetId: managed.assetId,
        symbol: token.symbol,
        decimals: token.decimals
      },
      managed.protocolAssetId
    )
  }
  for (const mapping of input.mappings) {
    const entry = input.assets.get(mapping.assetId)
    const token = tokenById.get(mapping.protocolAssetId)
    if (
      !entry ||
      entry.asset.kind !== 'native' ||
      !(entry.asset.chainId.startsWith('eip155:') || entry.asset.chainId === zcashChainId) ||
      !token ||
      token.decimals !== entry.metadata.decimals
    ) {
      continue
    }
    push(
      {
        chainId: entry.asset.chainId,
        assetId: mapping.assetId,
        symbol: token.symbol,
        decimals: token.decimals
      },
      mapping.protocolAssetId
    )
  }
  rows.sort((left, right) => {
    const symbol = compareCodePoint(left.symbol, right.symbol)
    if (symbol !== 0) return symbol
    const chain = compareCodePoint(left.chainId, right.chainId)
    if (chain !== 0) return chain
    return compareCodePoint(left.assetId, right.assetId)
  })
  const chains = [...new Set(rows.map(row => row.chainId))]
    .sort(compareCodePoint)
    .map(chainId => Object.freeze({ chainId, name: input.chainNameFor(chainId) }))
  return Object.freeze({ chains: Object.freeze(chains), tokens: Object.freeze(rows) })
}

export function projectShieldDappQuote(input: {
  readonly action: 'receive' | 'transfer'
  readonly amountRaw: string
  readonly amountOutRaw: string
  readonly sourceDecimals: number
  readonly destinationDecimals: number
  readonly sameAsset: boolean
  readonly expiresAt: number
  readonly source: Readonly<{ chainId: string; assetId: string; symbol: string }>
  readonly destination: Readonly<{ chainId: string; assetId: string; symbol: string }>
}): Readonly<{
  layer: 'near-confidential'
  action: 'receive' | 'transfer'
  amount: string
  fee: string
  expectedReceive: string
  expiresAt: number
  source: Readonly<{ chainId: string; assetId: string; symbol: string }>
  destination: Readonly<{ chainId: string; assetId: string; symbol: string }>
}> {
  const inputRaw = BigInt(input.amountRaw)
  const outputRaw = BigInt(input.amountOutRaw)
  const feeRaw = input.sameAsset && inputRaw > outputRaw ? (inputRaw - outputRaw).toString() : '0'
  const feeDecimals = input.sameAsset ? input.sourceDecimals : input.destinationDecimals
  return Object.freeze({
    layer: 'near-confidential',
    action: input.action,
    amount: formatBaseUnitDecimalAmount(input.amountRaw, input.sourceDecimals),
    fee: formatBaseUnitDecimalAmount(feeRaw, feeDecimals),
    expectedReceive: formatBaseUnitDecimalAmount(input.amountOutRaw, input.destinationDecimals),
    expiresAt: input.expiresAt,
    source: Object.freeze({ ...input.source }),
    destination: Object.freeze({ ...input.destination })
  })
}

function mergeAsset(
  asset: PortfolioAssetView,
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  balances: readonly ConfidentialPortfolioBalance[],
  snapshot?: Readonly<{ freshness: 'fresh' | 'stale'; updatedAt: number }>
): PortfolioAssetView {
  const mapping = mappings.find(candidate => candidate.assetId === asset.asset.id)
  if (!mapping || asset.balance.mainRaw === undefined || asset.balance.privateRaw === undefined) {
    return asset
  }
  const confidentialRaw = isDeprecatedIntentsToken({ assetId: mapping.protocolAssetId })
    ? '0'
    : (getConfidentialAvailableForAsset(balances, mapping.protocolAssetId) ?? '0')
  const previousConfidential = BigInt(asset.balance.confidentialRaw ?? '0')
  const privateOnchain = BigInt(
    asset.balance.privateOnchainRaw ??
      (BigInt(asset.balance.privateRaw) - previousConfidential).toString()
  )
  const nextConfidential = BigInt(confidentialRaw)
  const delta = nextConfidential - previousConfidential
  const addDelta = (raw: string) => (BigInt(raw) + delta).toString()
  return Object.freeze({
    ...asset,
    ...(snapshot?.freshness === 'stale'
      ? {
          freshness: 'stale' as const,
          updatedAt:
            typeof asset.updatedAt === 'number'
              ? Math.min(asset.updatedAt, snapshot.updatedAt)
              : snapshot.updatedAt
        }
      : {}),
    balance: Object.freeze({
      ...asset.balance,
      totalRaw: addDelta(asset.balance.totalRaw),
      privateRaw: (privateOnchain + nextConfidential).toString(),
      privateOnchainRaw: privateOnchain.toString(),
      confidentialRaw: nextConfidential.toString()
    })
  })
}

export type ShieldDappOperationStatus =
  | 'awaiting-approval'
  | 'needs-auth'
  | 'authorized'
  | 'signing'
  | 'submitting'
  | 'processing'
  | 'awaiting-payment'
  | 'pending-refund'
  | 'ready'
  | 'partial'
  | 'refunded'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'unknown'
  | 'unavailable'

export interface ShieldDappStatusProjection {
  readonly status: ShieldDappOperationStatus
  readonly providerStatus?: string
}

export interface ShieldDappOperationAsset {
  readonly chainId: string
  readonly assetId: string
  readonly symbol?: string
  readonly amount?: string
}

export interface ShieldDappOperationReferences {
  readonly transactionHashes?: readonly string[]
  readonly orderId?: string
}

export interface ShieldDappOperationDetails {
  readonly source?: ShieldDappOperationAsset
  readonly destination?: ShieldDappOperationAsset
  readonly references?: ShieldDappOperationReferences
}

export interface ShieldDappOperationReport {
  readonly id: string
  readonly layer: 'near-confidential'
  readonly action?: 'receive' | 'transfer'
  readonly status: ShieldDappOperationStatus
  readonly providerStatus?: string
  readonly source?: ShieldDappOperationAsset
  readonly destination?: ShieldDappOperationAsset
  readonly references?: ShieldDappOperationReferences
}

const SHIELD_REFUND_IN_PROGRESS = 'PENDING_REFUND'
const SHIELD_SIGNING_PHASES = new Set(['deposit-signed', 'deposit-confirming', 'signing-withdraws'])
const SHIELD_PLAN_TERMINAL = new Set([
  'ready',
  'partial',
  'refunded',
  'failed',
  'expired',
  'cancelled'
])
const SHIELD_DEPOSIT_TERMINAL = new Set(['ready', 'refunded', 'failed'])

function shieldProtocolStatus(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? ''
}

function shieldStatusProjection(
  status: ShieldDappOperationStatus,
  providerStatus: string | undefined
): ShieldDappStatusProjection {
  const text = providerStatus?.trim() ?? ''
  return Object.freeze(text.length > 0 ? { status, providerStatus: text } : { status })
}

/**
 * Public status for a stored confidential plan.
 * Internal phase names stay in the wallet. PENDING_REFUND is pending only before a terminal phase.
 */
export function projectShieldDappPlanStatus(plan: {
  readonly phase: string
  readonly backendStatus?: string
  readonly errorStatus?: string
}): ShieldDappStatusProjection {
  const providerStatus = plan.backendStatus ?? plan.errorStatus
  if (
    shieldProtocolStatus(plan.backendStatus) === SHIELD_REFUND_IN_PROGRESS &&
    !SHIELD_PLAN_TERMINAL.has(plan.phase)
  ) {
    return shieldStatusProjection('pending-refund', providerStatus)
  }
  if (plan.phase === 'prepared') return Object.freeze({ status: 'awaiting-approval' })
  if (plan.phase === 'needs-auth') return Object.freeze({ status: 'needs-auth' })
  if (plan.phase === 'authorized') return Object.freeze({ status: 'authorized' })
  if (SHIELD_SIGNING_PHASES.has(plan.phase))
    return shieldStatusProjection('signing', providerStatus)
  switch (plan.phase) {
    case 'submitting':
      return shieldStatusProjection('submitting', providerStatus)
    case 'processing':
      return shieldStatusProjection('processing', providerStatus)
    case 'partial':
      return shieldStatusProjection('partial', providerStatus)
    case 'ready':
      return shieldStatusProjection('ready', providerStatus)
    case 'refunded':
      return shieldStatusProjection('refunded', providerStatus)
    case 'failed':
      return shieldStatusProjection('failed', providerStatus)
    case 'expired':
      return shieldStatusProjection('expired', providerStatus)
    case 'cancelled':
      return shieldStatusProjection('cancelled', providerStatus)
    default:
      return shieldStatusProjection('unknown', providerStatus)
  }
}

/**
 * Public status for an external Shield deposit.
 * A protocol EXPIRED observation stays on awaiting-payment.
 */
export function projectShieldDappDepositStatus(record: {
  readonly phase: string
  readonly providerStatus?: string
}): ShieldDappStatusProjection {
  const providerStatus = record.providerStatus
  if (
    shieldProtocolStatus(providerStatus) === SHIELD_REFUND_IN_PROGRESS &&
    !SHIELD_DEPOSIT_TERMINAL.has(record.phase)
  ) {
    return shieldStatusProjection('pending-refund', providerStatus)
  }
  switch (record.phase) {
    case 'awaiting-payment':
      return shieldStatusProjection('awaiting-payment', providerStatus)
    case 'processing':
      return shieldStatusProjection('processing', providerStatus)
    case 'ready':
      return shieldStatusProjection('ready', providerStatus)
    case 'refunded':
      return shieldStatusProjection('refunded', providerStatus)
    case 'failed':
      return shieldStatusProjection('failed', providerStatus)
    default:
      return shieldStatusProjection('unknown', providerStatus)
  }
}

export function shieldDappPlanAction(plan: {
  readonly operation?: 'deposit' | 'withdraw' | 'cluster' | 'swap' | 'confidential-transfer'
  readonly sourceDomain?: 'public' | 'private' | 'shield'
  readonly destinationDomain?: 'public' | 'private' | 'shield'
}): 'receive' | 'transfer' {
  if (plan.operation === 'deposit') return 'receive'
  if (
    plan.operation === 'withdraw' ||
    plan.operation === 'swap' ||
    plan.operation === 'cluster' ||
    plan.operation === 'confidential-transfer'
  ) {
    return 'transfer'
  }
  if (plan.destinationDomain === 'shield' && plan.sourceDomain !== 'shield') return 'receive'
  return 'transfer'
}

function shieldPublicId(value: string | undefined, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !/\s/.test(value)
  )
}

function shieldDisplayAmount(
  amountRaw: string | undefined,
  decimals: number | undefined
): string | undefined {
  if (amountRaw === undefined || decimals === undefined) return undefined
  try {
    return formatBaseUnitDecimalAmount(amountRaw, decimals)
  } catch {
    return undefined
  }
}

function shieldOperationAsset(
  input:
    | {
        readonly chainId?: string
        readonly assetId?: string
        readonly amountRaw?: string
        readonly symbol?: string
        readonly decimals?: number
      }
    | undefined
): ShieldDappOperationAsset | undefined {
  if (!input || !shieldPublicId(input.chainId, 128) || !shieldPublicId(input.assetId, 256)) {
    return undefined
  }
  const amount = shieldDisplayAmount(input.amountRaw, input.decimals)
  const symbol =
    typeof input.symbol === 'string' &&
    input.symbol.trim() === input.symbol &&
    input.symbol.length > 0 &&
    input.symbol.length <= 32
      ? input.symbol
      : undefined
  return Object.freeze({
    chainId: input.chainId,
    assetId: input.assetId,
    ...(symbol ? { symbol } : {}),
    ...(amount !== undefined ? { amount } : {})
  })
}

/**
 * Positive same-decimals quote difference. A cross-decimal raw subtraction is not a fee.
 */
export function shieldSameDecimalsQuoteDifferenceRaw(
  sourceAmountRaw: string,
  expectedOutputRaw: string,
  sameDecimals: boolean
): string | null {
  if (!sameDecimals) return null
  if (!/^(0|[1-9][0-9]*)$/.test(sourceAmountRaw) || !/^(0|[1-9][0-9]*)$/.test(expectedOutputRaw)) {
    return null
  }
  const difference = BigInt(sourceAmountRaw) - BigInt(expectedOutputRaw)
  return difference > 0n ? difference.toString() : null
}

/**
 * Public source, destination, and transaction references for one stored Shield operation.
 * Amounts are decimal strings. Missing decimals, chains, or hashes are omitted.
 */
export function projectShieldDappOperationDetails(input: {
  readonly source?: {
    readonly chainId?: string
    readonly assetId?: string
    readonly amountRaw?: string
    readonly symbol?: string
    readonly decimals?: number
  }
  readonly destination?: {
    readonly chainId?: string
    readonly assetId?: string
    readonly amountRaw?: string
    readonly symbol?: string
    readonly decimals?: number
  }
  readonly transactionHashes?: readonly string[]
  readonly orderId?: string
}): ShieldDappOperationDetails {
  const source = shieldOperationAsset(input.source)
  const destination = shieldOperationAsset(input.destination)
  const transactionHashes = Object.freeze([
    ...new Set((input.transactionHashes ?? []).filter(hash => shieldPublicId(hash, 256)))
  ])
  const orderId = shieldPublicId(input.orderId, 128) ? input.orderId : undefined
  const references =
    transactionHashes.length > 0 || orderId
      ? Object.freeze({
          ...(transactionHashes.length > 0 ? { transactionHashes } : {}),
          ...(orderId ? { orderId } : {})
        })
      : undefined
  return Object.freeze({
    ...(source ? { source } : {}),
    ...(destination ? { destination } : {}),
    ...(references ? { references } : {})
  })
}

export function shieldDappOperationReport(
  id: string,
  action: 'receive' | 'transfer' | undefined,
  projection: ShieldDappStatusProjection,
  details?: ShieldDappOperationDetails
): ShieldDappOperationReport {
  return Object.freeze({
    id,
    layer: 'near-confidential',
    ...(action ? { action } : {}),
    status: projection.status,
    ...(projection.providerStatus ? { providerStatus: projection.providerStatus } : {}),
    ...(details?.source ? { source: details.source } : {}),
    ...(details?.destination ? { destination: details.destination } : {}),
    ...(details?.references ? { references: details.references } : {})
  })
}

export function unknownShieldDappOperation(id: string): ShieldDappOperationReport {
  return Object.freeze({
    id,
    layer: 'near-confidential',
    status: 'unknown'
  })
}

export function mergeConfidentialBalancesIntoPortfolio(
  model: PortfolioReadModel,
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  balances: readonly ConfidentialPortfolioBalance[],
  snapshot?: Readonly<{ freshness: 'fresh' | 'stale'; updatedAt: number }>
): PortfolioReadModel {
  const assets = model.assets.map(asset => mergeAsset(asset, mappings, balances, snapshot))
  const byId = new Map(assets.map(asset => [asset.asset.id, asset]))
  const chains = model.chains.map(chain =>
    Object.freeze({
      ...chain,
      assets: Object.freeze(chain.assets.map(asset => byId.get(asset.asset.id) ?? asset)),
      ...(snapshot?.freshness === 'stale' &&
      chain.status === 'ready' &&
      chain.assets.some(asset => byId.get(asset.asset.id)?.freshness === 'stale')
        ? { status: 'partial' as const }
        : {})
    })
  )
  return Object.freeze({
    ...model,
    assets: Object.freeze(assets),
    chains: Object.freeze(chains),
    ...(snapshot?.freshness === 'stale' &&
    model.status === 'ready' &&
    chains.some(chain => chain.status === 'partial')
      ? { status: 'partial' as const }
      : {})
  })
}

export function projectConfidentialOnlyEvmAssets(
  model: PortfolioReadModel,
  confidential: ConfidentialPortfolioView,
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  assets: AssetRegistry
): PortfolioReadModel {
  if (confidential.status !== 'ready') return model
  const existing = new Set<string>(model.assets.map(asset => asset.asset.id))
  const mappedByProtocolId = new Map(
    mappings.map(mapping => [mapping.protocolAssetId, mapping.assetId])
  )
  const holdingCountByAssetId = new Map<string, number>()
  for (const holding of confidential.assets) {
    if (holding.assetId) {
      holdingCountByAssetId.set(
        holding.assetId,
        (holdingCountByAssetId.get(holding.assetId) ?? 0) + 1
      )
    }
  }
  const projected = confidential.assets.flatMap(holding => {
    const assetId = holding.assetId
    if (
      !assetId ||
      existing.has(assetId) ||
      mappedByProtocolId.get(holding.protocolAssetId) !== assetId ||
      holdingCountByAssetId.get(assetId) !== 1 ||
      !assetId.startsWith('eip155:')
    )
      return []
    const entry = assets.get(assetId)
    const chain = model.chains.find(item => item.chain.id === holding.chainId)
    const chainAccountIds = chain?.assets.find(
      asset => asset.chainAccountIds.length > 0
    )?.chainAccountIds
    if (
      !entry ||
      entry.asset.kind !== 'token' ||
      entry.asset.chainId !== holding.chainId ||
      entry.metadata.decimals !== holding.decimals ||
      !chain ||
      chain.chain.family !== 'evm' ||
      (chain.status !== 'ready' && chain.status !== 'partial') ||
      !chainAccountIds
    )
      return []
    existing.add(assetId)
    return [
      Object.freeze({
        asset: entry.asset,
        metadata: entry.metadata,
        source: entry.source,
        balance: Object.freeze({
          totalRaw: holding.availableRaw,
          spendableRaw: '0',
          availableRaw: '0',
          pendingRaw: '0',
          mainRaw: '0',
          privateRaw: holding.availableRaw,
          privateOnchainRaw: '0',
          confidentialRaw: holding.availableRaw
        }),
        chainAccountIds,
        freshness: confidential.freshness === 'stale' ? ('stale' as const) : ('fresh' as const),
        updatedAt: confidential.updatedAt ?? Date.now()
      }) satisfies PortfolioAssetView
    ]
  })
  if (projected.length === 0) return model
  const chains = model.chains.map(chain =>
    Object.freeze({
      ...chain,
      ...(confidential.freshness === 'stale' &&
      chain.status === 'ready' &&
      projected.some(asset => asset.asset.chainId === chain.chain.id)
        ? { status: 'partial' as const }
        : {}),
      assets: Object.freeze([
        ...chain.assets,
        ...projected.filter(asset => asset.asset.chainId === chain.chain.id)
      ])
    })
  )
  return Object.freeze({
    ...model,
    ...(confidential.freshness === 'stale' && model.status === 'ready'
      ? { status: 'partial' as const }
      : {}),
    chains: Object.freeze(chains),
    assets: Object.freeze(chains.flatMap(chain => chain.assets))
  })
}

export function excludeDeprecatedConfidentialAssets(model: PortfolioReadModel): PortfolioReadModel {
  const confidential = model.confidential
  if (!confidential) return model
  const hidden = confidential.assets.filter(asset =>
    isDeprecatedIntentsToken({ assetId: asset.protocolAssetId, symbol: asset.symbol })
  )
  if (hidden.length === 0) return model
  const visible = confidential.assets.filter(asset => !hidden.includes(asset))
  const hiddenMappings = new Map(
    hidden.flatMap(asset =>
      asset.assetId
        ? [
            [
              asset.assetId,
              {
                assetId: asset.assetId,
                protocolAssetId:
                  visible.find(current => current.assetId === asset.assetId)?.protocolAssetId ??
                  asset.protocolAssetId
              }
            ] as const
          ]
        : []
    )
  )
  // Replace only the projected Shield portion; public and private on-chain balances stay intact.
  const projected = mergeConfidentialBalancesIntoPortfolio(
    model,
    [...hiddenMappings.values()],
    visible.map(asset => ({ tokenId: asset.tokenId, available: asset.availableRaw }))
  )
  return Object.freeze({
    ...projected,
    confidential: Object.freeze({ ...confidential, assets: Object.freeze(visible) })
  })
}
