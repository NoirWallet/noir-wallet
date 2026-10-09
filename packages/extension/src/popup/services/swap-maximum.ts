import type { RheaSwapEvmTransactionPlan, RheaSwapReviewView } from '@/core/services/rhea-swap'
import type { NetworkFeeTier } from '@/core/transactions/domain'
import { EvmWalletClientError } from './evm-wallet-client'
import { fallbackTransferMaximum } from './transfer-maximum'
import { safeBig } from '@/lib/big'
import {
  formatBaseUnitDecimalAmount,
  parseDisplayUnitAmount
} from '@/popup/components/portfolio/portfolio-format'
import type {
  QuoteDepositExecutionMode,
  QuoteDepositTransferClient,
  WalletOwnedQuoteAsset
} from './quote-deposit-transfer-client'

interface SwapMaximumInput {
  readonly source: WalletOwnedQuoteAsset
  readonly review: RheaSwapReviewView
  readonly currentAmount: string
  readonly feeTier: NetworkFeeTier
  readonly executionMode: QuoteDepositExecutionMode
  readonly refreshFees: boolean
  readonly adjustmentCount: number
}

interface SwapMaximumDependencies {
  readonly getEvmTransactionPlan: (quoteHandle: string) => Promise<RheaSwapEvmTransactionPlan>
  readonly estimateMaximum: QuoteDepositTransferClient['estimateMaximum']
}

export interface SwapMaximumAdjustment {
  readonly amount: string
  readonly adjustmentCount: number
}

export function resolveZcashSwapMaximumAdjustment(input: {
  readonly currentAmount: string
  readonly exactMaximum: string | null
  readonly adjustmentCount: number
}): SwapMaximumAdjustment | null {
  if (input.exactMaximum === null || safeBig(input.currentAmount).eq(input.exactMaximum))
    return null
  if (safeBig(input.exactMaximum).lte(0) || input.adjustmentCount >= 2)
    throw new Error('Unable to calculate the maximum spendable amount for this quote')
  return { amount: input.exactMaximum, adjustmentCount: input.adjustmentCount + 1 }
}

function maximumAdjustment(
  input: SwapMaximumInput,
  amountRaw: string,
  adjustmentCount: number
): SwapMaximumAdjustment | null {
  const amount = BigInt(amountRaw)
  if (amount <= 0n) throw new Error('The source wallet balance does not cover the network fee')
  if (
    amount ===
    BigInt(parseDisplayUnitAmount(input.currentAmount, input.source.asset.metadata.decimals))
  ) {
    return null
  }
  const limit = input.source.family === 'evm' ? 3 : 2
  if (adjustmentCount >= limit) {
    throw new Error('Unable to calculate the maximum spendable amount for this quote')
  }
  return {
    amount: formatBaseUnitDecimalAmount(amountRaw, input.source.asset.metadata.decimals),
    adjustmentCount: adjustmentCount + 1
  }
}

function isFeeServiceFailure(error: unknown): boolean {
  if (error instanceof EvmWalletClientError)
    return (
      error.code === 'network-unavailable' ||
      error.code === 'request-failed' ||
      error.code === 'unavailable'
    )
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      /simulation|network|rpc|timeout|fetch|request failed/i.test(error.message))
  )
}

export async function resolveSwapMaximumAdjustment(
  input: SwapMaximumInput,
  dependencies: SwapMaximumDependencies
): Promise<SwapMaximumAdjustment | null> {
  const { source, review } = input
  if (!review.execution.target) return null
  let evmTransaction: RheaSwapEvmTransactionPlan['transaction'] | undefined
  if (source.family === 'evm') {
    // Tokens retain their full token balance; signature routes have no origin-chain transaction fee.
    if (source.asset.asset.kind !== 'native' || review.execution.kind !== 'evm-transaction')
      return null
    const availableRaw = BigInt(source.asset.balance.availableRaw)
    if (
      (BigInt(review.amountIn) >= availableRaw && input.adjustmentCount === 0) ||
      input.refreshFees
    ) {
      // Request a real smaller quote, never alter value independently of the router's calldata.
      const halfBalance = availableRaw / 2n
      const probeRaw = halfBalance === BigInt(review.amountIn) ? halfBalance / 2n : halfBalance
      if (probeRaw <= 0n)
        throw new Error('The source wallet balance does not cover the network fee')
      return {
        amount: formatBaseUnitDecimalAmount(probeRaw.toString(), source.asset.metadata.decimals),
        adjustmentCount: 1
      }
    }
    const plan = await dependencies.getEvmTransactionPlan(review.quoteHandle)
    if (plan.approval) throw new Error('A native Swap cannot require a token approval')
    evmTransaction = plan.transaction
  }
  try {
    const maximum = await dependencies.estimateMaximum({
      source,
      depositAddress: review.execution.target,
      feeTier: input.feeTier,
      executionMode: input.executionMode,
      ...(evmTransaction ? { evmTransaction, quotedAmountRaw: review.amountIn } : {})
    })
    return maximumAdjustment(input, maximum.amountRaw, input.adjustmentCount)
  } catch (error) {
    if (
      evmTransaction &&
      error instanceof EvmWalletClientError &&
      error.code === 'insufficient-funds'
    ) {
      return maximumAdjustment(
        input,
        (BigInt(review.amountIn) / 2n).toString(),
        input.adjustmentCount
      )
    }
    if (!isFeeServiceFailure(error)) throw error
    return maximumAdjustment(
      input,
      fallbackTransferMaximum(source).amountRaw,
      input.adjustmentCount
    )
  }
}
