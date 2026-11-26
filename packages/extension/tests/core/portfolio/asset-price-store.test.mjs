import { test } from 'node:test'
import { expect } from '@playwright/test'
import {
  AssetPriceStore,
  resolveAssetPriceSnapshot
} from '../../../src/background/asset-price-store.ts'
import {
  ASSET_PRICE_EXPIRES_MS,
  ASSET_PRICE_SOURCE,
  catalogPriceAssetId,
  findAssetPrice,
  isFreshWalletAssetPrice
} from '../../../src/core/prices/asset-price.ts'
import { ChromeAssetPriceCacheScope } from '../../../src/infrastructure/prices/chrome-asset-price-cache-scope.ts'
import { AssetPriceClient } from '../../../src/popup/services/asset-price-client.ts'

const NOW = Date.parse('2026-11-26T00:00:00Z')
const BASE_ETH = 'eip155:8453/slip44:60'
const ETH = 'eip155:1/slip44:60'

function market(priceUsd, sourceUpdatedAt = NOW) {
  return {
    source: ASSET_PRICE_SOURCE,
    status: 'ready',
    fetchedAt: sourceUpdatedAt,
    quotes: [
      {
        assetId: ETH,
        source: 'near-intents-1click',
        priceUsd,
        sourceUpdatedAt,
        fetchedAt: sourceUpdatedAt,
        freshness: 'fresh'
      }
    ],
    missingAssetIds: []
  }
}

test('resolves one valuation per asset without conflating concurrent catalog listings by symbol', () => {
  const catalog = (assetId, priceUsd, provider, ageMs = 0) => ({
    assetId,
    priceUsd,
    provider,
    updatedAt: new Date(NOW - ageMs).toISOString()
  })
  const protocolOnly = catalogPriceAssetId('rhea', 'foreign-eth')
  const observations = [
    catalog(ETH, '200', 'confidential'),
    catalog(BASE_ETH, '160', 'rhea'),
    catalog(BASE_ETH, '158', 'confidential'),
    catalog(protocolOnly, '20', 'rhea'),
    catalog(BASE_ETH, '5', 'rhea', ASSET_PRICE_EXPIRES_MS + 1)
  ]
  const current = resolveAssetPriceSnapshot(market('190'), observations, NOW)
  expect(findAssetPrice(current, ETH)?.priceUsd).toBe('190')
  expect(findAssetPrice(current, BASE_ETH)?.priceUsd).toBe('158')
  expect(findAssetPrice(current, protocolOnly)?.priceUsd).toBe('20')
  const outdated = resolveAssetPriceSnapshot(market('190', NOW - 360_000), observations, NOW)
  expect(findAssetPrice(outdated, ETH)?.priceUsd).toBe('200')
  expect(isFreshWalletAssetPrice(findAssetPrice(outdated, ETH), NOW)).toBe(false)
  expect(
    findAssetPrice(
      resolveAssetPriceSnapshot(market('190'), [], NOW + ASSET_PRICE_EXPIRES_MS + 1),
      ETH
    )
  ).toBeNull()
})

test('coalesces a pending refresh and discards an old generation before publishing', async () => {
  let resolveOld
  let oldGeneration
  let refreshStarts = 0
  const store = new AssetPriceStore(
    'mainnet',
    isCurrent => {
      oldGeneration = isCurrent
      return {
        readCached: async () => market('180'),
        refresh: () => {
          refreshStarts += 1
          return new Promise(resolve => {
            resolveOld = resolve
          })
        }
      }
    },
    () => [],
    () => NOW
  )
  await store.readCached()
  const full = store.refresh()
  const targeted = store.refresh(ETH)
  await Promise.resolve()
  expect(refreshStarts).toBe(1)
  store.replaceSources(() => ({
    readCached: async () => market('220'),
    refresh: async () => market('220')
  }))
  expect(oldGeneration()).toBe(false)
  resolveOld(market('190'))
  expect(await full).toBeNull()
  expect(await targeted).toBeNull()
  expect(findAssetPrice(await store.readCached(), ETH)?.priceUsd).toBe('220')
})

test('isolates cached data by runtime network and rejects writes after invalidation', async () => {
  const savedChrome = globalThis.chrome
  const values = { legacy: 'unscoped' }
  globalThis.chrome = {
    storage: {
      local: {
        get: async key => ({ [key]: values[key] }),
        set: async value => {
          Object.assign(values, value)
        }
      }
    }
  }
  try {
    let valid = true
    const main = new ChromeAssetPriceCacheScope('mainnet', () => valid)
    const testnet = new ChromeAssetPriceCacheScope('testnet', () => true)
    expect(await main.read('legacy')).toBeUndefined()
    await main.write('quotes', 'main')
    expect(await testnet.read('quotes')).toBeUndefined()
    await testnet.write('quotes', 'test')
    valid = false
    await main.write('quotes', 'obsolete')
    expect(await main.read('quotes')).toBe('main')
    expect(await testnet.read('quotes')).toBe('test')
  } finally {
    globalThis.chrome = savedChrome
  }
})

test('sends targeted refresh intent with the active runtime network', async () => {
  const messages = []
  const client = new AssetPriceClient(async message => {
    messages.push(message)
    return { result: null }
  })
  await client.refresh('mainnet', ETH)
  expect(messages).toEqual([{ type: 'REFRESH_ASSET_PRICES', network: 'mainnet', assetId: ETH }])
})
