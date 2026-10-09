import { create } from 'zustand'
import type { TransactionStep } from '@/popup/hooks/useTransaction'
import type { SwapStatus } from '@/core/services/intents-api'
import type { Transaction } from '@/types/wallet'

interface ZcashTransactionResult {
  type: 'zcash'
  step: TransactionStep
  amount: string
  fromAddress?: string
  toAddress?: string
  txHash?: string
  error?: string | null
  accountKey?: string
  transactionId?: string
  timestamp?: number
  customTitle?: string
  customDescription?: string
  showFrom?: boolean
  showTo?: boolean
  showTxHash?: boolean
  showTime?: boolean
  extraDetails?: Array<{ label: string; value: string }>
}

interface SwapTransactionResult {
  type: 'swap'
  depositAddress: string
  status: SwapStatus | null
  tokenInSymbol: string
  tokenOutSymbol: string
  amountIn: string
  amountOut: string
  actionName?: string
  destinationChain?: string
  zcashTxHash?: string
  /** ZEC fee paid for the on-chain leg, when known (e.g. Supply). */
  fee?: string
  onBack?: () => void
}

export type TransactionResultData = ZcashTransactionResult | SwapTransactionResult

export function resolveZcashResultView(
  result: Pick<ZcashTransactionResult, 'step' | 'txHash' | 'timestamp'>,
  record?: Transaction
): { step: TransactionStep; txHash?: string; timestamp?: number } {
  let step = result.step
  if (record?.status === 'success' || record?.status === 'failed') step = record.status
  else if (record?.status === 'confirming') step = 'confirming'
  else if (record?.txHash && (step === 'idle' || step === 'pending')) step = 'submitted'
  return {
    step,
    txHash: record?.txHash || result.txHash,
    timestamp: record?.timestamp ?? result.timestamp
  }
}

interface TransactionResultStore {
  data: TransactionResultData | null
  returnPath: string
  setResult: (data: TransactionResultData, returnPath?: string) => void
  updateStep: (
    step: TransactionStep,
    updates?: Partial<ZcashTransactionResult>,
    accountKey?: string,
    transactionId?: string
  ) => void
  updateSwapStatus: (status: SwapStatus) => void
  updateSwapTxHash: (txHash: string) => void
  clear: () => void
}

export const useTransactionResultStore = create<TransactionResultStore>()((set, get) => ({
  data: null,
  returnPath: '/',

  setResult: (data, returnPath = '/') => {
    set({ data, returnPath })
  },

  updateStep: (step, updates, accountKey, transactionId) => {
    const current = get().data
    if (!current || current.type !== 'zcash') return
    if (accountKey && current.accountKey !== accountKey) return
    if (transactionId && current.transactionId !== transactionId) return
    if ((current.step === 'success' || current.step === 'failed') && step !== current.step) return
    if ((current.step === 'submitted' || current.step === 'confirming') && step === 'pending')
      return
    if (current.step === 'confirming' && step === 'submitted') return
    set({
      data: { ...current, step, ...updates }
    })
  },

  updateSwapStatus: status => {
    const current = get().data
    if (!current || current.type !== 'swap') return
    set({
      data: { ...current, status }
    })
  },

  updateSwapTxHash: txHash => {
    const current = get().data
    if (!current || current.type !== 'swap') return
    set({
      data: { ...current, zcashTxHash: txHash }
    })
  },

  clear: () => {
    set({ data: null, returnPath: '/' })
  }
}))
