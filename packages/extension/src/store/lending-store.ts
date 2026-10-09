import { create } from 'zustand'
import type { IAssetsView, Portfolio, IConfig, Asset } from '@rhea-finance/cross-chain-sdk'
import {
  checkLendingMcaAccount,
  fetchLendingData,
  getUnclaimedAmount,
  getZecAssetData,
  getSuppliedAmount,
  getCollateralAmount,
  getApyDetails,
  type ApyDetails,
  type LendingSigningMode
} from '@/core/services/lending-service'
import { clearLendingMcaCache } from '@/core/services/lending-mca-cache'
import { useWalletStore } from './wallet-store'
import { safeBig } from '@/lib/big'
import { formatAmount } from '@/lib/format'
import { ZEC_NEAR_TOKEN_ID } from '@/config/near'
import { ZEC_DECIMALS } from '@/config/wallet'
import Big from 'big.js'
import { DedupPromise } from '@/lib/async-utils'
import { readLendingHomeCache, writeLendingHomeCache } from '@/core/services/lending-home-cache'

const ZEC_EXTRA_DECIMALS = 10
const MCA_CACHE_FRESH_MS = 5 * 60 * 1000
const refreshDedups = new Map<string, DedupPromise<void>>()

export interface MarketAssetInfo {
  tokenId: string
  symbol: string
  icon?: string
  price: number
  apy: ApyDetails
  totalSupplied: string
  totalSuppliedUsd: string
  dailyRewardsUsd: string
}

interface LendingStore {
  walletId: string | null
  accountId: string | null
  mcaId: string | null
  publicKey: string | null
  signingMode: LendingSigningMode
  isCheckingMca: boolean
  mcaChecked: boolean

  assetsView: IAssetsView | null
  portfolioView: Portfolio | undefined
  config: IConfig | null
  isLoadingData: boolean
  dataLoaded: boolean
  cachedSuppliedZec: string
  cacheHydrated: boolean

  unclaimedAmount: {
    amount: string
    amountUsd: string
    rawAmount: string
  }

  error: string | null

  checkMcaStatus: () => Promise<void>
  fetchLendingData: () => Promise<void>
  refreshAll: (options?: { forceMcaCheck?: boolean }) => Promise<void>
  reset: () => void

  getZecAsset: () => Asset | null
  getSupplyApy: () => string
  getApyDetails: () => ApyDetails
  getFormattedSupplied: () => string
  getDailyRewardsUsd: () => string
  getSuppliedZec: () => string
  getCollateralZec: () => string
  getTotalSuppliedZec: () => string
  hasMca: () => boolean
  getMarketAssets: () => MarketAssetInfo[]
  getUserSuppliedUsd: () => string
  getNetApy: () => string
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1, baseDelayMs = 750): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

function formatPortfolioSupplied(portfolioView: Portfolio | null | undefined): string {
  const raw = safeBig(getSuppliedAmount(portfolioView))
    .plus(getCollateralAmount(portfolioView))
    .toFixed()
  const formatted = formatAmount(raw, ZEC_EXTRA_DECIMALS + ZEC_DECIMALS)
  return safeBig(formatted).round(ZEC_DECIMALS, Big.roundDown).toFixed()
}

