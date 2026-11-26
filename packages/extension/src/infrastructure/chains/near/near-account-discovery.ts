import {
  nearImplicitAccountIdFromPublicKey,
  parseNearAccountId,
  parseNearPublicKey
} from '@/core/chains/near'
import { FetchResponseTooLargeError, fetchWithTimeout, jsonRequestInit } from '@/lib/fetch-utils'
import type { Network } from '@/types'

import type { NearReadRpc } from './near-rpc-types'

const MAXIMUM_DISCOVERY_RESPONSE_BYTES = 64 * 1024
const MAXIMUM_DISCOVERED_ACCOUNT_COUNT = 32
const DISCOVERY_TIMEOUT_MS = 5_000

export interface NearAccountDiscoveryResult {
  readonly implicitAccountId: string
  readonly primaryAccountId: string
  readonly accountIds: readonly string[]
}

export interface DiscoverNearAccountsInput {
  readonly network: Network
  readonly publicKey: string
  readonly rpc: Pick<NearReadRpc, 'getAccount' | 'getAccessKey'>
  readonly signal?: AbortSignal
  readonly fetchImpl?: typeof fetch
}

function discoveryOrigin(network: Network): string {
  return network === 'mainnet' ? 'https://api.fastnear.com' : 'https://test.api.fastnear.com'
}

function parseDiscoveryResponse(value: unknown, expectedPublicKey: string): readonly string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid NEAR account discovery response')
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== 2 ||
    record.public_key !== expectedPublicKey ||
    !Array.isArray(record.account_ids) ||
    record.account_ids.length > MAXIMUM_DISCOVERED_ACCOUNT_COUNT
  ) {
    throw new Error('Invalid NEAR account discovery response')
  }
  const accountIds = record.account_ids.map(value =>
    parseNearAccountId(value, 'Discovered NEAR account ID')
  )
  if (new Set(accountIds).size !== accountIds.length) {
    throw new Error('Duplicate NEAR account discovery result')
  }
  return Object.freeze(accountIds)
}

export async function discoverNearAccounts(
  input: DiscoverNearAccountsInput
): Promise<NearAccountDiscoveryResult> {
  const publicKey = parseNearPublicKey(input.publicKey)
  const implicitAccountId = nearImplicitAccountIdFromPublicKey(publicKey)
  const response = await fetchWithTimeout(
    `${discoveryOrigin(input.network)}/v0/public_key/${encodeURIComponent(publicKey)}`,
    {
      ...jsonRequestInit({
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: input.signal
      }),
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      maxBytes: MAXIMUM_DISCOVERY_RESPONSE_BYTES,
      fetcher: input.fetchImpl,
      acceptHttpErrors: 'status-only'
    }
  ).catch(error => {
    if (error instanceof FetchResponseTooLargeError) {
      throw new Error('NEAR account discovery response is too large')
    }
    throw error
  })
  if (!response.ok) {
    throw new Error(`NEAR account discovery failed with HTTP ${response.status}`)
  }
  const discovered = parseDiscoveryResponse(await response.json(), publicKey)
  const namedCandidates = discovered.filter(accountId => accountId !== implicitAccountId)
  const verified = (
    await Promise.all(
      namedCandidates.map(async accountId => {
        const [account, accessKey] = await Promise.all([
          input.rpc.getAccount(accountId, input.signal),
          input.rpc.getAccessKey(accountId, publicKey, input.signal)
        ])
        if (
          !account ||
          !accessKey ||
          account.accountId !== accountId ||
          accessKey.accountId !== accountId ||
          accessKey.publicKey !== publicKey ||
          accessKey.permission.kind !== 'full-access'
        ) {
          return null
        }
        return Object.freeze({
          accountId,
          balance: BigInt(account.amountRaw) + BigInt(account.lockedRaw)
        })
      })
    )
  ).filter(value => value !== null)
  verified.sort(
    (left, right) =>
      (left.balance === right.balance ? 0 : left.balance > right.balance ? -1 : 1) ||
      left.accountId.localeCompare(right.accountId)
  )
  const namedAccountIds = verified.map(value => value.accountId)
  return Object.freeze({
    implicitAccountId,
    primaryAccountId: namedAccountIds[0] ?? implicitAccountId,
    accountIds: Object.freeze([...namedAccountIds, implicitAccountId])
  })
}
