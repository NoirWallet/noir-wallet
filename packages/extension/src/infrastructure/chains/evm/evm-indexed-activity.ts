import type { ActivityItem, ActivityScope } from '@/core/activity'
import { parseAssetId, parseChainId } from '@/core/chains/registry'
import { decodeAaveSupplyCall } from '@/core/activity/aave-v3-ethereum'
import { EvmRpcError } from './evm-rpc-client'
import { isErc20ApproveCalldata } from './evm-contract-call-classification'

export const EVM_HISTORY_LIMIT = 200
export const EVM_ACTIVITY_ITEM_LIMIT = 2_000

export interface TrackedErc20Asset {
  readonly assetId: string
  readonly contract: string
  readonly decimals: number
}

export interface ReadEvmAddressActivityInput {
  readonly scope: ActivityScope
  readonly address: string
  readonly fromBlock?: number
  readonly historyPageCount?: number
  readonly signal?: AbortSignal
}

export interface FindEvmConfirmedReplacementInput {
  readonly sender: string
  readonly nonce: string
  readonly excludedTransactionHash: string
  readonly signal?: AbortSignal
}

export interface EvmConfirmedReplacement {
  readonly transactionHash: string
  readonly blockHash: string
  readonly blockHeight: number
  readonly confirmedAt: number
}

export interface EvmActivityHistorySource {
  readonly readAddressActivity: (
    input: ReadEvmAddressActivityInput
  ) => Promise<readonly ActivityItem[]>
  readonly readAddressActivityWithMetadata?: (
    input: ReadEvmAddressActivityInput
  ) => Promise<{ readonly items: readonly ActivityItem[]; readonly hasMore: boolean }>
  readonly findConfirmedReplacement: (
    input: FindEvmConfirmedReplacementInput
  ) => Promise<EvmConfirmedReplacement | null>
}

export interface IndexedTransaction {
  readonly transactionHash: string
  readonly blockHash: string
  readonly blockHeight: number
  readonly confirmations: number
  readonly from: string
  readonly to?: string
  readonly valueRaw: string
  readonly gasPriceRaw: string
  readonly gasUsed: string
  readonly nonce: string
  readonly timestamp: number
  readonly failed: boolean
  readonly input?: string
}

export interface IndexedTokenTransfer {
  readonly transactionHash: string
  readonly blockHash?: string
  readonly blockHeight: number
  readonly confirmations: number
  readonly from: string
  readonly to: string
  readonly amountRaw: string
  readonly nonce?: string
  readonly timestamp: number
  readonly assetId: ReturnType<typeof parseAssetId>['id']
}

export function isZeroValueEvmTokenActivity(item: ActivityItem): boolean {
  const amount = item.snapshot?.primaryAmount
  return (
    item.source === 'rpc' &&
    item.id.startsWith('rpc:evm:') &&
    item.kind === 'transfer' &&
    amount?.amountRaw === '0' &&
    amount.assetId.startsWith('eip155:') &&
    amount.assetId.includes('/erc20:')
  )
}

function directionFor(address: string, from: string, to: string | undefined) {
  if (from === address && to === address) return 'self' as const
  if (from === address) return 'outgoing' as const
  if (to === address) return 'incoming' as const
  throw new EvmRpcError('invalid-response', 'EVM history item does not involve the address')
}

function transactionEvidence(transaction: IndexedTransaction | IndexedTokenTransfer) {
  return Object.freeze({
    transactionHash: transaction.transactionHash,
    ...(transaction.nonce === undefined
      ? {}
      : { externalReference: `evm-nonce:${transaction.nonce}` }),
    ...(transaction.blockHash === undefined ? {} : { blockHash: transaction.blockHash }),
    blockHeight: transaction.blockHeight,
    confirmations: transaction.confirmations
  })
}

function mapNormalActivityItem(
  transaction: IndexedTransaction,
  input: ReadEvmAddressActivityInput,
  chainId: ReturnType<typeof parseChainId>['id'],
  nativeAssetId: ReturnType<typeof parseAssetId>['id'],
  partial: boolean
): ActivityItem {
  const address = input.address.toLowerCase()
  const direction = directionFor(address, transaction.from, transaction.to)
  const isTransfer = transaction.valueRaw !== '0'
  const isApproval = !isTransfer && isErc20ApproveCalldata(transaction.input)
  const aaveSupply = transaction.to
    ? decodeAaveSupplyCall({
        chainId,
        recipient: transaction.to,
        calldata: transaction.input,
        valueRaw: transaction.valueRaw
      })
    : null
  const status = transaction.failed ? ('failed' as const) : ('final' as const)
  const id = `rpc:evm:${chainId}:${transaction.transactionHash}:native`
  return Object.freeze({
    id,
    source: 'rpc' as const,
    scope: input.scope,
    kind: aaveSupply
      ? ('supply' as const)
      : isTransfer
        ? ('transfer' as const)
        : isApproval
          ? ('approve' as const)
          : ('contract-call' as const),
    status,
    snapshot: Object.freeze({
      schemaVersion: 1 as const,
      direction: aaveSupply
        ? ('outgoing' as const)
        : isTransfer
          ? direction
          : ('contract' as const),
      ...(aaveSupply || isTransfer
        ? {
            primaryAmount: Object.freeze({
              assetId: aaveSupply?.assetId ?? nativeAssetId,
              amountRaw: aaveSupply?.amountRaw ?? transaction.valueRaw
            })
          }
        : {}),
      sender: Object.freeze({ chainId, address: transaction.from }),
      ...(transaction.to === undefined
        ? {}
        : { recipient: Object.freeze({ chainId, address: transaction.to }) })
    }),
    segments: Object.freeze([
      Object.freeze({
        id: `${id}:origin`,
        role: 'origin' as const,
        target: Object.freeze({ kind: 'onchain' as const, chainId }),
        status,
        evidence: transactionEvidence(transaction),
        ...(transaction.failed ? { failureCode: 'reverted' as const } : {})
      })
    ]),
    completeness: partial ? ('partial' as const) : ('complete' as const),
    createdAt: transaction.timestamp,
    updatedAt: transaction.timestamp,
    ...(transaction.failed ? { failureCode: 'reverted' as const } : {})
  })
}

