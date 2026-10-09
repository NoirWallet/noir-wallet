/**
 * Analytics logic tests:
 *   pnpm --filter @noir-wallet/extension test:logic
 *
 * Runs directly under Node (>=22, type stripping) against the TS sources.
 * Optional live end-to-end check against the real collector:
 *   ANALYTICS_E2E=1 pnpm --filter @noir-wallet/extension test:logic
 */
import { test as it } from '@playwright/test'
import { mock } from 'node:test'
import assert from 'node:assert/strict'
import { createDecipheriv } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { encryptAnalyticsPayload } from '../src/lib/analytics/crypto.ts'
import {
  ANALYTICS_CHAIN,
  ANALYTICS_EVENTS,
  ANALYTICS_PROJECT_ID,
  PAGE_IDS,
  resolvePageId
} from '../src/lib/analytics/constants.ts'
import { buildPayload, sanitizeAnalyticsMetadata } from '../src/lib/analytics/payload.ts'
import { sanitizeAnalyticsEvent } from '../src/lib/analytics/policy.ts'
import { CUSTOM_ANALYTICS_CONFIG } from '../src/config/analytics.ts'

const PASSWORD = 'analytics-test-password'
globalThis.__CUSTOM_ANALYTICS_PASSWORD__ = PASSWORD
const describe = it.describe

/** Mirrors the backend Go DecryptStringFast: AES-128-CBC, key=iv=password[0:16] */
function decryptLikeGoBackend(encryptedBase64, password) {
  const ciphertext = Buffer.from(encryptedBase64, 'base64')
  assert.ok(ciphertext.length > 0 && ciphertext.length % 16 === 0, 'ciphertext must be 16-aligned')
  const keyIv = Buffer.alloc(16)
  Buffer.from(password).copy(keyIv, 0, 0, 16)
  const decipher = createDecipheriv('aes-128-cbc', keyIv, keyIv)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function waitFor(condition, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const check = () => {
      if (condition()) return resolve()
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('waitFor timed out'))
      setImmediate(check)
    }
    check()
  })
}

describe('crypto: AES-128-CBC compatible with the Go backend', () => {
  const samples = [
    ['typical event batch', JSON.stringify([{ event_name: 'show_page', page_id: 'noir_home' }])],
    ['exactly one block (16 bytes)', '0123456789abcdef'],
    ['tiny payload', 'a'],
    ['multibyte UTF-8', '\u4e2d\u6587\u5185\u5bb9\u6d4b\u8bd5🔒']
  ]

  for (const [label, plaintext] of samples) {
    it(`round-trips: ${label}`, async () => {
      const encrypted = await encryptAnalyticsPayload(plaintext, PASSWORD)
      assert.equal(decryptLikeGoBackend(encrypted, PASSWORD), plaintext)
    })
  }

  it('zero-pads passwords shorter than 16 bytes like Go copy()', async () => {
    const encrypted = await encryptAnalyticsPayload('short-pw', 'abc')
    assert.equal(decryptLikeGoBackend(encrypted, 'abc'), 'short-pw')
  })

  it('uses only the first 16 bytes of long passwords', async () => {
    const encrypted = await encryptAnalyticsPayload('hello', PASSWORD)
    const sameKeyPrefix = PASSWORD.slice(0, 16) + '-DIFFERENT-TAIL'
    assert.equal(decryptLikeGoBackend(encrypted, sameKeyPrefix), 'hello')
  })
})

