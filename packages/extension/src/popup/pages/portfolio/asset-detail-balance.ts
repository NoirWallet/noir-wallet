import type { PortfolioBalanceView } from '@/core/portfolio'
import { formatDisplayTokenAmount } from '@/popup/components/portfolio/portfolio-format'

export function getZcashPrivacyBalanceDisplay(balance: PortfolioBalanceView, decimals: number) {
  const formatPending = (raw: string | undefined) =>
    raw && BigInt(raw) > 0n ? formatDisplayTokenAmount(raw, decimals) : null

  return {
    shielded: formatDisplayTokenAmount(balance.shieldedRaw ?? '0', decimals),
    transparent: formatDisplayTokenAmount(balance.transparentRaw ?? '0', decimals),
    shieldedPending: formatPending(balance.shieldedPendingRaw),
    transparentPending: formatPending(balance.transparentPendingRaw)
  }
}
