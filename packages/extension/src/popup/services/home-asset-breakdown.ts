import Big from '@/lib/big'
import type { PortfolioFiatSummary } from '@/popup/components/portfolio/portfolio-prices'
import type { PortfolioReadModel } from '@/core/portfolio'
import type { ZcashBalance } from '@/types'
import { isPortfolioModelForScope } from './portfolio-cache'

export type HomePortfolioTotalStatus = 'loading' | 'ready' | 'partial' | 'unavailable'

export function resolveHomePortfolioTotalStatus(
  model: PortfolioReadModel | null,
  loadStatus: 'loading' | 'ready' | 'error',
  priceStatus: 'loading' | 'ready' | 'error',
  walletId: string | null,
  accountId: string | null,
  fiat: PortfolioFiatSummary
): HomePortfolioTotalStatus {
  if (!isPortfolioModelForScope(model, walletId, accountId)) {
    return loadStatus === 'loading' ? 'loading' : 'unavailable'
  }
  if (hasCompletePortfolioTotal(model, priceStatus, walletId, accountId, fiat)) return 'ready'
  if (fiat.pricedAssetCount > 0) return 'partial'
  if (model.status === 'empty') return 'ready'
  if (model.status === 'ready' && fiat.missingAssetCount === 0) return 'ready'
  if (loadStatus === 'loading' || model.status === 'loading' || priceStatus === 'loading') {
    return 'loading'
  }
  return 'unavailable'
}

export interface HomeAssetBreakdown {
  readonly publicUsd: string
  readonly confidentialUsd: string
  readonly lendingUsd: string
}

export function hasCompletePortfolioTotal(
  model: PortfolioReadModel | null,
  priceStatus: 'loading' | 'ready' | 'error',
  walletId: string | null,
  accountId: string | null,
  fiat: PortfolioFiatSummary
): boolean {
  return (
    isPortfolioModelForScope(model, walletId, accountId) &&
    model.status === 'ready' &&
    priceStatus === 'ready' &&
    fiat.missingAssetCount === 0 &&
    fiat.staleAssetCount === 0
  )
}

export function getHomeAssetBreakdown(input: {
  readonly multichainEnabled: boolean
  readonly liveMultichainTotal: boolean
  readonly multichainFiat: PortfolioFiatSummary
  readonly zcashBalance: ZcashBalance | null | undefined
  readonly zecPrice: number
  readonly lendingUsd: number
}): HomeAssetBreakdown | null {
  if (input.multichainEnabled) {
    if (!input.liveMultichainTotal) return null
    return Object.freeze({
      publicUsd: input.multichainFiat.mainUsd,
      confidentialUsd: input.multichainFiat.privateUsd,
      lendingUsd: new Big(input.lendingUsd).toFixed()
    })
  }
  if (!input.zcashBalance || input.zecPrice <= 0) return null
  return Object.freeze({
    publicUsd: new Big(input.zcashBalance.transparent).times(input.zecPrice).toFixed(),
    confidentialUsd: new Big(input.zcashBalance.shielded).times(input.zecPrice).toFixed(),
    lendingUsd: new Big(input.lendingUsd).toFixed()
  })
}
