import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseZeroIndexerRuntimeOptions,
  readZeroIndexerOptionsForWorker
} from '../src/config/zero-indexer-runtime.ts'

test('runtime configuration preserves ordered broadcast candidates and an explicit opt-out', () => {
  const options = {
    urls: ['https://first.example/', 'https://second.example', 'https://first.example'],
    sendTimeoutMs: 1500
  }
  assert.deepEqual(parseZeroIndexerRuntimeOptions(options), {
    urls: ['https://first.example', 'https://second.example'],
    sendTimeoutMs: 1500
  })
  assert.equal(parseZeroIndexerRuntimeOptions(null), null)
  assert.deepEqual(options.urls, [
    'https://first.example/',
    'https://second.example',
    'https://first.example'
  ])
})

test('runtime configuration rejects malformed or unsafe broadcast options', () => {
  for (const options of [
    undefined,
    [],
    { urls: [] },
    { urls: [null] },
    { urls: ['http://remote.example'] },
    { urls: ['https://user:password@node.example'] },
    { urls: ['https://node.example?credential=secret'] },
    { urls: ['https://node.example'], enabled: true }
  ])
    assert.throws(() => parseZeroIndexerRuntimeOptions(options))
  for (const sendTimeoutMs of [0, -1, 1.5, Infinity, '30000', 0x100000000]) {
    assert.throws(() =>
      parseZeroIndexerRuntimeOptions({ urls: ['https://node.example'], sendTimeoutMs })
    )
  }
})

test('offscreen initialization receives the complete selected list from background', async () => {
  const previousChrome = globalThis.chrome
  const requests = []
  globalThis.chrome = {
    runtime: {
      async sendMessage(request) {
        requests.push(request)
        return {
          success: true,
          options: { urls: ['https://first.example', 'https://second.example'] }
        }
      }
    }
  }
  try {
    assert.deepEqual(await readZeroIndexerOptionsForWorker('testnet'), {
      urls: ['https://first.example', 'https://second.example']
    })
    assert.deepEqual(requests, [{ type: 'GET_ZERO_INDEXER_OPTIONS', network: 'testnet' }])
    globalThis.chrome.runtime.sendMessage = async () => ({ success: true })
    await assert.rejects(readZeroIndexerOptionsForWorker('testnet'))
  } finally {
    globalThis.chrome = previousChrome
  }
})
