import { useEffect, useRef, useState } from 'react'
import { accountManager } from '@/core/wallet/account-manager'
import { marginalFeeForTier, type FeeTier } from '@/config/fee'
import { safeBig } from '@/lib/big'
import type { FundingSource } from '@/types'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'

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
  debounceMs?: number
}

/** Builds the same send-max proposal that will be used by the transaction. */
export function useMaxTransferEstimate({
  to,
  memo,
  feeTier,
  fundingSource = 'shielded',
  enabled = true,
  debounceMs = 300
}: UseMaxTransferEstimateArgs): MaxTransferEstimateState {
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentBalance = useAccountDataStore(state => state.getCurrentBalance())
  const sourceAvailable = currentBalance?.confirmed?.[fundingSource] ?? '0'
  const [state, setState] = useState<MaxTransferEstimateState>({
    maxAmount: null,
    fee: null,
    loading: false,
    error: false
  })
  const requestSeq = useRef(0)
  const active = enabled && !!to

  useEffect(() => {
    const seq = ++requestSeq.current
    if (!active) {
      setState({ maxAmount: null, fee: null, loading: false, error: false })
      return
    }

    setState({ maxAmount: null, fee: null, loading: true, error: false })
    const timer = setTimeout(async () => {
      try {
        const requestWalletId = currentWalletId
        const requestAccountId = currentAccountId
        const estimate = await accountManager.estimateMaxTransfer(
          to!,
          memo,
          marginalFeeForTier(feeTier),
          fundingSource
        )
        if (seq !== requestSeq.current) return

        const cachedBalance =
          requestWalletId && requestAccountId
            ? useAccountDataStore
                .getState()
                .getBalance(currentNetwork, requestWalletId, requestAccountId)
            : null
        const cachedSourceZats = safeBig(cachedBalance?.confirmed?.[fundingSource] ?? '0').mul(1e8)
        const estimateTotalZats = safeBig(estimate.maxAmountZats).plus(estimate.feeZats)

        if (requestWalletId && estimateTotalZats.gt(cachedSourceZats)) {
          await accountManager.refreshBalances(requestWalletId, true)
        }

        const walletState = useWalletStore.getState()
        if (
          seq !== requestSeq.current ||
          walletState.currentWalletId !== requestWalletId ||
          walletState.currentAccountId !== requestAccountId ||
          walletState.currentNetwork !== currentNetwork
        ) {
          return
        }
        setState({
          maxAmount: safeBig(estimate.maxAmountZats).div(1e8).toFixed(),
          fee: safeBig(estimate.feeZats).div(1e8).toFixed(),
          loading: false,
          error: false
        })
      } catch {
        if (seq !== requestSeq.current) return
        setState({ maxAmount: null, fee: null, loading: false, error: true })
      }
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [
    to,
    memo,
    feeTier,
    fundingSource,
    active,
    debounceMs,
    currentWalletId,
    currentAccountId,
    currentNetwork,
    sourceAvailable
  ])

  return state
}