describe('constants: identifiers and route mapping', () => {
  it('project and chain identifiers are stable', () => {
    assert.equal(ANALYTICS_PROJECT_ID, 'noir_wallet')
    assert.equal(ANALYTICS_CHAIN, 'zcash')
  })

  it('all page_ids are unique and noir_-prefixed', () => {
    const values = Object.values(PAGE_IDS)
    assert.equal(new Set(values).size, values.length)
    for (const value of values) {
      assert.match(value, /^noir_[a-z0-9_]+$/)
    }
  })

  it('all event names are unique snake_case', () => {
    const values = Object.values(ANALYTICS_EVENTS)
    assert.equal(new Set(values).size, values.length)
    for (const value of values) {
      assert.match(value, /^[a-z0-9]+(_[a-z0-9]+)*$/)
    }
  })

  it('resolvePageId maps known routes and strips query params', () => {
    assert.equal(resolvePageId('/'), PAGE_IDS.HOME)
    assert.equal(resolvePageId('/send'), PAGE_IDS.SEND)
    assert.equal(resolvePageId('/send?amount=1'), PAGE_IDS.SEND)
    assert.equal(
      resolvePageId('/onboarding/import-word-count'),
      PAGE_IDS.ONBOARDING_IMPORT_WORD_COUNT
    )
    assert.equal(resolvePageId('/onboarding/import'), PAGE_IDS.ONBOARDING_IMPORT)
    assert.equal(
      resolvePageId('/onboarding/import-zcash-history'),
      PAGE_IDS.ONBOARDING_IMPORT_ZCASH_HISTORY
    )
    assert.equal(resolvePageId('/security-privacy'), PAGE_IDS.SETTINGS_SECURITY_PRIVACY)
    assert.equal(resolvePageId('/zcash-settings'), PAGE_IDS.ZCASH_SETTINGS)
    assert.equal(resolvePageId('/approval'), PAGE_IDS.DAPP_APPROVAL)
  })

  it('resolvePageId degrades gracefully for unknown routes', () => {
    assert.equal(resolvePageId('/future-page/detail'), 'noir_future_page_detail')
    assert.equal(resolvePageId(''), PAGE_IDS.HOME)
  })
})

describe('payload: wire format construction', () => {
  it('fills collector defaults for an empty options object', () => {
    const before = Date.now()
    const payload = buildPayload('test_event', {})
    assert.equal(payload.chain, 'zcash')
    assert.equal(payload.project_id, 'noir_wallet')
    assert.equal(payload.event_name, 'test_event')
    assert.equal(payload.page_id, PAGE_IDS.BACKGROUND)
    assert.equal(payload.has_transaction, 0)
    assert.equal(payload.extra, '')
    assert.equal(payload.input_amount, '')
    assert.equal(payload.wallet_address, '')
    assert.ok(payload.timestamp >= before && payload.timestamp <= Date.now())
  })

  it('keeps allowlisted metadata and strips identifying or sensitive values', () => {
    const payload = buildPayload('test_event', {
      params: {
        origin: 'https://dapp.example',
        amount: '42',
        method: 'hardware',
        previous_version: '1.0.27'
      },
      extra: {
        reason: 'manual',
        tx_hash: 'secret-transaction-hash',
        error: 'raw error containing user data',
        hardware: false
      }
    })
    assert.deepEqual(JSON.parse(payload.extra), {
      method: 'hardware',
      previous_version: '1.0.27',
      reason: 'manual',
      hardware: false
    })
  })

  it('reports valid transaction amounts while stripping wallet identifiers', () => {
    const payload = buildPayload(
      'swap_submitted',
      {
        pageId: PAGE_IDS.SWAP,
        hasTransaction: 1,
        inputAmount: '1.5',
        inputSymbol: 'ZEC',
        outputAmount: '42.1',
        outputSymbol: 'USDC',
        usdAmount: '73.20',
        walletAddress: 'u1abc'
      },
      1234567890
    )
    assert.equal(payload.page_id, 'noir_swap')
    assert.equal(payload.has_transaction, 1)
    assert.equal(payload.input_amount, '1.5')
    assert.equal(payload.input_symbol, 'ZEC')
    assert.equal(payload.output_amount, '42.1')
    assert.equal(payload.output_symbol, 'USDC')
    assert.equal(payload.usd_amount, '73.20')
    assert.equal(payload.wallet_address, '')
    assert.equal(payload.timestamp, 1234567890)
  })

  it('drops malformed or oversized transaction amounts', () => {
    const payload = buildPayload('swap_submitted', {
      inputAmount: '1e9',
      outputAmount: '-2',
      usdAmount: '1'.repeat(129)
    })

    assert.equal(payload.input_amount, '')
    assert.equal(payload.output_amount, '')
    assert.equal(payload.usd_amount, '')
  })

  it('applies the same metadata allowlist used by the GA reporter', () => {
    assert.deepEqual(
      sanitizeAnalyticsMetadata({
        page_location: 'https://noir-wallet.extension/security-privacy',
        page_title: '/security-privacy',
        origin: 'https://dapp.example',
        amount: '1.25',
        error: 'sensitive detail'
      }),
      {
        page_location: 'https://noir-wallet.extension/security-privacy',
        page_title: '/security-privacy'
      }
    )
  })
})

