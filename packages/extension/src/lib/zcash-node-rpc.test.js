import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { lookupTransaction, getTransactionConfirmations } from './zcash-node-rpc.ts'

const NODE = 'https://node.example'
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function respondOkJson(body) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    async json() {
      return body
    },
    async text() {
      return JSON.stringify(body)
    }
  })
}

test('classifies a mined tx as confirmed with its confirmation count', async () => {
  respondOkJson({ jsonrpc: '2.0', id: 1, result: { txid: 'abc', confirmations: 12 } })

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'confirmed', confirmations: 12 })
  assert.equal(await getTransactionConfirmations(NODE, 'abc'), 12)
})

test('classifies a tx with zero confirmations as mempool', async () => {
  respondOkJson({ result: { txid: 'abc', confirmations: 0 } })

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'mempool' })
  assert.equal(await getTransactionConfirmations(NODE, 'abc'), 0)
})

test('treats a missing confirmations field as mempool', async () => {
  respondOkJson({ result: { txid: 'abc' } })

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'mempool' })
})

test('maps the -5 RPC error to an authoritative notfound', async () => {
  respondOkJson({ error: { code: -5, message: 'No information available about transaction' } })

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'notfound' })
  assert.equal(await getTransactionConfirmations(NODE, 'abc'), null)
})

test('maps any other RPC error code to a transient error', async () => {
  respondOkJson({ error: { code: -8, message: 'boom' } })

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'error' })
  assert.equal(await getTransactionConfirmations(NODE, 'abc'), null)
})

test('maps a network failure to a transient error', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down')
  }

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'error' })
  assert.equal(await getTransactionConfirmations(NODE, 'abc'), null)
})

test('maps a non-2xx HTTP response to a transient error', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Server Error',
    async json() {
      return {}
    },
    async text() {
      return 'oops'
    }
  })

  assert.deepEqual(await lookupTransaction(NODE, 'abc'), { status: 'error' })
})
