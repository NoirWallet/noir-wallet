import type { ActivityItem, ActivityScope } from '@/core/activity'
import { parseAssetId, parseChainId } from '@/core/chains/registry'
import { FetchResponseTooLargeError, fetchWithTimeout, jsonRequestInit } from '@/lib/fetch-utils'

import { readNearAccountId } from './near-rpc-codecs'

const TRANSFERS_API_ORIGIN = 'https://transfers.main.fastnear.com'
const REQUEST_TIMEOUT_MS = 8_000
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024
const TRANSFERS_PER_DIRECTION = 50

interface NearIndexedTransfer {
  readonly amountRaw: string
  readonly assetReference: 'native' | string | null
  readonly blockHeight: number
  readonly timestamp: number
  readonly otherAccountId: string
  readonly transactionHash: string
  readonly transferIndex: number
  readonly direction: 'incoming' | 'outgoing'
}

export interface NearActivityHistorySource {
  readonly readAddressActivity: (
    input: ReadNearAddressActivityInput
  ) => Promise<readonly ActivityItem[]>
}

export interface ReadNearAddressActivityInput {
  readonly scope: ActivityScope
  readonly address: string
}

export interface NearActivityHistorySourceConfig {
  readonly chainId: string
  readonly fetchImpl?: typeof fetch
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid FastNear transfer response')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Invalid FastNear transfer response')
  }
  return value as Record<string, unknown>
}

function parseRawInteger(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || value.length > 128 || !/^-?(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Invalid FastNear ${label}`)
  }
  return BigInt(value)
}

function parseSafeIntegerString(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Invalid FastNear ${label}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid FastNear ${label}`)
  return parsed
}

function parseSafeUnsignedInteger(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return parseSafeIntegerString(value, label)
}

function parseTransfers(
  value: unknown,
  direction: NearIndexedTransfer['direction']
): readonly NearIndexedTransfer[] {
  const body = readRecord(value)
  if (!Array.isArray(body.transfers) || body.transfers.length > TRANSFERS_PER_DIRECTION) {
    throw new Error('Invalid FastNear transfer response')
  }
  return Object.freeze(
    body.transfers.map(candidate => {
      const transfer = readRecord(candidate)
      const signedAmount = parseRawInteger(transfer.amount, 'transfer amount')
      if (signedAmount === 0n || typeof transfer.asset_id !== 'string') {
        throw new Error('Invalid FastNear transfer response')
      }
      let assetReference: NearIndexedTransfer['assetReference']
      if (transfer.asset_id === 'native:near') {
        assetReference = 'native'
      } else if (transfer.asset_id.startsWith('nep141:')) {
        assetReference = readNearAccountId(
          transfer.asset_id.slice('nep141:'.length),
          'FastNear transfer asset ID'
        )
      } else if (
        transfer.asset_id.startsWith('nep245:') &&
        transfer.asset_id.length <= 256 &&
        !/[\u0000-\u001f\u007f-\u009f]/.test(transfer.asset_id)
      ) {
        assetReference = null
      } else {
        throw new Error('Invalid FastNear transfer asset ID')
      }
      const otherAccountId = readNearAccountId(
        transfer.other_account_id,
        'FastNear transfer counterparty'
      )
      const transactionHashValue = transfer.transaction_id ?? transfer.receipt_id
      if (
        typeof transactionHashValue !== 'string' ||
        transactionHashValue.length === 0 ||
        transactionHashValue.length > 128
      ) {
        throw new Error('Invalid FastNear transfer transaction ID')
      }
      const timestampNanoseconds = parseRawInteger(transfer.block_timestamp, 'transfer timestamp')
      if (timestampNanoseconds < 0n) throw new Error('Invalid FastNear transfer timestamp')
      const timestamp = Number(timestampNanoseconds / 1_000_000n)
      if (!Number.isSafeInteger(timestamp)) throw new Error('Invalid FastNear transfer timestamp')
      return Object.freeze({
        amountRaw: (signedAmount < 0n ? -signedAmount : signedAmount).toString(),
        assetReference,
        blockHeight: parseSafeIntegerString(transfer.block_height, 'transfer block height'),
        timestamp,
        otherAccountId,
        transactionHash: transactionHashValue,
        transferIndex: parseSafeUnsignedInteger(transfer.transfer_index, 'transfer index'),
        direction
      })
    })
  )
}

