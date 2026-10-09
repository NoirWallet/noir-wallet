import { expect, test } from '@playwright/test'
import { resolveSwapMaximumAdjustment } from '../src/popup/services/swap-maximum.ts'
import { EvmWalletClientError } from '../src/popup/services/evm-wallet-client.ts'
import {
  buildLiveSwapQuoteRequest,
  createSwapQuoteRefreshTarget,
  isSwapQuoteRefreshReady
} from '../src/popup/services/swap-page-model.ts'

function input(overrides = {}) {
  return {
    source: {
      family: 'evm',
      chain: { chain: { id: 'eip155:1' } },
      asset: {
        asset: { kind: 'native' },
        metadata: { decimals: 6 },
        balance: { availableRaw: '1000000' }
      },
      networkFeeAsset: { metadata: { symbol: 'ETH', decimals: 6 } }
    },
    review: {
      quoteHandle: 'quote-1',
      amountIn: '500000',
      execution: { kind: 'evm-transaction', target: '0xcontract' }
    },
    currentAmount: '0.5',
    feeTier: 'standard',
    executionMode: 'main',
    refreshFees: false,
    adjustmentCount: 0,
    ...overrides
  }
}

test('quotes a smaller real native amount before estimating Max or a changed fee tier', async () => {
  const unexpected = async () => {
    throw new Error('must re-quote before estimating the call')
  }
  const dependencies = { getEvmTransactionPlan: unexpected, estimateMaximum: unexpected }
  const full = input({ currentAmount: '1' })
  full.review.amountIn = '1000000'
  await expect(resolveSwapMaximumAdjustment(full, dependencies)).resolves.toEqual({
    amount: '0.5',
    adjustmentCount: 1
  })
  await expect(
    resolveSwapMaximumAdjustment(input({ refreshFees: true }), dependencies)
  ).resolves.toEqual({ amount: '0.25', adjustmentCount: 1 })
})

test('uses the authoritative native contract plan and converges without rounding or repeated preparation', async () => {
  const calls = []
  const transaction = { chainId: 1, to: '0xcontract', data: '0x1234', value: '500000', from: null }
  const dependencies = {
    getEvmTransactionPlan: async handle => {
      calls.push(handle)
      return { transaction, approval: null }
    },
    estimateMaximum: async request => {
      calls.push(request)
      return { amountRaw: '999937' }
    }
  }
  const request = input({ executionMode: 'private' })
  await expect(resolveSwapMaximumAdjustment(request, dependencies)).resolves.toEqual({
    amount: '0.999937',
    adjustmentCount: 1
  })
  expect(calls[1]).toMatchObject({
    evmTransaction: transaction,
    quotedAmountRaw: '500000',
    executionMode: 'private'
  })
  await expect(
    resolveSwapMaximumAdjustment(
      input({ currentAmount: '0.999937', adjustmentCount: 1 }),
      dependencies
    )
  ).resolves.toBeNull()
  await expect(
    resolveSwapMaximumAdjustment(input({ adjustmentCount: 3 }), dependencies)
  ).rejects.toThrow('maximum spendable')
})

test('does not deduct native gas from a token balance or invent transaction gas for signature orders', async () => {
  const unexpected = async () => {
    throw new Error('unexpected preparation')
  }
  const dependencies = { getEvmTransactionPlan: unexpected, estimateMaximum: unexpected }
  const token = input()
  token.source.asset.asset.kind = 'erc20'
  await expect(resolveSwapMaximumAdjustment(token, dependencies)).resolves.toBeNull()
  const signature = input()
  signature.review.execution.kind = 'evm-signature'
  await expect(resolveSwapMaximumAdjustment(signature, dependencies)).resolves.toBeNull()
})

test('rejects a token approval on a native route and falls back when simulation fails', async () => {
  const dependencies = {
    getEvmTransactionPlan: async () => ({ approval: {} }),
    estimateMaximum: async () => {
      throw new Error('simulation failed')
    }
  }
  await expect(resolveSwapMaximumAdjustment(input(), dependencies)).rejects.toThrow('native Swap')
  dependencies.getEvmTransactionPlan = async () => ({ approval: null, transaction: {} })
  await expect(resolveSwapMaximumAdjustment(input(), dependencies)).resolves.toEqual({
    amount: '0.95',
    adjustmentCount: 1
  })
  dependencies.estimateMaximum = async () => {
    throw new Error('Invalid signing summary')
  }
  await expect(resolveSwapMaximumAdjustment(input(), dependencies)).rejects.toThrow(
    'Invalid signing summary'
  )
})

test('re-quotes smaller exact calls when gas consumes more than half the balance, with a bound', async () => {
  const dependencies = {
    getEvmTransactionPlan: async () => ({ approval: null, transaction: {} }),
    estimateMaximum: async () => {
      throw new EvmWalletClientError('insufficient-funds', 'Insufficient funds')
    }
  }
  await expect(
    resolveSwapMaximumAdjustment(input({ adjustmentCount: 1 }), dependencies)
  ).resolves.toEqual({ amount: '0.25', adjustmentCount: 2 })
  await expect(
    resolveSwapMaximumAdjustment(input({ adjustmentCount: 3 }), dependencies)
  ).rejects.toThrow('maximum spendable')
})

test('continues Max review only for the requested new quote, not an old amount or account', () => {
  const options = {
    tokenIn: { assetId: 'ETH', decimals: 18 },
    tokenOut: { assetId: 'BTC' },
    amountIn: '1',
    slippage: 1,
    refundAddress: 'sender',
    recipientAddress: 'recipient',
    blocked: false
  }
  const old = buildLiveSwapQuoteRequest(options)
  const target = createSwapQuoteRefreshTarget(old, { decimal: '0.5', decimals: 18 })
  expect(isSwapQuoteRefreshReady(target, old, old.key)).toBe(false)
  const next = buildLiveSwapQuoteRequest({ ...options, amountIn: '0.5' })
  expect(isSwapQuoteRefreshReady(target, next, old.key)).toBe(false)
  expect(isSwapQuoteRefreshReady(target, next, next.key)).toBe(true)
  const other = buildLiveSwapQuoteRequest({
    ...options,
    amountIn: '0.5',
    refundAddress: 'other-account'
  })
  expect(isSwapQuoteRefreshReady(target, other, other.key)).toBe(false)
})
