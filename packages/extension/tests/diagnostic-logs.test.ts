import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAGNOSTIC_LOG_MAX_AGE_MS,
  getDiagnosticErrorDetails,
  getDiagnosticRpcMethod,
  sanitizeDiagnosticText,
  retainDiagnosticEntries,
  serializeDiagnosticArgs,
  type DiagnosticLogEntry
} from '../src/lib/diagnostic-log'
import { formatDiagnosticLogExport } from '../src/lib/diagnostic-log-store'

const SALT = 'diagnostic-test-salt'

function entry(id: number, overrides: Partial<DiagnosticLogEntry> = {}): DiagnosticLogEntry {
  return {
    id,
    source: 'background',
    level: 'debug',
    message: `entry-${id}`,
    timestamp: 1_000_000 + id,
    contextId: 'test-context',
    sequence: id,
    byteSize: 100,
    ...overrides
  }
}

describe('Diagnostic log serialization', () => {
  test('retains actionable native and transport errors without their request payloads', async () => {
    const cause = Object.assign(new Error('gRPC connection closed before the batch completed'), {
      code: 'ECONNRESET',
      response: { data: 'private-response-body' }
    })
    const error = Object.assign(new Error('Batch download failed', { cause }), {
      code: 14,
      status: 503,
      request: { body: 'private-wallet-request' },
      response: { data: 'private-response-body' }
    })
    const serialized = await serializeDiagnosticArgs(
      [
        '[Worker] RPC request failed',
        {
          method: getDiagnosticRpcMethod('wallet.syncNextBatch'),
          error: getDiagnosticErrorDetails(error)
        },
        getDiagnosticErrorDetails({
          name: 'RpcError',
          message: 'upstream unavailable',
          code: -32000,
          details: 'HTTP service returned 503',
          response: { data: 'private-response-body' }
        })
      ],
      SALT
    )

    for (const detail of [
      'wallet.syncNextBatch',
      'Batch download failed',
      'gRPC connection closed before the batch completed',
      'ECONNRESET',
      '"code":14',
      '"status":503',
      '"code":-32000',
      'HTTP service returned 503',
      '"stack"'
    ]) {
      assert.ok(serialized.includes(detail), `Missing support diagnostic: ${detail}`)
    }
    assert.ok(!serialized.includes('private-wallet-request'))
    assert.ok(!serialized.includes('private-response-body'))
  })

  test('keeps error reasons while redacting embedded phrases and multiword credentials', async () => {
    const phrase = `${'abandon '.repeat(11)}art`
    const error = new Error(`WASM import rejected recovery data (${phrase})`, {
      cause: new Error('RPC authentication failed: password=correct horse battery staple; code=401')
    })
    const serialized = await serializeDiagnosticArgs(['Wallet initialization failed', error], SALT)

    assert.ok(serialized.includes('Wallet initialization failed'))
    assert.ok(serialized.includes('WASM import rejected recovery data'))
    assert.ok(serialized.includes('RPC authentication failed'))
    assert.ok(serialized.includes('code=401'))
    assert.ok(!serialized.includes('abandon'))
    assert.ok(!serialized.includes('correct horse battery staple'))
    assert.equal(await sanitizeDiagnosticText(serialized, SALT), serialized)

    const reason =
      'The synchronization request failed because the upstream service closed the connection unexpectedly'
    assert.equal(await serializeDiagnosticArgs([reason], SALT), reason)
  })

  test('projects exceptions without executing accessors and bounds circular causes', () => {
    const error: Record<string, unknown> = { message: 'transport disconnected', code: 14 }
    error.cause = error
    Object.defineProperty(error, 'stack', {
      get() {
        throw new Error('Diagnostic projection must not run getters')
      }
    })
    assert.deepEqual(getDiagnosticErrorDetails(error), {
      message: 'transport disconnected',
      code: 14,
      cause: '[Circular error]'
    })
    const nativeError = new Error('native failure')
    Object.defineProperty(nativeError, 'stack', {
      get() {
        throw new Error('Custom Error stack getters must not run')
      }
    })
    assert.deepEqual(getDiagnosticErrorDetails(nativeError), {
      name: 'Error',
      message: 'native failure'
    })
  })

  test('keeps protocol method names without copying malformed method payloads', () => {
    assert.equal(getDiagnosticRpcMethod('wallet.futureMethod'), 'wallet.futureMethod')
    assert.equal(getDiagnosticRpcMethod('zcash_sendTransaction'), 'zcash_sendTransaction')
    for (const method of [
      { seedPhrase: 'private-data' },
      'wallet.call password=private-data',
      'x'.repeat(81)
    ]) {
      assert.equal(getDiagnosticRpcMethod(method), '[invalid RPC method]')
    }
  })

  test('serializes native values, errors, binary values, and circular structures', async () => {
    const circular: Record<string, unknown> = { label: 'root' }
    circular.self = circular
    const error = new Error('outer failure', { cause: new Error('inner failure') })
    const accessor = Object.defineProperty({}, 'unsafe', {
      enumerable: true,
      get() {
        throw new Error('getter must not run')
      }
    })

    const serialized = await serializeDiagnosticArgs(
      [
        'details',
        {
          bigint: 42n,
          date: new Date('2026-09-17T00:00:00.000Z'),
          map: new Map([['status', 'ready']]),
          set: new Set(['a', 'b']),
          bytes: new Uint8Array([1, 2, 3]),
          buffer: new ArrayBuffer(8),
          blob: new Blob(['private binary'], { type: 'text/plain' }),
          file: new File(['private file'], 'diagnostic.txt', { type: 'text/plain' }),
          circular,
          error,
          accessor,
          missing: undefined
        }
      ],
      SALT
    )

    assert.ok(serialized.includes('details'))
    assert.ok(serialized.includes('[BigInt:42]'))
    assert.ok(serialized.includes('2026-09-17T00:00:00.000Z'))
    assert.ok(serialized.includes('[Map]'))
    assert.ok(serialized.includes('[Set]'))
    assert.ok(serialized.includes('[Uint8Array:3 bytes]'))
    assert.ok(serialized.includes('[ArrayBuffer:8 bytes]'))
    assert.ok(serialized.includes('[Blob:14 bytes:text/plain]'))
    assert.ok(serialized.includes('[File:12 bytes:text/plain]'))
    assert.ok(serialized.includes('[Circular]'))
    assert.ok(serialized.includes('outer failure'))
    assert.ok(serialized.includes('inner failure'))
    assert.ok(serialized.includes('[Unserializable]'))
    assert.ok(serialized.includes('[Undefined]'))
  })

  test('redacts secrets and private wallet data before returning a string', async () => {
    const address = `u1${'a'.repeat(70)}`
    const txHash = 'b'.repeat(64)
    const recoveryPhrase = `${'abandon '.repeat(11)}art`
    const args = {
      password: 'correct horse battery staple',
      seedPhrase: recoveryPhrase,
      privateKey: 'private-key-value',
      memo: 'personal note',
      amount: '12.34',
      balance: 99,
      walletAddress: address,
      txHash,
      origin: 'https://private.example/path?apiKey=secret',
      message: `password=another-secret; sent to ${address} tx ${txHash}`
    }

    const first = await serializeDiagnosticArgs([args], SALT)
    const second = await serializeDiagnosticArgs([args], SALT)

    assert.equal(first, second)
    for (const sensitive of [
      'correct horse battery staple',
      recoveryPhrase,
      'private-key-value',
      'personal note',
      '12.34',
      address,
      txHash,
      'private.example',
      'another-secret'
    ]) {
      assert.ok(!first.includes(sensitive))
    }
    assert.ok(first.includes('[Redacted]'))
    assert.match(first, /\[id:[0-9a-f]{8}\]/)
    assert.match(first, /\[address:[0-9a-f]{8}\]/)
    assert.match(first, /\[tx:[0-9a-f]{8}\]/)
  })

  test('redacts balance logs regardless of pool label or display unit', async () => {
    const serialized = await serializeDiagnosticArgs(
      [
        'transparent=0.005 shielded=1.25 spendable=0.4 pending=0.6',
        'sapling=100 orchard=200 ironwood=300 unshielded=400',
        'Balance updated for account: 0.005 ZEC',
        'Selected 500000 zatoshis worth $12.34 USD'
      ],
      SALT
    )

    for (const sensitive of [
      '0.005',
      '1.25',
      '0.4',
      '0.6',
      '100',
      '200',
      '300',
      '400',
      '500000',
      '12.34'
    ]) {
      assert.ok(!serialized.includes(sensitive))
    }
  })

  test('fingerprints a Worker wallet ID without hiding the failure stage', async () => {
    const walletId = 'wallet-private-name-without-uuid-shape'
    const serialized = await serializeDiagnosticArgs(
      ['[Worker] RPC request failed', { walletId }],
      SALT
    )

    assert.ok(serialized.includes('[Worker] RPC request failed'))
    assert.ok(!serialized.includes(walletId))
    assert.match(serialized, /"walletId":"\[id:[0-9a-f]{8}\]"/)
  })

  test('limits depth, field counts, arrays, and encoded entry size', async () => {
    const deep = { level: { level: { level: { level: { value: 'hidden' } } } } }
    const manyFields = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`field${String(index).padStart(2, '0')}`, index])
    )
    const serialized = await serializeDiagnosticArgs(
      [deep, manyFields, Array.from({ length: 60 }, (_, index) => index), 'x'.repeat(5_000)],
      SALT
    )

    assert.ok(serialized.includes('[MaxDepth:Object]'))
    assert.ok(serialized.includes('10 fields'))
    assert.ok(serialized.includes('[Truncated:10]'))
    assert.ok(new TextEncoder().encode(serialized).byteLength <= 2 * 1024)
    assert.ok(serialized.includes('[Truncated]'))
  })

  test('keeps argument order and sorts object keys', async () => {
    const serialized = await serializeDiagnosticArgs(
      ['first', { zebra: true, alpha: true }, 'last'],
      SALT
    )

    assert.ok(serialized.indexOf('first') < serialized.indexOf('alpha'))
    assert.ok(serialized.indexOf('alpha') < serialized.indexOf('zebra'))
    assert.ok(serialized.indexOf('zebra') < serialized.indexOf('last'))
  })

  test('handles proxies that reject property inspection', async () => {
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('blocked')
        }
      }
    )

    assert.equal(await serializeDiagnosticArgs([proxy], SALT), '[Unserializable]')
  })
})