describe('Google Analytics preference: default-on and persisted opt-out', () => {
  it('defaults to enabled and immediately applies an explicit disable', async () => {
    const stored = {}
    const originalChrome = globalThis.chrome
    globalThis.chrome = {
      storage: {
        local: {
          get: async key => ({ [key]: stored[key] }),
          set: async values => Object.assign(stored, values)
        },
        onChanged: {
          addListener: () => {}
        }
      }
    }

    try {
      const { GOOGLE_ANALYTICS_STORAGE_KEY, isGoogleAnalyticsEnabled, setGoogleAnalyticsEnabled } =
        await import('../src/lib/analytics/preferences.ts')

      assert.equal(await isGoogleAnalyticsEnabled(), true)
      await setGoogleAnalyticsEnabled(false)
      assert.equal(stored[GOOGLE_ANALYTICS_STORAGE_KEY], false)
      assert.equal(await isGoogleAnalyticsEnabled(), false)

      await setGoogleAnalyticsEnabled(true)
      assert.equal(await isGoogleAnalyticsEnabled(), true)
    } finally {
      globalThis.chrome = originalChrome
    }
  })
})

describe('privacy policy: outbound event minimization', () => {
  it('drops exact amounts, addresses, origins, hashes and raw errors', () => {
    const event = sanitizeAnalyticsEvent(ANALYTICS_EVENTS.DAPP_TRANSACTION_FAILED, {
      pageId: PAGE_IDS.DAPP,
      hasTransaction: 1,
      inputAmount: '12.345',
      inputSymbol: 'ZEC',
      usdAmount: '999.99',
      walletAddress: 'u1-wallet-address',
      params: {
        origin: 'https://private-dapp.example',
        amount: '12.345',
        hardware: true
      },
      extra: {
        origin: 'https://private-dapp.example',
        error: 'raw signer failure',
        tx_hash: 'transaction-hash',
        deposit_address: 'deposit-address',
        funding_source: 'shielded'
      }
    })

    assert.deepEqual(event, {
      name: ANALYTICS_EVENTS.DAPP_TRANSACTION_FAILED,
      options: {
        pageId: PAGE_IDS.DAPP,
        hasTransaction: 1,
        inputSymbol: 'ZEC',
        extra: { funding_source: 'shielded' }
      }
    })
  })

  it('uses a closed event catalog and per-event fields', () => {
    assert.equal(sanitizeAnalyticsEvent('unreviewed_event', {}), null)

    const created = sanitizeAnalyticsEvent(ANALYTICS_EVENTS.WALLET_CREATED, {
      params: { method: 'import', seed_words: 'never-send' },
      extra: { has_birthday_height: true, mnemonic: 'never-send' }
    })
    assert.deepEqual(created, {
      name: ANALYTICS_EVENTS.WALLET_CREATED,
      options: {
        pageId: PAGE_IDS.BACKGROUND,
        params: { method: 'import' },
        extra: { has_birthday_height: true }
      }
    })
  })

  it('has an explicit policy entry for every catalog event', () => {
    for (const eventName of Object.values(ANALYTICS_EVENTS)) {
      assert.notEqual(sanitizeAnalyticsEvent(eventName, {}), null)
    }
  })
})

