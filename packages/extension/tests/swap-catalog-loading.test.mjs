import { expect, test } from '@playwright/test'
import {
  buildInitialSwapCatalogPlan,
  findSwapTokenInCatalog,
  loadTokenCatalogByChain
} from '../src/popup/services/swap-catalog-loading.ts'

test('loads only the current pair chains on entry and reuses source tokens for same-chain swaps', () => {
  expect(buildInitialSwapCatalogPlan({})).toEqual({
    sourceChainIds: [900010],
    destinationChainIds: [900001]
  })
  expect(
    buildInitialSwapCatalogPlan({
      sourceAssetId: 'nep141:btc.omft.near',
      destinationAssetId: 'nep141:eth.omft.near'
    })
  ).toEqual({ sourceChainIds: [900002], destinationChainIds: [1] })
  expect(
    buildInitialSwapCatalogPlan({
      sourceAssetId: 'nep245:v2_1.omni.hot.tg:137_11111111111111111111',
      destinationApiChainId: '137'
    })
  ).toEqual({ sourceChainIds: [137], destinationChainIds: [] })
  expect(buildInitialSwapCatalogPlan({ defaultSourceChainId: 'bip122:mainnet' })).toEqual({
    sourceChainIds: [900002],
    destinationChainIds: [900001]
  })
  expect(buildInitialSwapCatalogPlan({ sourceAssetId: 'eip155:42161/native:ETH' })).toEqual({
    sourceChainIds: [42161],
    destinationChainIds: [900001]
  })
  expect(buildInitialSwapCatalogPlan({ sourceAssetId: 'nep141:wrap.near' })).toEqual({
    sourceChainIds: [900001],
    destinationChainIds: [1]
  })
})

test('publishes a healthy chain before slow chains finish and stops queued work after cancellation', async () => {
  let release
  const pending = new Promise(resolve => {
    release = resolve
  })
  let cancelled = false
  const calls = []
  const published = []
  const token = { rheaChainId: '1', rheaAddress: 'eth' }
  const loading = loadTokenCatalogByChain(
    'from',
    [1, 10, 56, 137],
    false,
    tokens => {
      published.push(...tokens)
      cancelled = true
    },
    () => cancelled,
    {
      listTokens: async input => {
        const chain = input.tokenListChainIds[0]
        calls.push(chain)
        if (chain === 10) {
          await pending
          throw new Error('Unavailable')
        }
        return { tokens: [token], failedChainIds: [] }
      }
    }
  )
  await expect.poll(() => published).toEqual([token])
  expect(calls).toEqual([1, 10])
  release()
  expect(await loading).toEqual([token])
})

test('distinguishes a selected token from an asset on another chain', () => {
  const usdc = {
    assetId: 'usdc',
    blockchain: 'eth',
    tokenListChainId: 1,
    rheaChainId: '1',
    rheaAddress: 'usdc'
  }
  const polygon = {
    assetId: 'usdc',
    blockchain: 'polygon',
    tokenListChainId: 137,
    rheaChainId: '137',
    rheaAddress: 'usdc'
  }
  expect(findSwapTokenInCatalog([polygon], usdc)).toBeUndefined()
  expect(findSwapTokenInCatalog([polygon], polygon)).toBe(polygon)
})
