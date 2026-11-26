import type { ActivityItem, ActivityScope } from '@/core/activity'
import { parseAssetId } from '@/core/chains/registry'
import type { TransactionAssetAmount, TransactionGraph } from '@/core/transactions/domain'
import { parseOneClickDepositMemo } from './one-click-order'

export const CONFIDENTIAL_HISTORY_PAGE_SIZE = 100

const PARTY_TYPES = [
  'ORIGIN_CHAIN',
  'DESTINATION_CHAIN',
  'INTENTS',
  'CONFIDENTIAL_INTENTS'
] as const
type PartyType = (typeof PARTY_TYPES)[number]
const STATUS = {
  PENDING_DEPOSIT: 'created',
  INCOMPLETE_DEPOSIT: 'confirming',
  PROCESSING: 'confirming',
  SUCCESS: 'final',
  REFUNDED: 'failed',
  FAILED: 'failed'
} as const

interface HistoryEntry {
  readonly key: string
  readonly depositAddress: string
  readonly status: keyof typeof STATUS
  readonly depositType: PartyType
  readonly recipientType: PartyType
  readonly createdAt: number
  readonly originAsset?: string
  readonly destinationAsset?: string
  readonly amountInFormatted?: string
  readonly amountOutFormatted?: string
  readonly recipient?: string
  readonly deposits: readonly { readonly txHash: string; readonly sender?: string }[]
}

export interface ConfidentialHistoryPage {
  readonly entries: readonly HistoryEntry[]
  readonly prevCursor?: string
}

export function confidentialHistoryOrderKey(depositAddress: string, depositMemo?: string | null) {
  const address = /^0x[0-9a-f]{40}$/i.test(depositAddress)
    ? depositAddress.toLowerCase()
    : depositAddress
  return JSON.stringify([address, depositMemo ?? null])
}

export function collectConfidentialHistoryOrderKeys(graphs: readonly TransactionGraph[]) {
  const keys = new Set<string>()
  for (const graph of graphs) {
    const binding = graph.root.intent?.protocol
    if (binding?.provider === 'near-intents') {
      keys.add(confidentialHistoryOrderKey(binding.depositAddress, binding.depositMemo))
    }
  }
  return keys
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown, max = 256): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : undefined
}

function partyType(value: unknown, excluded: PartyType): PartyType | undefined {
  return PARTY_TYPES.find(type => type === value && type !== excluded)
}

function parseEntry(value: unknown): HistoryEntry | undefined {
  const row = record(value)
  if (!row) return undefined
  const depositAddress = text(row.depositAddress, 160)
  const depositType = partyType(row.depositType, 'DESTINATION_CHAIN')
  const recipientType = partyType(row.recipientType, 'ORIGIN_CHAIN')
  const refundType = partyType(row.refundType, 'DESTINATION_CHAIN')
  const timestamp = text(row.createdAt, 64)
  const createdAt = timestamp && /^\d{4}-\d\d-\d\dT/.test(timestamp) ? Date.parse(timestamp) : NaN
  const status = Object.keys(STATUS).find(key => key === row.status) as
    | keyof typeof STATUS
    | undefined
  if (
    !depositAddress ||
    !depositType ||
    !recipientType ||
    !refundType ||
    !status ||
    !Number.isSafeInteger(createdAt) ||
    createdAt < 0
  )
    return undefined
  if (
    depositType !== 'CONFIDENTIAL_INTENTS' &&
    recipientType !== 'CONFIDENTIAL_INTENTS' &&
    !(status === 'REFUNDED' && refundType === 'CONFIDENTIAL_INTENTS')
  )
    return undefined
  const depositMemo =
    row.depositMemo == null ? undefined : parseOneClickDepositMemo(row.depositMemo)
  const key = confidentialHistoryOrderKey(depositAddress, depositMemo)
  if (key.length > 460) return undefined
  const deposits = Array.isArray(row.quoteTransactions)
    ? row.quoteTransactions.slice(0, 8).flatMap(value => {
        const deposit = record(value)
        const txHash = text(deposit?.txHash, 128)
        return txHash && /^[a-zA-Z0-9]+$/.test(txHash)
          ? [{ txHash, sender: text(deposit?.sender) }]
          : []
      })
    : []
  return {
    key,
    depositAddress,
    status,
    depositType,
    recipientType,
    createdAt,
    originAsset: text(row.originAsset),
    destinationAsset: text(row.destinationAsset),
    amountInFormatted: text(row.amountInFormatted, 80),
    amountOutFormatted: text(row.amountOutFormatted, 80),
    recipient: text(row.recipient),
    deposits
  }
}

