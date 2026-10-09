import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { prepareTransparentSpend } from '../src/core/wallet/transparent-spend-preflight.ts'

function balance({ transparent, confirmed, pending }) {
  return {
    transparent,
    shielded: '0',
    total: transparent,
    available: confirmed,
    spendable: confirmed,
    shieldable: confirmed,
    shieldedPools: { sapling: '0', orchard: '0', ironwood: '0' },
    confirmed: { shielded: '0', transparent: confirmed },
    pending: { shielded: '0', transparent: pending, total: pending }
  }
}

describe('transparent spend preflight', () => {
  test('refreshes transparent UTXOs before accepting a spend', async () => {
    const calls = []
    const freshBalance = balance({ transparent: '1', confirmed: '1', pending: '0' })
    const result = await prepareTransparentSpend(
      {
        syncSessionSetup: async () => calls.push('refresh'),
        getBalance: async () => {
          calls.push('balance')
          return freshBalance
        }
      },
      '0.5'
    )

    assert.deepStrictEqual(calls, ['refresh', 'balance'])
    assert.strictEqual(result, freshBalance)
  })

  test('lets WASM selection decide whether refreshed pending funds are spendable', async () => {
    const freshBalance = balance({ transparent: '1', confirmed: '0.4', pending: '0.6' })
    const result = await prepareTransparentSpend(
      {
        syncSessionSetup: async () => {},
        getBalance: async () => freshBalance
      },
      '0.5'
    )

    assert.strictEqual(result, freshBalance)
  })
})
