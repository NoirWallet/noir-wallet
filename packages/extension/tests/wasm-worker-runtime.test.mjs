import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installWasmWorkerWindowCompatibility } from '../src/core/worker/wasm-worker-runtime.ts'

test('voting WASM receives only the Window APIs available in its worker', async () => {
  const calls = []
  const runtime = {
    fetch() {
      calls.push('fetch')
      return Promise.resolve(new Response())
    },
    setTimeout() {
      calls.push('setTimeout')
      return 7
    },
    clearTimeout() {
      calls.push('clearTimeout')
    },
    performance: { now: () => 42 }
  }

  installWasmWorkerWindowCompatibility(runtime)

  assert.deepStrictEqual(Object.keys(runtime.window).sort(), [
    'clearTimeout',
    'fetch',
    'performance',
    'setTimeout'
  ])
  assert.strictEqual(runtime.window.performance.now(), 42)
  assert.ok(runtime.window instanceof runtime.Window)
  assert.ok(runtime instanceof runtime.Window)
  await runtime.window.fetch('https://example.invalid')
  runtime.window.setTimeout(() => {}, 1)
  runtime.window.clearTimeout(7)
  assert.deepStrictEqual(calls, ['fetch', 'setTimeout', 'clearTimeout'])
})

test('existing Window globals are not replaced', () => {
  const existingWindow = {}
  const runtime = {
    window: existingWindow,
    fetch: globalThis.fetch,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    performance: globalThis.performance
  }

  installWasmWorkerWindowCompatibility(runtime)

  assert.strictEqual(runtime.window, existingWindow)
})
