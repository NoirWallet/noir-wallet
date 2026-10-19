import { ANALYTICS_EVENTS, sendAnalyticsEvent } from '@/lib/analytics'
import { useCallback, useRef, useState } from 'react'
import { useTransaction } from './useTransaction'
import { useTransactionResultStore } from '@/store/transaction-result-store'
import { useNavigate } from '../provider/Router'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import { SpeedUpConfirmSheet } from '../components/transaction/SpeedUpConfirmSheet'
import type { Network, Transaction } from '@/types/wallet'
import {
  getSpeedUpConfirmationError,
  getTransactionRecoveryAction
} from '@/lib/transaction-replacement'
import { buildAccountKey } from '@/store/account-data-store'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { loadTransactions } from '@/lib/indexed-db'
import { toast } from '@/store/toast-store'

interface SpeedUpSelection {
  tx: Transaction
  network: Network
  walletId: string
  accountId: string
  accountKey: string
}

function getActiveAccountScope(): Omit<SpeedUpSelection, 'tx'> | null {
  const { currentNetwork, currentWalletId, currentAccountId } = useWalletStore.getState()
  if (!currentWalletId || !currentAccountId) return null
  return {
    network: currentNetwork,
    walletId: currentWalletId,
    accountId: currentAccountId,
    accountKey: buildAccountKey(currentNetwork, currentWalletId, currentAccountId)
  }
}

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
  const [selection, setSelection] = useState<SpeedUpSelection | null>(null)
  const confirmingRef = useRef(false)

  const requestSpeedUp = useCallback((tx: Transaction) => {
    const scope = getActiveAccountScope()
    if (scope && tx.network === scope.network && getTransactionRecoveryAction(tx) === 'speed_up') {
      confirmingRef.current = false
      setSelection({ tx: { ...tx }, ...scope })
    }
  }, [])

  const executeSpeedUp = useCallback(
    async ({
      amount,
      fee,
      marginalFeeZats
    }: {
      amount: string
      fee: string
      marginalFeeZats: number
    }) => {
      if (confirmingRef.current) return
      confirmingRef.current = true
      const opened = selection
      setSelection(null)
      if (!opened) return
      if (getActiveAccountScope()?.accountKey !== opened.accountKey) {
        toast.error('Account changed. Reopen Speed Up.')
        return
      }

      let transactions: Transaction[]
      try {
        transactions = await loadTransactions(opened.accountKey)
        await rehydrateWalletStore()
      } catch {
        toast.error('Unable to verify this transaction')
        return
      }
      const active = getActiveAccountScope()
      const confirmationError = getSpeedUpConfirmationError(
        opened.tx,
        transactions,
        opened.accountKey,
        active?.accountKey ?? null
      )
      if (confirmationError) {
        toast.error(
          confirmationError === 'account_changed'
            ? 'Account changed. Reopen Speed Up.'
            : 'This transaction is no longer eligible for Speed Up'
        )
        return
      }
      const tx = transactions.find(transaction => transaction.id === opened.tx.id)
      if (!tx) return

      zcashWalletRuntimeClient.requestSync()

      const pendingResult = {
        type: 'zcash' as const,
        step: 'pending' as const,
        amount,
        toAddress: tx.to,
        showTo: true
      }
      setResult(pendingResult, '/')
      navigate('/transaction-result')

      const eventOptions = {
        chain: 'zcash' as const,
        inputSymbol: 'ZEC',
        extra: { funding_source: tx.fromType ?? 'shielded', kind: 'send' }
      }
      sendAnalyticsEvent(ANALYTICS_EVENTS.SEND_SUBMITTED, eventOptions)
      const result = await sendTransaction({
        to: tx.to,
        amount,
        from: tx.from,
        fromType: tx.fromType ?? 'shielded',
        memo: tx.memo,
        fee,
        marginalFeeZats,
        replacesTransactionId: tx.id,
        expectedAccountKey: opened.accountKey,
        analytics: { fundingSource: tx.fromType ?? 'shielded' },
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
    [selection, sendTransaction, setResult, updateStep, navigate]
  )

  const speedUpSheet = (
    <SpeedUpConfirmSheet
      open={!!selection}
      onOpenChange={open => !open && setSelection(null)}
      tx={selection?.tx ?? null}
      onConfirm={executeSpeedUp}
    />
  )

  return { requestSpeedUp, speedUpSheet }
}
