import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { SWAP_QUOTE_UNAVAILABLE_MESSAGE, fetchQuote } from '../src/core/services/intents-api'
import { FetchHttpError, fetchWithTimeout } from '../src/lib/fetch-utils'

const quoteParams = {
  originAsset: 'zec:native',
  destinationAsset: 'near:native',
  amount: '100000000',
  refundTo: 't1JeD77bXpj67Fe1umL1ZkpqrnPT1pPfbHA',
  recipient: 'noir-wallet-placeholder.near',
  originChain: 'zec',
  destinationChain: 'near'
}

test('does not expose an upstream HTML error page', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('<!DOCTYPE html><html><body>proxy details</body></html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html' }
    })

  try {
    const error = await fetchWithTimeout('https://service.example.test').catch(cause => cause)
    assert.ok(error instanceof FetchHttpError)
    assert.equal(error.message, 'HTTP 502: Bad Gateway')
    assert.equal(error.detail, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('identifies a 502 from the quote API as a swap service failure', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response('<html><body>upstream unavailable</body></html>', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/html' }
    })

  try {
    const result = await fetchQuote(quoteParams)
    assert.equal(result.quoteStatus, 'error')
    assert.equal(result.message, SWAP_QUOTE_UNAVAILABLE_MESSAGE)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves actionable JSON details from a rejected quote request', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'Minimum amount is 0.01 ZEC' }), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json' }
    })

  try {
    const result = await fetchQuote(quoteParams)
    assert.equal(result.quoteStatus, 'error')
    assert.equal(result.message, 'Minimum amount is 0.01 ZEC')
  } finally {
    globalThis.fetch = originalFetch
  }
})