export const useLendingStore = create<LendingStore>()((set, get) => ({
  walletId: null,
  accountId: null,
  mcaId: null,
  publicKey: null,
  signingMode: 'derived' as LendingSigningMode,
  isCheckingMca: false,
  mcaChecked: false,

  assetsView: null,
  portfolioView: undefined,
  config: null,
  isLoadingData: false,
  dataLoaded: false,
  cachedSuppliedZec: '0',
  cacheHydrated: false,

  unclaimedAmount: {
    amount: '0',
    amountUsd: '0',
    rawAmount: '0'
  },

  error: null,

  checkMcaStatus: async () => {
    set({ isCheckingMca: true, error: null })
    const { currentWalletId, currentAccountId } = useWalletStore.getState()

    try {
      const result = await withRetry(() =>
        checkLendingMcaAccount(currentWalletId || undefined, currentAccountId || undefined)
      )
      if (get().walletId !== currentWalletId || get().accountId !== currentAccountId) return

      set({
        mcaId: result.mcaId,
        publicKey: result.publicKey,
        signingMode: result.signingMode,
        isCheckingMca: false,
        mcaChecked: true
      })
    } catch (err) {
      if (get().walletId !== currentWalletId || get().accountId !== currentAccountId) return
      console.error('[LendingStore] checkMcaStatus failed:', err)
      set({
        isCheckingMca: false,
        mcaChecked: false,
        error: err instanceof Error ? err.message : 'Failed to check lending account status'
      })
    }
  },

  fetchLendingData: async () => {
    const { mcaId } = get()
    const { currentWalletId, currentAccountId, currentNetwork } = useWalletStore.getState()

    set({ isLoadingData: true, error: null })

    try {
      const data = await withRetry(() => fetchLendingData(mcaId || undefined))
      const unclaimedAmount = getUnclaimedAmount(data.portfolioView, data.assetsView)
      const suppliedZec = formatPortfolioSupplied(data.portfolioView)

      if (
        !currentWalletId ||
        !currentAccountId ||
        get().walletId !== currentWalletId ||
        get().accountId !== currentAccountId
      ) {
        return
      }

      console.log('[LendingStore] fetchLendingData result:', {
        mcaId,
        portfolioView: data.portfolioView,
        suppliedKeys: data.portfolioView?.supplied ? Object.keys(data.portfolioView.supplied) : [],
        collateralKeys: data.portfolioView?.collateral
          ? Object.keys(data.portfolioView.collateral)
          : [],
        suppliedZec: data.portfolioView?.supplied?.[ZEC_NEAR_TOKEN_ID],
        collateralZec: data.portfolioView?.collateral?.[ZEC_NEAR_TOKEN_ID],
        unclaimedAmount
      })

      set({
        assetsView: data.assetsView,
        portfolioView: data.portfolioView,
        config: data.config,
        unclaimedAmount,
        isLoadingData: false,
        dataLoaded: true,
        cachedSuppliedZec: suppliedZec
      })

      const state = get()
      void writeLendingHomeCache(currentNetwork, currentWalletId, currentAccountId, {
        suppliedZec,
        mcaId: state.mcaId,
        signingMode: state.signingMode,
        mcaChecked: state.mcaChecked,
        updatedAt: Date.now()
      }).catch(error => {
        console.warn('[LendingStore] Failed to cache lending summary:', error)
      })
    } catch (err) {
      if (get().walletId !== currentWalletId || get().accountId !== currentAccountId) return
      console.error('[LendingStore] fetchLendingData failed:', err)
      set({
        isLoadingData: false,
        error: err instanceof Error ? err.message : 'Failed to load lending data'
      })
    }
  },

  refreshAll: async (options?: { forceMcaCheck?: boolean }) => {
    const { currentWalletId, currentAccountId, currentNetwork } = useWalletStore.getState()
    if (get().walletId !== currentWalletId || get().accountId !== currentAccountId) {
      get().reset()
      set({ walletId: currentWalletId, accountId: currentAccountId })
    }

    const refreshKey = `${currentNetwork}:${currentWalletId || 'none'}:${currentAccountId || 'none'}`
    let refreshDedup = refreshDedups.get(refreshKey)
    if (!refreshDedup) {
      refreshDedup = new DedupPromise<void>()
      refreshDedups.set(refreshKey, refreshDedup)
    }

    await refreshDedup.run(async () => {
      if (!get().cacheHydrated && currentWalletId && currentAccountId) {
        try {
          const cached = await readLendingHomeCache(
            currentNetwork,
            currentWalletId,
            currentAccountId
          )
          if (get().walletId !== currentWalletId || get().accountId !== currentAccountId) return

          if (cached) {
            const mcaCacheIsFresh = Date.now() - cached.updatedAt < MCA_CACHE_FRESH_MS
            set({
              cachedSuppliedZec: cached.suppliedZec,
              mcaId: cached.mcaId,
              signingMode: cached.signingMode,
              mcaChecked: cached.mcaChecked && mcaCacheIsFresh && !!cached.mcaId,
              dataLoaded: true
            })
          }
        } catch (error) {
          console.warn('[LendingStore] Failed to restore lending summary:', error)
        } finally {
          if (get().walletId === currentWalletId && get().accountId === currentAccountId) {
            set({ cacheHydrated: true })
          }
        }
      }

      const shouldCheckMca = !get().mcaChecked || options?.forceMcaCheck
      if (shouldCheckMca) {
        if (options?.forceMcaCheck && currentWalletId && currentAccountId) {
          clearLendingMcaCache(currentWalletId, currentAccountId)
        }
        await get().checkMcaStatus()
      }
      await get().fetchLendingData()
    })

    if (!refreshDedup.isPending) {
      refreshDedups.delete(refreshKey)
    }
  },

  reset: () =>
    set({
      walletId: null,
      accountId: null,
      mcaId: null,
      publicKey: null,
      signingMode: 'derived' as LendingSigningMode,
      isCheckingMca: false,
      mcaChecked: false,
      assetsView: null,
      portfolioView: undefined,
      config: null,
      isLoadingData: false,
      dataLoaded: false,
      cachedSuppliedZec: '0',
      cacheHydrated: false,
      unclaimedAmount: {
        amount: '0',
        amountUsd: '0',
        rawAmount: '0'
      },
      error: null
    }),

  getZecAsset: () => getZecAssetData(get().assetsView),

  getSupplyApy: () => {
    return get().getApyDetails().baseApy
  },

  getApyDetails: () => {
    return getApyDetails(get().assetsView)
  },

  getFormattedSupplied: () => {
    if (!get().portfolioView) return get().cachedSuppliedZec
    return formatPortfolioSupplied(get().portfolioView)
  },

  getDailyRewardsUsd: () => {
    const supplied = get().getFormattedSupplied()
    const apyDetails = get().getApyDetails()
    const zecPrice = useWalletStore.getState().zecPrice
    return safeBig(supplied)
      .times(apyDetails.totalMinApy)
      .div(100)
      .div(365)
      .times(zecPrice)
      .toFixed(10)
  },

  getSuppliedZec: () => {
    const val = getSuppliedAmount(get().portfolioView)
    return val
  },

  getCollateralZec: () => {
    const val = getCollateralAmount(get().portfolioView)
    return val
  },

  getTotalSuppliedZec: () => {
    const supplied = get().getSuppliedZec()
    const collateral = get().getCollateralZec()
    const total = safeBig(supplied).plus(collateral).toFixed()
    return safeBig(total).gt(0) ? total : '0'
  },

  hasMca: () => !!get().mcaId,

  getMarketAssets: () => {
    const assetsView = get().assetsView
    if (!assetsView) return []

    const zecAsset = assetsView[ZEC_NEAR_TOKEN_ID]
    if (!zecAsset) return []

    const zecPrice = useWalletStore.getState().zecPrice
    const apy = getApyDetails(assetsView)

    const suppliedBalance = zecAsset.supplied?.balance || '0'
    const extraDecimals = ZEC_EXTRA_DECIMALS + ZEC_DECIMALS
    const totalSupplied = formatAmount(suppliedBalance, extraDecimals)
    const totalSuppliedUsd = safeBig(totalSupplied).times(zecPrice).toFixed(2)

    const dailyRewardsUsd = safeBig(totalSupplied)
      .times(apy.totalMinApy)
      .div(100)
      .div(365)
      .times(zecPrice)
      .toFixed(2)

    return [
      {
        tokenId: ZEC_NEAR_TOKEN_ID,
        symbol: 'ZEC',
        icon: zecAsset.metadata?.icon,
        price: zecPrice,
        apy,
        totalSupplied,
        totalSuppliedUsd,
        dailyRewardsUsd
      }
    ]
  },

  getUserSuppliedUsd: () => {
    const supplied = get().getFormattedSupplied()
    const zecPrice = useWalletStore.getState().zecPrice
    return safeBig(supplied).times(zecPrice).toFixed(2)
  },

  getNetApy: () => {
    const supplied = get().getFormattedSupplied()
    if (safeBig(supplied).eq(0)) return '0'
    const apy = get().getApyDetails()
    return apy.totalMinApy
  }
}))