describe('Help diagnostic export', () => {
  test('exports the original error level, RPC method, reason, code, and cause', async () => {
    const globals: Record<string, unknown> = {
      chrome: { runtime: { getManifest: () => ({ version: '1.0.38' }) } },
      __NETWORK_MODE__: 'testnet',
      __BUILD_CHANNEL__: 'production'
    }
    const descriptors = Object.fromEntries(
      Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
    )
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, { configurable: true, value })
    }
    try {
      const error = Object.assign(new Error('Upstream service unavailable'), {
        code: 14,
        cause: new Error('Connection reset by peer'),
        request: { password: 'private-test-credential' }
      })
      const message = await serializeDiagnosticArgs(
        ['Offscreen: Wallet RPC failed (wallet.syncNextBatch)', getDiagnosticErrorDetails(error)],
        SALT
      )
      const exported = formatDiagnosticLogExport(
        [entry(1, { source: 'offscreen', level: 'error', message })],
        1_001_000
      )

      assert.equal(exported.count, 1)
      assert.ok(exported.text.includes('[offscreen] [ERROR]'))
      assert.ok(exported.text.includes('wallet.syncNextBatch'))
      assert.ok(exported.text.includes('Upstream service unavailable'))
      assert.ok(exported.text.includes('Connection reset by peer'))
      assert.ok(exported.text.includes('"code":14'))
      assert.ok(!exported.text.includes('private-test-credential'))
    } finally {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
})

describe('Diagnostic log retention', () => {
  test('keeps only the newest 500 entries', () => {
    const entries = Array.from({ length: 510 }, (_, index) =>
      entry(index + 1, { timestamp: 1_000_000 + index })
    )
    const retained = retainDiagnosticEntries(entries, 1_000_600)

    assert.equal(retained.length, 500)
    assert.equal(retained[0].id, 11)
    assert.equal(retained.at(-1)?.id, 510)
  })

  test('drops expired entries and respects the total byte limit', () => {
    const now = 100_000_000
    const entries = [
      entry(1, { timestamp: now - DIAGNOSTIC_LOG_MAX_AGE_MS - 1 }),
      ...Array.from({ length: 300 }, (_, index) =>
        entry(index + 2, {
          timestamp: now - 1_000 + index,
          byteSize: 2_100
        })
      )
    ]
    const retained = retainDiagnosticEntries(entries, now)

    assert.equal(
      retained.some(candidate => candidate.id === 1),
      false
    )
    assert.ok(retained.length < 300)
    assert.ok(retained.reduce((total, candidate) => total + candidate.byteSize, 0) <= 512 * 1024)
    assert.equal(retained.at(-1)?.id, 301)
  })
})
