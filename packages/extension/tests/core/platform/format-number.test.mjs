import { test } from 'node:test'
import { expect } from '@playwright/test'
import Big from '../../../src/lib/big.ts'
import { formatNumber } from '../../../src/lib/format.ts'
import { formatSendFiatValue } from '../../../src/popup/components/transaction/send-input-model.ts'

const formatTransactionAmount = amount =>
  formatNumber(amount, {
    rm: Big.roundDown,
    fallback: '—'
  })

test('uses the shared quantity profile and preserves unknown-value placeholders', () => {
  expect(formatNumber(undefined)).toBe('—')
  expect(formatNumber('invalid')).toBe('—')
  expect(formatNumber('0', { fallback: '—' })).toBe('0')
  expect(formatNumber(undefined, { fallback: '—' })).toBe('—')
  expect(formatNumber('1.23456789')).toBe('1.2345')
  expect(formatNumber('0.004744096852704854')).toBe('0.004744')
  expect(formatNumber('-12345')).toBe('-12,345')
})

test('bounds long amounts without rounding a displayed spend above its exact value', () => {
  expect(formatTransactionAmount('0.004744096852704854')).toBe('0.004744')
  expect(formatTransactionAmount('0.99955')).toBe('0.9995')
  expect(formatTransactionAmount('12,345.123456789012345678')).toBe('12,345.12')
  expect(formatTransactionAmount('999999.999999999999')).toBe('999,999.99')
  expect(formatTransactionAmount('12.3456789')).toBe('12.3456')
  expect(formatTransactionAmount('1.23456789')).toBe('1.2345')
  expect(formatTransactionAmount('0.0123456789')).toBe('0.01234')
  expect(formatTransactionAmount('0.000123456789')).toBe('0.0001234')
  expect(formatTransactionAmount('0')).toBe('0')
  expect(formatTransactionAmount('—')).toBe('—')
  expect(formatTransactionAmount('invalid')).toBe('—')
})

test('keeps dust amounts visible and preserves large whole units with exact decimal arithmetic', () => {
  expect(formatTransactionAmount('0.000000000000000001')).toBe('<0.00000001')
  expect(formatTransactionAmount('0.000000123456789')).toBe('0.00000012')
  expect(formatTransactionAmount('1234567.123456789')).toBe('1,234,567.12')
  expect(formatTransactionAmount('1234567890.123')).toBe('1,234,567,890.12')
  expect(formatTransactionAmount('123456789012345678901234567890')).toBe(
    '123,456,789,012,345,678,901,234,567,890'
  )
  expect(formatTransactionAmount('-0.000000123456789')).toBe('-0.00000012')
  expect(formatTransactionAmount('100000000000000000000000000000000')).toBe(
    '100,000,000,000,000,000,000,000,000,000,000'
  )
  expect(formatTransactionAmount('0.0000000000000000000000000000001')).toBe('<0.00000001')
})

test('calculates fiat from the unabridged amount rather than its compact presentation', () => {
  expect(formatSendFiatValue('0.004744096852704854', '2707')).toBe('$12.84')
  expect(formatSendFiatValue('1,234.5', '2')).toBe('$2,469.00')
  expect(formatSendFiatValue('0.004744…', '2707')).toBeNull()
})
