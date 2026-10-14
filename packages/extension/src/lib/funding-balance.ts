import { safeBig } from './big'
import type { FundingSource, ZcashBalance } from '@/types'

export interface FundingBalance {
  total: string
  available: string
  spendable: string
  pending: string
}

export function getFundingBalance(
  balance: ZcashBalance | null | undefined,
  source: FundingSource
): FundingBalance {
  const available = safeBig(balance?.confirmed?.[source] ?? '0').toFixed()

  return {
    total: safeBig(balance?.[source] ?? '0').toFixed(),
    available,
    spendable: available,
    pending: safeBig(balance?.pending?.[source] ?? '0').toFixed()
  }
}

export function usesPendingFunds(amount: string, fundingBalance: FundingBalance): boolean {
  const value = safeBig(amount || '0')
  return (
    value.gt(fundingBalance.available) &&
    safeBig(fundingBalance.pending).gt(0) &&
    value.lte(safeBig(fundingBalance.available).plus(fundingBalance.pending))
  )
}

export type FundingAmountError = 'pending' | 'insufficient' | 'fee'

/** A destination-specific Max can narrow the available balance after fees and selection. */
export function getFundingAmountError(
  amount: string,
  fundingBalance: FundingBalance,
  maxAmount?: string | null
): FundingAmountError | null {
  const value = safeBig(amount || '0')
  if (value.gt(fundingBalance.available)) {
    return usesPendingFunds(amount, fundingBalance) ? 'pending' : 'insufficient'
  }
  if (maxAmount != null && value.gt(maxAmount)) return 'fee'
  return null
}
