import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addCustomZeroIndexerNode,
  getZeroIndexerBroadcastOptions,
  getZeroIndexerNodeStatus,
  removeCustomZeroIndexerNode,
  selectZeroIndexerNode
} from '../src/background/zero-indexer-node-settings'
import {
  DEFAULT_ZERO_INDEXER_REGISTRY,
  parseZeroIndexerNodeStatus,
  parseZeroIndexerRegistryDocument,
  ZERO_INDEXER_NODES_STORAGE_KEY,
  ZERO_INDEXER_REGISTRY_CACHE_KEY,
  ZERO_INDEXER_RUNTIME_STORAGE_KEY
} from '../src/config/zero-indexer-nodes'

function grpcResponse(chain: string, status = '0'): Response {
  const value = new TextEncoder().encode(chain)
  const message = Uint8Array.from([0x22, value.length, ...value])
  const trailer = new TextEncoder().encode(`grpc-status: ${status}\r\n`)
  const data = new Uint8Array(5 + message.length + 5 + trailer.length)
  new DataView(data.buffer).setUint32(1, message.length)
  data.set(message, 5)
  data[5 + message.length] = 0x80
  new DataView(data.buffer).setUint32(6 + message.length, trailer.length)
  data.set(trailer, 10 + message.length)
  return new Response(data, { headers: { 'content-type': 'application/grpc-web+proto' } })
}

function setup(registry = DEFAULT_ZERO_INDEXER_REGISTRY) {
  const previousChrome = globalThis.chrome
  const previousFetch = globalThis.fetch
  const storage = new Map<string, unknown>([[ZERO_INDEXER_REGISTRY_CACHE_KEY, registry]])
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys: string | string[]) {
          const requested = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(requested.map(key => [key, structuredClone(storage.get(key))]))
        },
        async set(values: Record<string, unknown>) {
          for (const [key, value] of Object.entries(values))
            storage.set(key, structuredClone(value))
        }
      }
    }
  } as typeof chrome
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.endsWith('/v1/zero-indexer-endpoints')) return Response.json(registry)
    return grpcResponse(url.includes('testnet') ? 'test' : 'main')
  }
  return {
    storage,
    restore() {
      globalThis.chrome = previousChrome
      globalThis.fetch = previousFetch
    }
  }
}

test('AUTO uses only official nodes, while fixed custom selection supplies one URL', async () => {
  const registry = {
    ...DEFAULT_ZERO_INDEXER_REGISTRY,
    networks: {
      ...DEFAULT_ZERO_INDEXER_REGISTRY.networks,
      mainnet: [
        { id: 'first', label: 'First', url: 'https://first.example.com' },
        { id: 'second', label: 'Second', url: 'https://second.example.com' }
      ]
    }
  }
  const environment = setup(registry)
  try {
    const initial = await getZeroIndexerNodeStatus()
    assert.equal(initial.mode, 'auto')
    assert.deepEqual(await getZeroIndexerBroadcastOptions('mainnet', true), {
      urls: ['https://first.example.com', 'https://second.example.com']
    })
    const added = await addCustomZeroIndexerNode('Private', 'https://private.example.com')
    assert.equal(added.mode, 'auto')
    assert.equal(added.customEndpoints.length, 1)
    assert.equal(added.probes[added.customEndpoints[0].id].status, 'ok')
    assert.equal(
      (await getZeroIndexerNodeStatus()).probes[added.customEndpoints[0].id].status,
      'ok'
    )
    let duplicateProbeAttempted = false
    const fetchBeforeDuplicate = globalThis.fetch
    globalThis.fetch = async (...args) => {
      duplicateProbeAttempted = true
      return fetchBeforeDuplicate(...args)
    }
    await assert.rejects(
      addCustomZeroIndexerNode('Duplicate', 'https://private.example.com'),
      /already available/
    )
    assert.equal(duplicateProbeAttempted, false)
    globalThis.fetch = fetchBeforeDuplicate
    assert.deepEqual((await getZeroIndexerBroadcastOptions('mainnet', true))?.urls, [
      'https://first.example.com',
      'https://second.example.com'
    ])
    const selected = await selectZeroIndexerNode(added.customEndpoints[0].id)
    assert.equal(selected.mode, 'fixed')
    assert.deepEqual(await getZeroIndexerBroadcastOptions('mainnet', true), {
      urls: ['https://private.example.com']
    })
    const removed = await removeCustomZeroIndexerNode(added.customEndpoints[0].id)
    assert.equal(removed.mode, 'auto')
    assert.equal(removed.selectedEndpointId, null)
    assert.deepEqual((await getZeroIndexerBroadcastOptions('mainnet', true))?.urls, [
      'https://first.example.com',
      'https://second.example.com'
    ])
    assert.equal(await getZeroIndexerBroadcastOptions('mainnet', false), null)
    assert.equal(environment.storage.has('wallet_settings'), false)
    assert.equal(environment.storage.has(ZERO_INDEXER_NODES_STORAGE_KEY), true)
  } finally {
    environment.restore()
  }
})

