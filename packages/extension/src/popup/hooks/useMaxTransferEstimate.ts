import { useEffect, useRef, useState } from 'react'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import type { FeeTier } from '@/config/fee'
import { marginalFeeForTier } from '@/core/zcash/fee-policy'
import { safeBig } from '@/lib/big'
import type { FundingSource } from '@/types'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { getFundingBalance } from '@/core/wallet/funding-balance'

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
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const balance = useAccountDataStore(state => state.getCurrentBalance())
  const sourceAvailable = getFundingBalance(balance, fundingSource).available
  const [state, setState] = useState<MaxTransferEstimateState & { key: string }>({
    key: '',
    maxAmount: null,
    fee: null,
    loading: false,
    error: false
  })
  const requestSeq = useRef(0)
  const requestKey = JSON.stringify([
    to,
    memo,
    feeTier,
    fundingSource,
    enabled,
    currentWalletId,
    currentAccountId,
    currentNetwork,
    sourceAvailable
  ])
  const latest = useRef({ to, memo, feeTier, fundingSource, enabled, key: requestKey })
  latest.current = { to, memo, feeTier, fundingSource, enabled, key: requestKey }
  useEffect(() => {
    requestSeq.current += 1
    const timer = enabled && to ? setTimeout(() => void request(), 300) : undefined
    return () => {
      clearTimeout(timer)
      requestSeq.current += 1
    }
  }, [requestKey])

  const request = async () => {
    const input = latest.current
    if (!input.enabled || !input.to) return
    const seq = ++requestSeq.current
    setState({ key: input.key, maxAmount: null, fee: null, loading: true, error: false })
    try {
      const estimate = await zcashWalletRuntimeClient.estimateMaxTransfer({
        to: input.to,
        memo: input.memo,
        marginalFeeZats: marginalFeeForTier(input.feeTier),
        fundingSource: input.fundingSource
      })
      if (seq !== requestSeq.current || input.key !== latest.current.key) return
      setState({
        key: input.key,
        maxAmount: safeBig(estimate.maxAmountZats).div(1e8).toFixed(),
        fee: safeBig(estimate.feeZats).div(1e8).toFixed(),
        loading: false,
        error: false
      })
    } catch {
      if (seq !== requestSeq.current || input.key !== latest.current.key) return
      setState({ key: input.key, maxAmount: null, fee: null, loading: false, error: true })
    }
  }

  return state.key === requestKey
    ? { ...state, request }
    : { maxAmount: null, fee: null, loading: false, error: false, request }
}