function mapTransfer(
  transfer: NearIndexedTransfer,
  scope: ActivityScope,
  accountId: string,
  chainId: ReturnType<typeof parseChainId>['id']
): ActivityItem {
  const assetId =
    transfer.assetReference === null
      ? undefined
      : parseAssetId(
          transfer.assetReference === 'native'
            ? `${chainId}/slip44:397`
            : `${chainId}/nep141:${transfer.assetReference}`
        ).id
  const id = `rpc:near:${transfer.transactionHash}:${transfer.transferIndex}`
  const sender = transfer.direction === 'outgoing' ? accountId : transfer.otherAccountId
  const recipient = transfer.direction === 'incoming' ? accountId : transfer.otherAccountId
  return Object.freeze({
    id,
    source: 'rpc' as const,
    scope,
    kind: 'transfer' as const,
    status: 'final' as const,
    snapshot: Object.freeze({
      schemaVersion: 1 as const,
      direction: transfer.direction,
      ...(assetId
        ? { primaryAmount: Object.freeze({ assetId, amountRaw: transfer.amountRaw }) }
        : {}),
      sender: Object.freeze({ chainId, address: sender }),
      recipient: Object.freeze({ chainId, address: recipient })
    }),
    segments: Object.freeze([
      Object.freeze({
        id: `${id}:origin`,
        role: 'origin' as const,
        target: Object.freeze({ kind: 'onchain' as const, chainId }),
        status: 'final' as const,
        evidence: Object.freeze({
          transactionHash: transfer.transactionHash,
          blockHeight: transfer.blockHeight
        })
      })
    ]),
    completeness: assetId ? ('complete' as const) : ('partial' as const),
    createdAt: transfer.timestamp,
    updatedAt: transfer.timestamp
  })
}

export function createNearActivityHistorySource(
  config: NearActivityHistorySourceConfig
): NearActivityHistorySource {
  const chain = parseChainId(config.chainId)
  if (chain.namespace !== 'near' || chain.reference !== 'mainnet') {
    throw new Error('FastNear transfer history supports NEAR mainnet only')
  }
  const readDirection = async (
    accountId: string,
    direction: NearIndexedTransfer['direction']
  ): Promise<readonly NearIndexedTransfer[]> => {
    const response = await fetchWithTimeout(`${TRANSFERS_API_ORIGIN}/v0/transfers`, {
      ...jsonRequestInit(
        { method: 'POST', cache: 'no-store', credentials: 'omit' },
        {
          account_id: accountId,
          direction: direction === 'incoming' ? 'receiver' : 'sender',
          desc: true,
          limit: TRANSFERS_PER_DIRECTION,
          ignore_system: true
        }
      ),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAXIMUM_RESPONSE_BYTES,
      fetcher: config.fetchImpl,
      acceptHttpErrors: 'status-only'
    }).catch(error => {
      if (error instanceof FetchResponseTooLargeError) {
        throw new Error('FastNear transfer response is too large')
      }
      throw error
    })
    if (!response.ok)
      throw new Error(`FastNear transfer request failed with HTTP ${response.status}`)
    const decoded: unknown = await response.json().catch(() => {
      throw new Error('Invalid FastNear transfer response')
    })
    return parseTransfers(decoded, direction)
  }
  return Object.freeze({
    readAddressActivity: async (input: ReadNearAddressActivityInput) => {
      const accountId = readNearAccountId(input.address, 'FastNear activity account ID')
      const results = await Promise.all([
        readDirection(accountId, 'incoming'),
        readDirection(accountId, 'outgoing')
      ])
      const transfers = [
        ...new Map(
          results
            .flat()
            .sort((left, right) => right.timestamp - left.timestamp)
            .map(
              transfer =>
                [`${transfer.transactionHash}:${transfer.transferIndex}`, transfer] as const
            )
        ).values()
      ]
      return Object.freeze(
        transfers.map(transfer => mapTransfer(transfer, input.scope, accountId, chain.id))
      )
    }
  })
}
