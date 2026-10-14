import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getFundingAmountError, getFundingBalance } from '../src/lib/funding-balance.ts'

const balance = {
  shielded: '2',
  transparent: '3',
  confirmed: { shielded: '1', transparent: '2.5' },
  pending: { shielded: '0.5', transparent: '0.5', total: '1' }
}

describe('funding amount validation', () => {
  test('accepts only available funds from the selected source', () => {
    const shielded = getFundingBalance(balance, 'shielded')
    const transparent = getFundingBalance(balance, 'transparent')

    assert.equal(getFundingAmountError('1', shielded), null)
    assert.equal(getFundingAmountError('1.00000001', shielded), 'pending')
    assert.equal(getFundingAmountError('1.5', shielded), 'pending')
    assert.equal(getFundingAmountError('1.50000001', shielded), 'insufficient')
    assert.equal(getFundingAmountError('2.5', transparent), null)
    assert.equal(getFundingAmountError('2.50000001', transparent), 'pending')
    assert.equal(getFundingAmountError('3.00000001', transparent), 'insufficient')
  })

  test('enforces the destination-specific Max without lowering displayed Available', () => {
    const source = getFundingBalance(balance, 'shielded')

    assert.equal(getFundingAmountError('0.99985', source, '0.99985'), null)
    assert.equal(getFundingAmountError('0.99985001', source, '0.99985'), 'fee')
    assert.equal(getFundingAmountError('1', source, null), null)
    assert.equal(source.available, '1')
  })

  test('does not permit pending funds when Max is larger than the cached available amount', () => {
    const source = getFundingBalance(balance, 'shielded')

    assert.equal(getFundingAmountError('1.2', source, '1.49985'), 'pending')
    assert.equal(getFundingAmountError('2', source, '1.99985'), 'insufficient')
  })

  test('rejects unavailable funds without assuming every unavailable amount is pending', () => {
    const source = { total: '2', available: '1', spendable: '1', pending: '0' }
    assert.equal(getFundingAmountError('1.1', source), 'insufficient')
    assert.equal(
      getFundingAmountError('0.00000001', getFundingBalance(null, 'shielded')),
      'insufficient'
    )
    assert.equal(getFundingAmountError('', getFundingBalance(null, 'shielded')), null)
    assert.equal(getFundingAmountError('0.00000001', source, '0'), 'fee')
  })
})
