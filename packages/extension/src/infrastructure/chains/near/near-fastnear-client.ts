import { getNearNetworkConfigs } from '@/config/networks'
import { parseChainId } from '@/core/chains/registry'
import { FetchResponseTooLargeError, fetchWithTimeout, jsonRequestInit } from '@/lib/fetch-utils'

import { readNearAccountId } from './near-rpc-codecs'

const REQUEST_TIMEOUT_MS = 8_000
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024
const MAXIMUM_TOKEN_ROWS = 2_048
const MAXIMUM_RAW_AMOUNT_DIGITS = 128

export interface NearIndexedFungibleTokenBalance {
  readonly contractId: string
  readonly amountRaw: string | null
  readonly lastUpdateBlockHeight: number | null
}

export interface NearAccountTokenInventoryClient {
  readonly getFungibleTokenBalances: (
    accountId: string,
    signal?: AbortSignal
  ) => Promise<readonly NearIndexedFungibleTokenBalance[]>
}

export interface FastNearAccountTokenClientConfig {
  readonly chainId: string
  readonly fetchImpl?: typeof fetch
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid FastNear fungible token response')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Invalid FastNear fungible token response')
  }
  return value as Record<string, unknown>
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return (
    Object.keys(value).length === required.length &&
    required.every(key => Object.prototype.hasOwnProperty.call(value, key))
  )
}

function parseResponse(
  value: unknown,
  expectedAccountId: string
): readonly NearIndexedFungibleTokenBalance[] {
  const response = readRecord(value)
  if (
    !hasExactKeys(response, ['account_id', 'tokens']) ||
    response.account_id !== expectedAccountId ||
    !Array.isArray(response.tokens) ||
    response.tokens.length > MAXIMUM_TOKEN_ROWS
  ) {
    throw new Error('Invalid FastNear fungible token response')
  }
  const seen = new Set<string>()
  const tokens = response.tokens.map(candidate => {
    const token = readRecord(candidate)
    if (
      !hasExactKeys(token, ['contract_id', 'last_update_block_height', 'balance']) ||
      typeof token.balance !== 'string' ||
      token.balance.length > MAXIMUM_RAW_AMOUNT_DIGITS ||
      (token.balance !== '' && !/^(?:0|[1-9][0-9]*)$/.test(token.balance)) ||
      (token.last_update_block_height !== null &&
        (!Number.isSafeInteger(token.last_update_block_height) ||
          (token.last_update_block_height as number) < 0))
    ) {
      throw new Error('Invalid FastNear fungible token response')
    }
    const contractId = readNearAccountId(token.contract_id, 'FastNear fungible token contract ID')
    if (seen.has(contractId)) throw new Error('Invalid FastNear fungible token response')
    seen.add(contractId)
    return Object.freeze({
      contractId,
      amountRaw: token.balance === '' ? null : token.balance,
      lastUpdateBlockHeight: token.last_update_block_height as number | null
    })
  })
  return Object.freeze(
    tokens.sort((left, right) => left.contractId.localeCompare(right.contractId))
  )
}

export function createFastNearAccountTokenClient(
  config: FastNearAccountTokenClientConfig
): NearAccountTokenInventoryClient {
  const chainId = parseChainId(config.chainId)
  const network = getNearNetworkConfigs().find(candidate => candidate.chainId === chainId.id)
  if (chainId.namespace !== 'near' || !network) throw new Error('Unsupported NEAR chain ID')
  const origin =
    network.network === 'mainnet' ? 'https://api.fastnear.com' : 'https://test.api.fastnear.com'
  return Object.freeze({
    getFungibleTokenBalances: async (accountIdValue: string, signal?: AbortSignal) => {
      const accountId = readNearAccountId(accountIdValue, 'FastNear account ID')
      const response = await fetchWithTimeout(
        `${origin}/v1/account/${encodeURIComponent(accountId)}/ft`,
        {
          ...jsonRequestInit({ method: 'GET', cache: 'no-store', credentials: 'omit', signal }),
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxBytes: MAXIMUM_RESPONSE_BYTES,
          fetcher: config.fetchImpl,
          acceptHttpErrors: 'status-only'
        }
      ).catch(error => {
        if (error instanceof FetchResponseTooLargeError) {
          throw new Error('FastNear fungible token response is too large')
        }
        throw error
      })
      if (!response.ok) {
        throw new Error(`FastNear fungible token request failed with HTTP ${response.status}`)
      }
      const decoded: unknown = await response.json().catch(() => {
        throw new Error('Invalid FastNear fungible token response')
      })
      return parseResponse(decoded, accountId)
    }
  })
}