test('refresh orders reachable officials first and preserves selection made during probing', async () => {
  const registry = {
    ...DEFAULT_ZERO_INDEXER_REGISTRY,
    networks: {
      ...DEFAULT_ZERO_INDEXER_REGISTRY.networks,
      mainnet: [
        { id: 'slow', label: 'Slow', url: 'https://slow.example.com' },
        { id: 'fast', label: 'Fast', url: 'https://fast.example.com' },
        { id: 'offline', label: 'Offline', url: 'https://offline.example.com' }
      ]
    }
  }
  const environment = setup(registry)
  let releaseSlow!: () => void
  const slowGate = new Promise<void>(resolve => {
    releaseSlow = resolve
  })
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('slow.example.com')) await slowGate
    if (url.includes('offline.example.com')) return new Response('bad', { status: 503 })
    return previousFetch(input, init)
  }
  try {
    const refresh = getZeroIndexerNodeStatus(true)
    await selectZeroIndexerNode('fast')
    await new Promise(resolve => setTimeout(resolve, 20))
    releaseSlow()
    const status = await refresh
    assert.equal(status.mode, 'fixed')
    assert.equal(status.selectedEndpointId, 'fast')
    assert.deepEqual(status.orderedEndpointIds, ['fast', 'slow', 'offline'])
    assert.equal(status.probes.offline.status, 'unreachable')
    assert.deepEqual((await getZeroIndexerBroadcastOptions('mainnet', true))?.urls, [
      'https://fast.example.com'
    ])
    assert.equal(environment.storage.has(ZERO_INDEXER_RUNTIME_STORAGE_KEY), true)
  } finally {
    releaseSlow()
    environment.restore()
  }
})

test('network preferences stay isolated and malformed registry or probe responses are rejected', async () => {
  const environment = setup()
  try {
    assert.equal(
      parseZeroIndexerRegistryDocument({
        ...DEFAULT_ZERO_INDEXER_REGISTRY,
        networks: {
          ...DEFAULT_ZERO_INDEXER_REGISTRY.networks,
          mainnet: [{ id: 'bad', label: 'Bad', url: 'http://insecure.example.com' }]
        }
      }),
      null
    )
    await assert.rejects(addCustomZeroIndexerNode('Bad', 'http://insecure.example.com'), /HTTPS/)
    const mainnet = await addCustomZeroIndexerNode('Mainnet', 'https://main.example.com')
    await selectZeroIndexerNode(mainnet.customEndpoints[0].id)
    assert.deepEqual((await getZeroIndexerBroadcastOptions('testnet', true))?.urls, [
      'https://tee.testnet.unsafe.zec.rocks'
    ])
    const previousFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/v1/zero-indexer-endpoints')) {
        return Response.json({ bad: true })
      }
      return new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } })
    }
    const refreshed = await getZeroIndexerNodeStatus(true)
    assert.equal(refreshed.probes['zero-indexer-mainnet'].status, 'unreachable')
    assert.equal(refreshed.managedEndpoints[0].url, 'https://tee.unsafe.zec.rocks')
    await assert.rejects(
      addCustomZeroIndexerNode('Wrong', 'https://wrong.example.com'),
      /RPC verification returned/
    )
    globalThis.fetch = previousFetch
  } finally {
    environment.restore()
  }
})

test('rejects malformed runtime status and ignores expired or invalid probe caches', async () => {
  const environment = setup()
  try {
    assert.throws(() => parseZeroIndexerNodeStatus(undefined), /Invalid ZeroIndexer node status/)
    assert.throws(
      () => parseZeroIndexerNodeStatus({ enabled: false, network: 'mainnet' }),
      /Invalid ZeroIndexer node status/
    )
    assert.throws(
      () =>
        parseZeroIndexerNodeStatus({
          network: 'wrong',
          enabled: true,
          mode: 'auto',
          selectedEndpointId: null,
          managedEndpoints: [],
          customEndpoints: [],
          orderedEndpointIds: [],
          probes: {}
        }),
      /Invalid ZeroIndexer node status/
    )
    const initial = await getZeroIndexerNodeStatus()
    environment.storage.set(ZERO_INDEXER_RUNTIME_STORAGE_KEY, {
      ...initial,
      probes: { [initial.managedEndpoints[0].id]: { status: 'unreachable' } },
      checkedAt: Number.NaN
    })
    assert.deepEqual((await getZeroIndexerNodeStatus()).probes, {})
    environment.storage.set(ZERO_INDEXER_RUNTIME_STORAGE_KEY, {
      ...initial,
      network: 'invalid',
      checkedAt: Date.now()
    })
    assert.deepEqual((await getZeroIndexerNodeStatus()).probes, {})
  } finally {
    environment.restore()
  }
})