function mapTokenActivityItem(
  transfer: IndexedTokenTransfer,
  input: ReadEvmAddressActivityInput,
  chainId: ReturnType<typeof parseChainId>['id'],
  partial: boolean,
  normal?: IndexedTransaction
): ActivityItem {
  const address = input.address.toLowerCase()
  const direction = directionFor(address, transfer.from, transfer.to)
  const decodedSupply = normal?.to
    ? decodeAaveSupplyCall({
        chainId,
        recipient: normal.to,
        calldata: normal.input,
        valueRaw: normal.valueRaw
      })
    : null
  const aaveSupply =
    direction === 'outgoing' &&
    decodedSupply?.assetId === transfer.assetId &&
    decodedSupply.amountRaw === transfer.amountRaw &&
    normal?.from === transfer.from
  const id = `rpc:evm:${chainId}:${transfer.transactionHash}:token`
  const status = 'final' as const
  return Object.freeze({
    id,
    source: 'rpc' as const,
    scope: input.scope,
    kind: aaveSupply ? ('supply' as const) : ('transfer' as const),
    status,
    snapshot: Object.freeze({
      schemaVersion: 1 as const,
      direction,
      primaryAmount: Object.freeze({ assetId: transfer.assetId, amountRaw: transfer.amountRaw }),
      sender: Object.freeze({ chainId, address: transfer.from }),
      recipient: Object.freeze({
        chainId,
        address: aaveSupply && normal?.to ? normal.to : transfer.to
      })
    }),
    segments: Object.freeze([
      Object.freeze({
        id: `${id}:origin`,
        role: 'origin' as const,
        target: Object.freeze({ kind: 'onchain' as const, chainId }),
        status,
        evidence: transactionEvidence(transfer)
      })
    ]),
    completeness: partial ? ('partial' as const) : ('complete' as const),
    createdAt: transfer.timestamp,
    updatedAt: transfer.timestamp
  })
}

export function mapEvmIndexedActivity(input: {
  readonly request: ReadEvmAddressActivityInput
  readonly chainId: string
  readonly nativeAssetId: string
  readonly normalTransactions: readonly IndexedTransaction[]
  readonly tokenTransfers: readonly IndexedTokenTransfer[]
  readonly sourcePartial: boolean
  readonly itemLimit?: number
}): readonly ActivityItem[] {
  const chain = parseChainId(input.chainId)
  const nativeAssetId = parseAssetId(input.nativeAssetId)
  const tokenTransfersByHash = new Map<string, IndexedTokenTransfer[]>()
  for (const transfer of input.tokenTransfers) {
    if (transfer.amountRaw === '0') continue
    const group = tokenTransfersByHash.get(transfer.transactionHash) ?? []
    group.push(transfer)
    tokenTransfersByHash.set(transfer.transactionHash, group)
  }
  const mappedTokenHashes = new Set<string>()
  const tokenItems: ActivityItem[] = []
  for (const [hash, transfers] of tokenTransfersByHash) {
    if (transfers.length !== 1) continue
    const normal = input.normalTransactions.find(
      transaction => transaction.transactionHash === hash
    )
    const transfer = normal
      ? Object.freeze({
          ...transfers[0],
          blockHash: transfers[0].blockHash ?? normal.blockHash,
          nonce: transfers[0].nonce ?? normal.nonce,
          confirmations: Math.max(transfers[0].confirmations, normal.confirmations)
        })
      : transfers[0]
    tokenItems.push(
      mapTokenActivityItem(
        transfer,
        input.request,
        chain.id,
        input.sourcePartial ||
          normal?.valueRaw !== '0' ||
          transfer.blockHash === undefined ||
          transfer.nonce === undefined,
        normal
      )
    )
    mappedTokenHashes.add(hash)
  }
  const normalItems = input.normalTransactions
    .filter(transaction => !mappedTokenHashes.has(transaction.transactionHash))
    .map(transaction =>
      mapNormalActivityItem(
        transaction,
        input.request,
        chain.id,
        nativeAssetId.id,
        input.sourcePartial ||
          (tokenTransfersByHash.get(transaction.transactionHash)?.length ?? 0) > 1
      )
    )
  return Object.freeze(
    [...normalItems, ...tokenItems]
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          right.createdAt - left.createdAt ||
          left.id.localeCompare(right.id)
      )
      .slice(0, input.itemLimit ?? EVM_HISTORY_LIMIT)
  )
}
