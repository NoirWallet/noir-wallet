import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapWasmAccountBalanceToZcashBalance } from '../src/core/wallet/balance-summary.ts'
import {
  canShieldTransparentFunds,
  getShieldableTransparentBalance,
  getShieldInputAmountFromHistory
} from '../src/core/zcash/shielding.ts'

describe('Shielding minimum balance regressions', () => {
  it('excludes pending transparent funds from the shield amount', () => {
    const balance = mapWasmAccountBalanceToZcashBalance({
      unshielded_balance: 328_475,
      unshielded_pending_balance: 152_925,
      unshielded_total_balance: 481_400
    })

    assert.equal(balance.transparent, '0.004814')
    assert.equal(balance.pending?.transparent, '0.00152925')
    assert.equal(balance.shieldable, '0.00328475')
    assert.equal(getShieldableTransparentBalance(balance), '0.00328475')
  })

  it('does not offer shielding when all transparent funds are pending', () => {
    const balance = mapWasmAccountBalanceToZcashBalance({
      unshielded_balance: 0,
      unshielded_pending_balance: 144_300,
      unshielded_total_balance: 144_300
    })

    assert.equal(balance.transparent, '0.001443')
    assert.equal(balance.shieldable, '0')
    assert.equal(canShieldTransparentFunds(balance), false)
  })

  it('uses the inputs selected by the broadcast shield transaction', () => {
    const txidBytes = Array.from({ length: 32 }, (_, index) => index)
    const txid = [...txidBytes]
      .reverse()
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')

    assert.equal(
      getShieldInputAmountFromHistory(
        [
          {
            txid: txidBytes,
            kind: 'shield',
            amount_zatoshis: 330_000,
            fee_zatoshis: 20_000,
            mined_height: null,
            status: 'pending',
            timestamp: null,
            memo: null
          }
        ],
        txid
      ),
      '0.0035'
    )
  })
})
