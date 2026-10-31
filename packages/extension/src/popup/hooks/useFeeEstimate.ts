import { useCallback, useEffect, useRef, useState } from 'react'
import { accountManager } from '@/core/wallet/account-manager'
import {
  marginalFeeForTier,
  type FeeQuote,
  type FeeTier,
  type QuotedFeeEstimate
} from '@/config/fee'
import { useSettingsStore } from '@/store/settings-store'
import { useWalletStore } from '@/store/wallet-store'
import type { FundingSource } from '@/types'

export interface FeeEstimateState {
  feeZats: number | null
  feeQuote: FeeQuote | null
  loading: boolean
  error: boolean
  refresh: () => void
}

interface UseFeeEstimateArgs {
  type: 'send' | 'shield'
  to?: string
  amount?: string
  memo?: string
  fundingSource?: FundingSource
  feeTier?: FeeTier
  /** Gate estimation until inputs are valid (e.g. review screen open). */
  enabled?: boolean
  debounceMs?: number
  refreshKey?: number
  estimate?: (tier: FeeTier) => Promise<QuotedFeeEstimate>
}

const emptyEstimate = { feeZats: null, feeQuote: null, loading: false, error: false }
type EstimateCallback = UseFeeEstimateArgs['estimate']
type InternalState = Omit<FeeEstimateState, 'refresh'> & {
  requestKey: string
  estimateCallback?: EstimateCallback
}

/** Estimate the selected tier and retain the quote used to build its proposal. */
export function useFeeEstimate({
  type,
  to,
  amount,
  memo,
  fundingSource = 'shielded',
  feeTier = 'standard',
  enabled = true,
  debounceMs = 500,
  refreshKey = 0,
  estimate
}: UseFeeEstimateArgs): FeeEstimateState {
  const walletId = useWalletStore(state => state.currentWalletId)
  const accountId = useWalletStore(state => state.currentAccountId)
  const network = useWalletStore(state => state.currentNetwork)
  const rpcMode = useSettingsStore(state => state.rpcEndpointModes.zcash)
  const rpcPreference = useSettingsStore(state => state.rpcEndpointPreferences.zcash)
  const customRpc = useSettingsStore(state => state.customRpcEndpoints.zcash)
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<InternalState>({
    ...emptyEstimate,
    requestKey: '',
    estimateCallback: estimate
  })
  const refresh = useCallback(() => setGeneration(value => value + 1), [])
  const requestSeq = useRef(0)

  const active = enabled && (type === 'shield' || (!!to && !!amount && Number(amount) > 0))
  const requestKey = JSON.stringify([
    type,
    to,
    amount,
    memo,
    fundingSource,
    feeTier,
    active,
    walletId,
    accountId,
    network,
    rpcMode,
    rpcPreference,
    customRpc,
    refreshKey,
    generation
  ])

  useEffect(() => {
    const seq = ++requestSeq.current
    if (!active) {
      setState({ ...emptyEstimate, requestKey, estimateCallback: estimate })
      return
    }

    setState({ ...emptyEstimate, loading: true, requestKey, estimateCallback: estimate })
    let expiryTimer: ReturnType<typeof setTimeout> | undefined

    const timer = setTimeout(async () => {
      try {
        let result: QuotedFeeEstimate
        if (estimate) {
          result = await estimate(feeTier)
        } else {
          const quote = await accountManager.getFeeQuote()
          const marginalFeeZats = marginalFeeForTier(feeTier, quote.standardMarginalFeeZats)
          result =
            type === 'shield'
              ? await accountManager.estimateShieldFee(marginalFeeZats, quote.id)
              : await accountManager.estimateTransferFee(
                  to!,
                  amount!,
                  memo,
                  marginalFeeZats,
                  fundingSource,
                  quote.id
                )
          if (result.feeQuote.id !== quote.id) throw new Error('Network fee quote changed')
        }

        if (seq !== requestSeq.current) return
        if (result.feeQuote.expiresAt <= Date.now()) {
          throw new Error('Network fee quote expired')
        }
        if (
          Number(result.marginalFeeZats) !==
          marginalFeeForTier(feeTier, result.feeQuote.standardMarginalFeeZats)
        ) {
          throw new Error('Estimate does not use the selected network fee')
        }
        setState({
          feeZats: Number(result.feeZats),
          feeQuote: result.feeQuote,
          loading: false,
          error: false,
          requestKey,
          estimateCallback: estimate
        })
        expiryTimer = setTimeout(
          () => setGeneration(value => value + 1),
          Math.max(0, result.feeQuote.expiresAt - Date.now())
        )
      } catch {
        if (seq !== requestSeq.current) return
        setState({ ...emptyEstimate, error: true, requestKey, estimateCallback: estimate })
      }
    }, debounceMs)

    return () => {
      clearTimeout(timer)
      clearTimeout(expiryTimer)
      requestSeq.current++
    }
  }, [
    type,
    to,
    amount,
    memo,
    fundingSource,
    feeTier,
    active,
    debounceMs,
    estimate,
    walletId,
    accountId,
    network,
    rpcMode,
    rpcPreference,
    customRpc,
    refreshKey,
    generation,
    requestKey
  ])

  if (state.requestKey !== requestKey || state.estimateCallback !== estimate) {
    return { ...emptyEstimate, loading: active, refresh }
  }
  return {
    feeZats: state.feeZats,
    feeQuote: state.feeQuote,
    loading: state.loading,
    error: state.error,
    refresh
  }
}
