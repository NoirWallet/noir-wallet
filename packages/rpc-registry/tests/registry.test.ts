import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRegistryRequest } from '../src/api'
import { getMonitorTargets, RPC_REGISTRY, type RpcRegistryDocument } from '../src/registry'

test('publishes configured endpoints in order and limits V1 to Zcash mainnet', async () => {
  const legacy = handleRegistryRequest(new Request('https://rpc.zknoir.com/v1/rpc-endpoints'))
  const response = handleRegistryRequest(
    new Request('https://rpc.zknoir.com/v1/rpc-endpoints?scope=multichain')
  )

  assert.equal(legacy.status, 200)
  const legacyDocument = await legacy.json()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.ok(response.headers.get('cache-control').includes('max-age=300'))
  assert.ok(response.headers.get('cloudflare-cdn-cache-control').includes('max-age=3600'))
  const multiChainDocument = await response.json()
  assert.deepEqual(multiChainDocument, RPC_REGISTRY)
  assert.deepEqual(legacyDocument, {
    ...RPC_REGISTRY,
    chains: RPC_REGISTRY.chains.filter(
      chain => chain.chain === 'zcash' && chain.network === 'mainnet'
    )
  })
})

test('configured registry has valid metadata, unique IDs and HTTPS endpoints', () => {
  assert.equal(RPC_REGISTRY.version, 1)
  assert.ok(Number.isFinite(Date.parse(RPC_REGISTRY.updatedAt)))
  assert.ok(RPC_REGISTRY.chains.length > 0)
  const chainIds = new Set<string>()
  for (const chain of RPC_REGISTRY.chains) {
    for (const value of [chain.id, chain.chain, chain.network, chain.label, chain.iconChain]) {
      assert.ok(value.trim().length > 0)
    }
    assert.ok(!chainIds.has(chain.id), `Duplicate chain ID: ${chain.id}`)
    chainIds.add(chain.id)
    assert.ok(chain.endpoints.length > 0, `No endpoints for ${chain.id}`)
    const endpointIds = new Set<string>()
    for (const endpoint of chain.endpoints) {
      assert.ok(endpoint.id.trim().length > 0)
      assert.ok(endpoint.label.trim().length > 0)
      assert.ok(
        !endpointIds.has(endpoint.id),
        `Duplicate endpoint ID in ${chain.id}: ${endpoint.id}`
      )
      endpointIds.add(endpoint.id)
      const url = new URL(endpoint.url)
      assert.equal(url.protocol, 'https:')
      assert.equal(url.username, '')
      assert.equal(url.password, '')
    }
  }
})

test('monitors only Zcash endpoints across chain namespaces', () => {
  const registry: RpcRegistryDocument = {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    chains: [
      {
        id: 'test-zcash-mainnet',
        chain: 'zcash',
        network: 'mainnet',
        label: 'Test Zcash',
        iconChain: 'zec',
        probe: 'zcash-lightwalletd-grpc-web',
        endpoints: [
          { id: 'shared', label: 'Primary', url: 'https://primary.example.com' },
          { id: 'backup', label: 'Backup', url: 'https://backup.example.com' }
        ]
      },
      {
        id: 'test-evm',
        chain: 'eip155',
        network: 'mainnet',
        label: 'Test EVM',
        iconChain: 'eth',
        probe: 'evm-json-rpc',
        endpoints: [{ id: 'shared', label: 'EVM', url: 'https://evm.example.com' }]
      },
      {
        id: 'test-zcash-testnet',
        chain: 'zcash',
        network: 'testnet',
        label: 'Test Zcash Testnet',
        iconChain: 'zec',
        probe: 'zcash-lightwalletd-grpc-web',
        endpoints: [{ id: 'shared', label: 'Testnet', url: 'https://testnet.example.com' }]
      }
    ]
  }
  const targets = getMonitorTargets(registry)
  assert.deepEqual(
    targets.map(target => [target.chainId, target.id, target.label, target.url, target.network]),
    [
      ['test-zcash-mainnet', 'shared', 'Primary', 'https://primary.example.com', 'mainnet'],
      ['test-zcash-mainnet', 'backup', 'Backup', 'https://backup.example.com', 'mainnet'],
      ['test-zcash-testnet', 'shared', 'Testnet', 'https://testnet.example.com', 'testnet']
    ]
  )
  assert.ok(targets.every(target => target.probe === 'zcash-lightwalletd-grpc-web'))
  assert.ok(targets.every(target => target.chain === 'zcash'))
})

test('rejects unknown routes and supports CORS preflight', async () => {
  const notFound = handleRegistryRequest(new Request('https://rpc.zknoir.com/'))
  const preflight = handleRegistryRequest(
    new Request('https://rpc.zknoir.com/v1/rpc-endpoints', { method: 'OPTIONS' })
  )

  assert.equal(notFound.status, 404)
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS')
})