describe('channel routing: Google preference does not disable the custom collector', () => {
  it('keeps UI forwarding and collector delivery independent from the Google preference', () => {
    const analyticsIndexSource = readFileSync(
      new URL('../src/lib/analytics/index.ts', import.meta.url),
      'utf8'
    )
    const collectorClientSource = readFileSync(
      new URL('../src/lib/analytics/client.ts', import.meta.url),
      'utf8'
    )
    const collectorFinalization = analyticsIndexSource.slice(
      analyticsIndexSource.indexOf('async function finalizeAndEnqueue'),
      analyticsIndexSource.indexOf('/** Reports an event to both channels.')
    )
    const uiForwarding = analyticsIndexSource.slice(
      analyticsIndexSource.indexOf('// UI contexts: forward to background')
    )

    assert.doesNotMatch(collectorFinalization, /AnalyticsEnabled/)
    assert.doesNotMatch(uiForwarding, /AnalyticsEnabled/)
    assert.doesNotMatch(collectorClientSource, /from ['"]\.\/preferences/)
  })
})

describe('client: batching, retry and drop behaviour', () => {
  it('batches, encrypts, retries on failure and drops after repeated failures', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    const realFetch = globalThis.fetch
    try {
      const fetchCalls = []
      let failuresToServe = 0
      globalThis.fetch = mock.fn(async (url, init) => {
        fetchCalls.push({ url, body: JSON.parse(init.body) })
        if (failuresToServe > 0) {
          failuresToServe--
          return { ok: false, status: 500, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({ code: 0 }) }
      })

      const { clearAnalyticsQueue, enqueueAnalyticsEvent } =
        await import('../src/lib/analytics/client.ts')
      const makeEvent = i => buildPayload('test_event', {}, 1700000000000 + i)

      const batch = Array.from({ length: 20 }, (_, i) => makeEvent(i))
      for (const event of batch) enqueueAnalyticsEvent(event)
      await waitFor(() => fetchCalls.length === 1)

      assert.equal(fetchCalls[0].url, CUSTOM_ANALYTICS_CONFIG.endpoint)
      const decrypted = JSON.parse(decryptLikeGoBackend(fetchCalls[0].body.data, PASSWORD))
      assert.deepEqual(decrypted, batch)

      enqueueAnalyticsEvent(makeEvent(100))
      mock.timers.tick(2000)
      await waitFor(() => fetchCalls.length === 2)
      assert.equal(JSON.parse(decryptLikeGoBackend(fetchCalls[1].body.data, PASSWORD)).length, 1)

      failuresToServe = 1
      enqueueAnalyticsEvent(makeEvent(200))
      mock.timers.tick(2000)
      await waitFor(() => fetchCalls.length === 3)
      mock.timers.tick(15000)
      await waitFor(() => fetchCalls.length === 4)
      assert.deepEqual(fetchCalls[2].body, fetchCalls[3].body)

      failuresToServe = 3
      enqueueAnalyticsEvent(makeEvent(300))
      mock.timers.tick(2000)
      await waitFor(() => fetchCalls.length === 5)
      mock.timers.tick(15000)
      await waitFor(() => fetchCalls.length === 6)
      mock.timers.tick(15000)
      await waitFor(() => fetchCalls.length === 7)
      enqueueAnalyticsEvent(makeEvent(400))
      mock.timers.tick(2000)
      await waitFor(() => fetchCalls.length === 8)
      const lastBatch = JSON.parse(decryptLikeGoBackend(fetchCalls[7].body.data, PASSWORD))
      assert.equal(lastBatch.length, 1)
      assert.equal(lastBatch[0].wallet_address, '')

      enqueueAnalyticsEvent(makeEvent(500))
      clearAnalyticsQueue()
      mock.timers.tick(2000)
      assert.equal(fetchCalls.length, 8)
    } finally {
      globalThis.fetch = realFetch
      mock.timers.reset()
    }
  })
})

describe('collector E2E (opt-in: ANALYTICS_E2E=1)', () => {
  it.skip(
    !process.env.ANALYTICS_E2E || !process.env.CUSTOM_ANALYTICS_PASSWORD,
    'Set ANALYTICS_E2E=1 and CUSTOM_ANALYTICS_PASSWORD to send a live event'
  )

  it('accepts an encrypted integration_test event', async () => {
    const event = buildPayload('integration_test', {
      pageId: PAGE_IDS.BACKGROUND,
      extra: { test: true, source: 'analytics.test.mjs' }
    })
    event.wallet_address = 'anon_automated-test'
    const data = await encryptAnalyticsPayload(
      JSON.stringify([event]),
      process.env.CUSTOM_ANALYTICS_PASSWORD
    )
    const response = await fetch(CUSTOM_ANALYTICS_CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data })
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.code, 0, `collector rejected the event: ${JSON.stringify(body)}`)
  })
})