export function parseConfidentialHistoryPage(value: unknown): ConfidentialHistoryPage {
  const page = record(value)
  if (!page || !Array.isArray(page.items) || page.items.length > CONFIDENTIAL_HISTORY_PAGE_SIZE) {
    throw new Error('Invalid Confidential history page')
  }
  const entries = page.items.flatMap(value => {
    try {
      const entry = parseEntry(value)
      return entry ? [entry] : []
    } catch {
      return []
    }
  })
  return {
    entries,
    ...(page.items.length === CONFIDENTIAL_HISTORY_PAGE_SIZE
      ? { prevCursor: text(page.prevCursor, 2048) }
      : {})
  }
}

interface HistoryAsset {
  readonly assetId: string
  readonly decimals: number
}

function amount(
  asset: HistoryAsset | undefined,
  formatted?: string
): TransactionAssetAmount | undefined {
  if (!asset || !formatted || !/^\d+(?:\.\d+)?$/.test(formatted)) return undefined
  const [whole, fraction = ''] = formatted.split('.')
  if (fraction.length > asset.decimals || asset.decimals > 77 || asset.decimals < 0)
    return undefined
  const amountRaw = `${whole}${fraction.padEnd(asset.decimals, '0')}`.replace(/^0+(?=\d)/, '')
  if (amountRaw.length > 78) return undefined
  return { assetId: parseAssetId(asset.assetId).id, amountRaw }
}

export function projectConfidentialHistoryEntry(
  entry: HistoryEntry,
  scope: ActivityScope,
  assets: ReadonlyMap<string, HistoryAsset>
): ActivityItem {
  const id = `history:confidential:${entry.key}`
  const origin = entry.originAsset ? assets.get(entry.originAsset) : undefined
  const destination = entry.destinationAsset ? assets.get(entry.destinationAsset) : undefined
  const originChain = origin ? parseAssetId(origin.assetId).chainId : undefined
  const destinationChain = destination ? parseAssetId(destination.assetId).chainId : undefined
  const status = STATUS[entry.status]
  const failureCode =
    entry.status === 'REFUNDED' ? 'refunded' : status === 'failed' ? 'unknown' : undefined
  const entering =
    entry.depositType !== 'CONFIDENTIAL_INTENTS' && entry.recipientType === 'CONFIDENTIAL_INTENTS'
  const leaving =
    entry.depositType === 'CONFIDENTIAL_INTENTS' && entry.recipientType === 'DESTINATION_CHAIN'
  const inputAmount = amount(origin, entry.amountInFormatted)
  const outputAmount = amount(destination, entry.amountOutFormatted)
  const primaryAmount = status === 'failed' ? undefined : entering ? outputAmount : inputAmount
  const counterAmount = entering ? inputAmount : outputAmount
  const sender = entry.deposits.find(deposit => deposit.sender)?.sender
  return {
    id,
    scope,
    source: 'confidential-history',
    status,
    kind: entering ? 'shield' : leaving ? 'withdraw' : 'transfer',
    snapshot: {
      schemaVersion: 1,
      direction: entering ? 'incoming' : leaving ? 'outgoing' : 'contract',
      ...(primaryAmount ? { primaryAmount } : {}),
      ...(counterAmount ? { counterAmount } : {}),
      ...(sender && originChain && entry.depositType === 'ORIGIN_CHAIN'
        ? { sender: { chainId: originChain, address: sender } }
        : {}),
      ...(entry.recipient && destinationChain && entry.recipientType === 'DESTINATION_CHAIN'
        ? { recipient: { chainId: destinationChain, address: entry.recipient } }
        : {})
    },
    segments: [
      {
        id: `${id}:relay`,
        role: 'relay',
        target: {
          kind: 'protocol',
          provider: 'Confidential Intents',
          account: entry.depositAddress
        },
        status,
        ...(failureCode ? { failureCode } : {})
      },
      ...(originChain && entry.depositType === 'ORIGIN_CHAIN'
        ? entry.deposits.map((deposit, index) => ({
            id: `${id}:origin:${index}`,
            role: 'origin' as const,
            target: { kind: 'onchain' as const, chainId: originChain },
            status: 'confirming' as const,
            evidence: { transactionHash: deposit.txHash }
          }))
        : [])
    ],
    completeness: 'partial',
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    ...(failureCode ? { failureCode } : {})
  }
}
