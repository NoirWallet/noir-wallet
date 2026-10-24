import { useCallback, useState } from 'react'
import { useTransaction } from './useTransaction'
import { useTransactionResultStore } from '@/store/transaction-result-store'
import { useNavigate } from '../provider/Router'
import { accountManager } from '@/core/wallet/account-manager'
import { SpeedUpConfirmSheet } from '../components/transaction/SpeedUpConfirmSheet'
import type { Transaction } from '@/types/wallet'
import { getTransactionRecoveryAction } from '@/lib/transaction-replacement'
import type { FeeTier } from '@/config/fee'
import { toast } from '@/store/toast-store'

/**
 * Drives the Speed Up flow: a confirm sheet (default Fast tier) plus the resend.
 *
 * Re-broadcasts a failed send as a fresh transaction (Zcash has no RBF, so it is
 * a new txid reusing the original recipient/amount). Gating on `failed` ensures
 * the original is dead (expired) so its notes are free; a sync is requested first
 * to reconcile the expired tx before the wallet re-selects inputs.
 *
 * Host `speedUpSheet` on a persistent page (e.g. Home) and call `requestSpeedUp`
 * from transient surfaces like the transaction-detail modal.
 */
export function useSpeedUp() {
  const { sendTransaction } = useTransaction()
  const { setResult, updateStep } = useTransactionResultStore()
  const { navigate } = useNavigate()
  const [sheetTx, setSheetTx] = useState<Transaction | null>(null)
  const [sheetRevision, setSheetRevision] = useState(0)

  const requestSpeedUp = useCallback((tx: Transaction) => {
    if (getTransactionRecoveryAction(tx) === 'speed_up') setSheetTx(tx)
  }, [])

  const executeSpeedUp = useCallback(
    async ({
      amount,
      fee,
      marginalFeeZats,
      feeQuoteId,
      feeTier
    }: {
      amount: string
      fee: string
      marginalFeeZats: number
      feeQuoteId: string
      feeTier: FeeTier
    }) => {
      const tx = sheetTx
      if (!tx) return
      try {
        const currentQuote = await accountManager.getFeeQuote()
        if (currentQuote.id !== feeQuoteId || currentQuote.expiresAt <= Date.now()) {
          throw new Error('Fee estimate changed')
        }
      } catch {
        setSheetRevision(value => value + 1)
        toast.error('Network fee changed', 'Review the updated fee before confirming.')
        return
      }
      setSheetTx(null)

      accountManager.requestSync('transaction')

      const pendingResult = {
        type: 'zcash' as const,
        step: 'pending' as const,
        amount,
        toAddress: tx.to,
        showTo: true
      }
      setResult(pendingResult, '/')
      navigate('/transaction-result')

      const result = await sendTransaction({
        to: tx.to,
        amount,
        from: tx.from,
        fromType: tx.fromType,
        memo: tx.memo,
        fee,
        marginalFeeZats,
        feeQuoteId,
        feeTier,
        replacesTransactionId: tx.id,
        onCreated: (transaction, accountKey) => {
          if (useTransactionResultStore.getState().data !== pendingResult) return
          updateStep('pending', {
            accountKey,
            transactionId: transaction.id,
            timestamp: transaction.timestamp
          })
        }
      })

      if (result.step === 'success') {
        updateStep(
          'submitted',
          { txHash: result.txHash, timestamp: result.timestamp },
          result.accountKey,
          result.transactionId
        )
      } else if (result.step === 'pending') {
        updateStep('pending', { error: result.error }, result.accountKey, result.transactionId)
      } else {
        if (result.transactionId) {
          updateStep('failed', { error: result.error }, result.accountKey, result.transactionId)
        } else if (useTransactionResultStore.getState().data === pendingResult) {
          updateStep('failed', { error: result.error })
        }
      }
    },
    [sheetTx, sendTransaction, setResult, updateStep, navigate]
  )

  const speedUpSheet = (
    <SpeedUpConfirmSheet
      key={sheetRevision}
      open={!!sheetTx}
      onOpenChange={open => !open && setSheetTx(null)}
      tx={sheetTx}
      onConfirm={executeSpeedUp}
    />
  )

  return { requestSpeedUp, speedUpSheet }
}
