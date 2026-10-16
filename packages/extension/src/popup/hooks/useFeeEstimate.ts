import { useEffect, useRef, useState } from 'react'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import { MARGINAL_FEE_ZATS } from '@/config/fee'
import type { FundingSource } from '@/types'

export interface FeeEstimateState {
  /** Standard-tier fee in zatoshis (null while pending/failed); other tiers derive from it. */
  feeZats: number | null
  loading: boolean
  /** True when live estimation failed and callers should fall back to static values. */
  error: boolean
}

interface UseFeeEstimateArgs {
  type: 'send' | 'shield'
  to?: string
  amount?: string
  memo?: string
  fundingSource?: FundingSource
  /** Gate estimation until inputs are valid (e.g. review screen open). */
  enabled?: boolean
  debounceMs?: number
}

/**
 * Live network-fee estimation via a WASM transfer proposal.
 *
 * Always estimates the Standard tier (one proposal build); other tiers scale
 * linearly with the marginal fee and are derived by callers, so switching tier
 * never re-runs WASM. Debounced and guarded against stale responses; failures
 * surface via `error` so the UI can fall back to static figures.
 */
export function useFeeEstimate({
  type,
  to,
  amount,
  memo,
  fundingSource = 'shielded',
  enabled = true,
  debounceMs = 500
}: UseFeeEstimateArgs): FeeEstimateState {
  const [state, setState] = useState<FeeEstimateState>({
    feeZats: null,
    loading: false,
    error: false
  })
  const requestSeq = useRef(0)

  const hasAmount = type === 'shield' || (!!to && !!amount && Number(amount) > 0)
  const active = enabled && hasAmount

  useEffect(() => {
    const seq = ++requestSeq.current
    if (!active) {
      setState({ feeZats: null, loading: false, error: false })
      return
    }

    setState({ feeZats: null, loading: true, error: false })

    const timer = setTimeout(async () => {
      try {
        const feeStr =
          type === 'shield'
            ? await zcashWalletRuntimeClient.estimateShieldFee(MARGINAL_FEE_ZATS.standard)
            : await zcashWalletRuntimeClient.estimateTransferFee({
                to: to!,
                amount: amount!,
                memo,
                marginalFeeZats: MARGINAL_FEE_ZATS.standard,
                fundingSource
              })

        if (seq !== requestSeq.current) return
        setState({ feeZats: Number(feeStr), loading: false, error: false })
      } catch {
        if (seq !== requestSeq.current) return
        setState({ feeZats: null, loading: false, error: true })
      }
    }, debounceMs)

    return () => {
      clearTimeout(timer)
      requestSeq.current += 1
    }
  }, [type, to, amount, memo, fundingSource, active, debounceMs])

  return state
}
