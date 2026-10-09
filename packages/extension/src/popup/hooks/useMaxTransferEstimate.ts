import { useEffect, useRef, useState } from 'react'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import type { FeeTier } from '@/config/fee'
import { marginalFeeForTier } from '@/core/zcash/fee-policy'
import { safeBig } from '@/lib/big'
import type { FundingSource } from '@/types'

export interface MaxTransferEstimateState {
  maxAmount: string | null
  fee: string | null
  loading: boolean
  error: boolean
}

interface UseMaxTransferEstimateArgs {
  to?: string
  memo?: string
  feeTier: FeeTier
  fundingSource?: FundingSource
  enabled?: boolean
}

/** Builds the same send-max proposal that will be used by the transaction. */
export function useMaxTransferEstimate({
  to,
  memo,
  feeTier,
  fundingSource = 'shielded',
  enabled = true
}: UseMaxTransferEstimateArgs): MaxTransferEstimateState & { request: () => Promise<void> } {
  const [state, setState] = useState<MaxTransferEstimateState & { key: string }>({
    key: '',
    maxAmount: null,
    fee: null,
    loading: false,
    error: false
  })
  const requestSeq = useRef(0)
  const requestKey = JSON.stringify([to, memo, feeTier, fundingSource, enabled])
  const latest = useRef({ to, memo, feeTier, fundingSource, enabled })
  latest.current = { to, memo, feeTier, fundingSource, enabled }
  useEffect(() => {
    requestSeq.current += 1
    return () => {
      requestSeq.current += 1
    }
  }, [requestKey])

  const request = async () => {
    const input = latest.current
    if (!input.enabled || !input.to) return
    const seq = ++requestSeq.current
    setState({ key: requestKey, maxAmount: null, fee: null, loading: true, error: false })
    try {
      const estimate = await zcashWalletRuntimeClient.estimateMaxTransfer({
        to: input.to,
        memo: input.memo,
        marginalFeeZats: marginalFeeForTier(input.feeTier),
        fundingSource: input.fundingSource
      })
      if (seq !== requestSeq.current) return
      setState({
        key: requestKey,
        maxAmount: safeBig(estimate.maxAmountZats).div(1e8).toFixed(),
        fee: safeBig(estimate.feeZats).div(1e8).toFixed(),
        loading: false,
        error: false
      })
    } catch {
      if (seq !== requestSeq.current) return
      setState({ key: requestKey, maxAmount: null, fee: null, loading: false, error: true })
    }
  }

  return state.key === requestKey
    ? { ...state, request }
    : { maxAmount: null, fee: null, loading: false, error: false, request }
}
