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
  return value.gt(fundingBalance.available) && value.lte(fundingBalance.total)
}
