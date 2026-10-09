import { expect, test } from '@playwright/test'
import Big from '../src/lib/big.ts'
import { formatNumber } from '../src/lib/format.ts'
import { formatSendFiatValue } from '../src/popup/components/transaction/send-input-model.ts'

const formatTransactionAmount = amount => formatNumber(amount, {
  rm: Big.roundDown, useUnit: true, useSubscript: true, fallback: '—'
})

test('preserves default numeric formatting and permits an explicit unknown-value placeholder', () => {
  expect(formatNumber(undefined)).toBe('0')
  expect(formatNumber('invalid')).toBe('0')
  expect(formatNumber('0', { fallback: '—' })).toBe('0')
  expect(formatNumber(undefined, { fallback: '—' })).toBe('—')
  expect(formatNumber('1.23456789')).toBe('1.235')
  expect(formatNumber('0.004744096852704854')).toBe('0.004744')
  expect(formatNumber('-12345', { useUnit: true })).toBe('-12.3K')
})

test('bounds long amounts without rounding a displayed spend above its exact value', () => {
  expect(formatTransactionAmount('0.004744096852704854')).toBe('0.004744')
  expect(formatTransactionAmount('0.99955')).toBe('0.9995')
  expect(formatTransactionAmount('12,345.123456789012345678')).toBe('12.3K')
  expect(formatTransactionAmount('999999.999999999999')).toBe('999.9K')
  expect(formatTransactionAmount('12.3456789')).toBe('12.34')
  expect(formatTransactionAmount('1.23456789')).toBe('1.234')
  expect(formatTransactionAmount('0.0123456789')).toBe('0.01234')
  expect(formatTransactionAmount('0.000123456789')).toBe('0.0001234')
  expect(formatTransactionAmount('0')).toBe('0')
  expect(formatTransactionAmount('—')).toBe('—')
  expect(formatTransactionAmount('invalid')).toBe('—')
})

test('keeps dust amounts visible and very large amounts bounded, using exact decimal arithmetic', () => {
  expect(formatTransactionAmount('0.000000000000000001')).toBe('0.0₁₇1')
  expect(formatTransactionAmount('0.000000123456789')).toBe('0.0₆1234')
  expect(formatTransactionAmount('1234567.123456789')).toBe('1.2M')
  expect(formatTransactionAmount('1234567890.123')).toBe('1.2B')
  expect(formatTransactionAmount('123456789012345678901234567890')).toBe('1.234e29')
  expect(formatTransactionAmount('-0.000000123456789')).toBe('-0.0₆1234')
  for (const amount of ['100000000000000000000000000000000', '0.0000000000000000000000000000001']) {
    expect(formatTransactionAmount(amount).length).toBeLessThanOrEqual(12)
    expect(new Big(formatTransactionAmount(amount)).lte(amount)).toBe(true)
  }
})

test('calculates fiat from the unabridged amount rather than its compact presentation', () => {
  expect(formatSendFiatValue('0.004744096852704854', '2707')).toBe('$12.84')
  expect(formatSendFiatValue('1,234.5', '2')).toBe('$2,469')
  expect(formatSendFiatValue('0.004744…', '2707')).toBeNull()
})
