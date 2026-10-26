import { expect, test } from '@playwright/test'
import {
  createRheaSwapClient,
  getRheaSwapErrorMessage,
  RheaSwapClientError
} from '../src/popup/services/rhea-swap-client.ts'
import { RHEA_SWAP_CHAIN_CATALOG } from '../src/core/services/rhea-swap/index.ts'

function token() {
  return {
    assetId: 'nep141:eth.omft.near',
    blockchain: 'eth',
    contractAddress: null,
    decimals: 18,
    icon: null,
    price: 1,
    priceUpdatedAt: '2026-09-02T00:00:00.000Z',
    symbol: 'ETH',
    rheaChainId: '1',
    tokenListChainId: 1,
    rheaAddress: 'nep141:eth.omft.near',
    isNative: true
  }
}

test('shows the useful minimum from RHEA quote and swap errors', () => {
  expect(
    getRheaSwapErrorMessage(
      new RheaSwapClientError('Temporary swap limits: minimum swap amount is $1,000')
    )
  ).toBe('Minimum swap amount is $1,000.')
  expect(getRheaSwapErrorMessage(new Error('Minimum swap amount is $1,000'))).toBe(
    'Amount is below the current minimum for this Swap route.'
  )
})

test('retains both directions for every supported chain without evicting source catalogs', async () => {
  let calls = 0
  const client = createRheaSwapClient(async message => {
    calls += 1
    const chain = RHEA_SWAP_CHAIN_CATALOG.find(
      chain => chain.tokenListChainId === message.tokenListChainIds[0]
    )
    return {
      result: {
        tokens: [
          {
            ...token(),
            rheaChainId: chain.apiChainId,
            tokenListChainId: chain.tokenListChainId,
            blockchain: chain.blockchain
          }
        ],
        failedChainIds: []
      }
    }
  })
  for (const direction of ['from', 'cross-chain-to']) {
    for (const chain of RHEA_SWAP_CHAIN_CATALOG) {
      await client.listTokens({ direction, tokenListChainIds: [chain.tokenListChainId] })
    }
  }
  const initialCalls = calls
  for (const direction of ['from', 'cross-chain-to']) {
    for (const chain of RHEA_SWAP_CHAIN_CATALOG) {
      await client.listTokens({ direction, tokenListChainIds: [chain.tokenListChainId] })
    }
  }
  expect(calls).toBe(initialCalls)
})

test('RHEA token catalog deduplicates in-flight reads and caches complete results for ten minutes', async () => {
  let calls = 0
  let currentTime = 1_000
  const client = createRheaSwapClient(
    async () => {
      calls += 1
      await Promise.resolve()
      return { result: { tokens: [token()], failedChainIds: [] } }
    },
    { now: () => currentTime }
  )
  const input = { direction: 'from', tokenListChainIds: [10, 1] }

  const [first, second] = await Promise.all([client.listTokens(input), client.listTokens(input)])
  expect(first).toEqual(second)
  expect(calls).toBe(1)
  expect(client.readCachedTokens({ direction: 'from', tokenListChainIds: [1, 10] })).toEqual(first)
  await client.listTokens({ direction: 'from', tokenListChainIds: [1, 10] })
  expect(calls).toBe(1)

  currentTime += 10 * 60 * 1_000
  expect(client.readCachedTokens(input)).toBeNull()
  await client.listTokens(input)
  expect(calls).toBe(2)
})

test('RHEA token catalog does not cache partial multi-chain responses', async () => {
  let calls = 0
  const client = createRheaSwapClient(async () => {
    calls += 1
    return { result: { tokens: [token()], failedChainIds: [10] } }
  })
  const input = { direction: 'from', tokenListChainIds: [1, 10] }

  await client.listTokens(input)
  await client.listTokens(input)
  expect(calls).toBe(2)
})

test('RHEA token catalog does not cache an empty successful response', async () => {
  let calls = 0
  const client = createRheaSwapClient(async () => {
    calls += 1
    return { result: { tokens: [], failedChainIds: [] } }
  })
  const input = { direction: 'from', tokenListChainIds: [1] }

  await client.listTokens(input)
  await client.listTokens(input)
  expect(calls).toBe(2)
})

test('RHEA token catalog retry bypasses a previously successful cached response', async () => {
  let calls = 0
  const client = createRheaSwapClient(async () => {
    calls += 1
    return { result: { tokens: [token()], failedChainIds: [] } }
  })
  const input = { direction: 'from', tokenListChainIds: [1] }

  await client.listTokens(input)
  await client.listTokens(input)
  expect(calls).toBe(1)
  await client.listTokens(input, { bypassCache: true })
  expect(calls).toBe(2)
})
