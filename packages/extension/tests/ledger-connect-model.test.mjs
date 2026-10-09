import { expect, test } from '@playwright/test'
import { parseLedgerAccountIndex } from '../src/popup/pages/hardware/ledger-connect-model.ts'

test('accepts only canonical nonnegative ZIP-32 account indexes', () => {
  expect(parseLedgerAccountIndex('0')).toBe(0)
  expect(parseLedgerAccountIndex('2147483647')).toBe(2147483647)
  for (const value of ['-1', '01', '1.5', '2147483648', '', ' 1']) {
    expect(parseLedgerAccountIndex(value)).toBeNull()
  }
})
