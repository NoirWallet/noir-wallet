import test from 'node:test'
import assert from 'node:assert/strict'
import { ZcashWorkerClient } from '../src/core/worker/client.ts'

test('force reset reaches offscreen when client is uninitialized and propagates RPC failure', async t => {
  const previousChrome = globalThis.chrome
  const previousLocation = globalThis.location
  globalThis.location = { href: 'chrome-extension://test/popup.html' }
  const requests = []
  let failure = true
  globalThis.chrome = {
    offscreen: {
      async hasDocument() {
        return true
      },
      async createDocument() {}
    },
    runtime: {
      sendMessage(message, callback) {
        requests.push(message)
        callback(failure ? { error: 'Offscreen reset failed' } : { result: true })
      }
    }
  }
  t.after(() => {
    globalThis.chrome = previousChrome
    globalThis.location = previousLocation
  })

  const client = new ZcashWorkerClient('synthetic-wallet')
  await assert.rejects(client.reset({ force: true, strict: true }), /Offscreen reset failed/)
  assert.deepEqual(requests[0], {
    type: 'WORKER_RPC',
    method: 'wallet.reset',
    payload: { walletId: 'synthetic-wallet' }
  })
  failure = false
  await client.reset({ force: true, strict: true })
  assert.equal(requests.length, 2)
})
