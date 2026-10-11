import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRegistryRequest } from '../src/api'
import { ZERO_INDEXER_REGISTRY } from '../src/zero-indexer-registry'

test('serves an independent ZeroIndexer registry with mainnet and testnet nodes', async () => {
  const response = handleRegistryRequest(
    new Request('https://rpc.zknoir.com/v1/zero-indexer-endpoints')
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(await response.json(), ZERO_INDEXER_REGISTRY)
  assert.ok(ZERO_INDEXER_REGISTRY.networks.mainnet.length > 0)
  assert.ok(ZERO_INDEXER_REGISTRY.networks.testnet.length > 0)
  for (const network of ['mainnet', 'testnet'] as const) {
    for (const endpoint of ZERO_INDEXER_REGISTRY.networks[network]) {
      assert.equal(new URL(endpoint.url).protocol, 'https:')
    }
  }
})

test('ZeroIndexer route supports preflight and rejects mutations', () => {
  assert.equal(
    handleRegistryRequest(
      new Request('https://rpc.zknoir.com/v1/zero-indexer-endpoints', { method: 'OPTIONS' })
    ).status,
    204
  )
  assert.equal(
    handleRegistryRequest(
      new Request('https://rpc.zknoir.com/v1/zero-indexer-endpoints', { method: 'POST' })
    ).status,
    404
  )
})
