import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PlannedNotification } from '../src/alert-state'
import { formatSlackNotification, sendSlackNotification } from '../src/slack'

const NOTIFICATION: PlannedNotification = {
  kind: 'opened',
  items: [
    {
      key: 'zcash-mainnet:deltarpc:GetSubtreeRoots',
      chainId: 'zcash-mainnet',
      chain: 'zcash',
      network: 'mainnet',
      targetId: 'deltarpc',
      targetLabel: 'DeltaRPC',
      check: 'GetSubtreeRoots',
      attempts: 3,
      elapsedMs: 20_001,
      error: 'Timed out after 20000ms',
      lastHeight: 3_100_000
    }
  ]
}

test('formats a plain Slack alert with required RPC context', () => {
  const payload = formatSlackNotification(NOTIFICATION, Date.UTC(2026, 8, 4, 1, 2, 3))
  const encoded = JSON.stringify(payload)

  assert.ok(encoded.includes('DeltaRPC'))
  assert.ok(encoded.includes('GetSubtreeRoots'))
  assert.ok(encoded.includes('Timed out after 20000ms'))
  assert.ok(encoded.includes('elapsed=20001ms'))
  assert.ok(encoded.includes('3100000'))
  assert.ok(encoded.includes('2026-09-04T01:02:03.000Z'))
  assert.ok(!encoded.includes('@channel'))
  assert.equal(
    payload.text,
    '2026-09-04T01:02:03.000Z level=ERROR state=open chain="zcash-mainnet" provider="DeltaRPC" method=GetSubtreeRoots attempts=3 elapsed=20001ms height=3100000 error="Timed out after 20000ms"'
  )
  assert.equal(payload.blocks.length, 1)
})

test('posts the payload without exposing the webhook in its body', async () => {
  let requestBody = ''
  await sendSlackNotification(
    'https://hooks.slack.com/services/T000/B000/secret',
    NOTIFICATION,
    0,
    async (_input, init) => {
      requestBody = String(init?.body)
      return new Response('ok', { status: 200 })
    }
  )

  assert.ok(requestBody.includes('DeltaRPC'))
  assert.ok(!requestBody.includes('T000/B000/secret'))
})

test('throws when Slack does not accept the notification', async () => {
  await assert.rejects(
    sendSlackNotification(
      'https://hooks.slack.com/services/T000/B000/secret',
      NOTIFICATION,
      0,
      async () => new Response('rate limited', { status: 429 })
    ),
    /Slack webhook returned HTTP 429/
  )
})
