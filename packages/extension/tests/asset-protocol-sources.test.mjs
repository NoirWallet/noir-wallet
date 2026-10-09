import { expect, test } from '@playwright/test'

import { getAssetProtocolSourceMappings } from '../src/core/prices/asset-market-mappings.ts'
import {
  createAssetRegistry,
  createInitialProductChainRegistry,
  getBundledInitialProductAssetDefinitions
} from '../src/core/chains/registry/index.ts'

function createMappings(network) {
  const chains = createInitialProductChainRegistry(network)
  const assets = createAssetRegistry(chains, getBundledInitialProductAssetDefinitions(network))
  return { assets, mappings: getAssetProtocolSourceMappings(network, assets) }
}

test('maps every supported mainnet quote asset to its exact 1Click chain identity', () => {
  const { assets, mappings } = createMappings('mainnet')
  expect(mappings).toHaveLength(20)
  expect(new Set(mappings.map(mapping => mapping.assetId)).size).toBe(20)
  expect(new Set(mappings.map(mapping => mapping.protocolAssetId)).size).toBe(20)

  const byAssetId = new Map(mappings.map(mapping => [mapping.assetId, mapping.protocolAssetId]))
  expect(byAssetId.get('eip155:1/slip44:60')).toBe('nep141:eth.omft.near')
  expect(byAssetId.get('eip155:42161/slip44:60')).toBe('nep141:arb.omft.near')
  expect(byAssetId.get('eip155:8453/slip44:60')).toBe('nep141:base.omft.near')
  expect(byAssetId.get('eip155:10/slip44:60')).toBe(
    'nep245:v2_1.omni.hot.tg:10_11111111111111111111'
  )
  expect(byAssetId.get('eip155:143/slip44:268435779')).toBe(
    'nep245:v2_1.omni.hot.tg:143_11111111111111111111'
  )
  expect(byAssetId.get('eip155:100/slip44:700')).toBe('nep141:gnosis.omft.near')
  expect(byAssetId.get('eip155:9745/slip44:60')).toBe('nep141:plasma.omft.near')
  expect(byAssetId.get('eip155:196/slip44:60')).toBe(
    'nep245:v2_1.omni.hot.tg:196_11111111111111111111'
  )
  expect(byAssetId.get('eip155:80094/slip44:8008')).toBe('nep141:bera.omft.near')
  expect(byAssetId.get('eip155:42161/erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831')).toBe(
    'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near'
  )
  expect(mappings.map(mapping => assets.resolve(mapping.assetId).asset.chainId)).toContain(
    'eip155:43114'
  )
})

test('does not expose mainnet protocol assets from a testnet wallet build', () => {
  expect(createMappings('testnet').mappings).toEqual([])
})

test.describe('live 1Click protocol asset catalog', () => {
  test.skip(
    process.env.LIVE_PROTOCOL_ASSET_INTEGRATION !== '1',
    'Set LIVE_PROTOCOL_ASSET_INTEGRATION=1 to enable'
  )

  test('contains every exact mainnet wallet quote identity with matching precision', async () => {
    const { assets, mappings } = createMappings('mainnet')
    const response = await fetch('https://1click.chaindefuser.com/v0/tokens', {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    })
    expect(response.ok).toBe(true)
    const tokens = await response.json()
    expect(Array.isArray(tokens)).toBe(true)
    const byId = new Map(tokens.map(token => [token.assetId, token]))

    for (const mapping of mappings) {
      const token = byId.get(mapping.protocolAssetId)
      expect(token, mapping.protocolAssetId).toBeDefined()
      expect(token.decimals, mapping.protocolAssetId).toBe(
        assets.resolve(mapping.assetId).metadata.decimals
      )
      expect(Number(token.price), mapping.protocolAssetId).toBeGreaterThan(0)
    }
  })
})
