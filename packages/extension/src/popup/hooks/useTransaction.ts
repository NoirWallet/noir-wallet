import { useState, useCallback, useRef } from 'react'
import { buildAccountKey } from '@/store/account-data-store'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { zcashWalletRuntimeClient } from '@/popup/services/zcash-wallet-runtime-client'
import type { AddressType, TransactionType, Transaction, QuoteBinding } from '@/types/wallet'
import type { ZcashOperationAnalyticsContext } from '@/lib/analytics/operations'
import { WALLET_CONFIG } from '@/config/wallet'
import { MARGINAL_FEE_ZATS } from '@/config/fee'
import { sanitizeMarginalFeeZats } from '@/core/zcash/fee-policy'
import { safeBig } from '@/lib/big'
import { classifyError } from '@/lib/errors'
import { sanitizeMemoForRecipient } from '@/lib/zcash-memo'
import { getOwnExtensionSenderContext } from '@/lib/runtime-message-security'
import { TimeoutError } from '@/lib/async-utils'
import { TRANSACTION_PENDING_MESSAGE } from '@/lib/transaction-status-copy'
import { isValidAddTransactionResponse } from '@/lib/transaction-record-response'
import { useAccountDataStore } from '@/store/account-data-store'

export type TransactionStep = 'idle' | 'pending' | 'submitted' | 'confirming' | 'success' | 'failed'

export type TxAnalyticsSpec = ZcashOperationAnalyticsContext

export interface SendTransactionParams {
  to: string
  amount: string
  from: string
  fromType: AddressType
  txType?: TransactionType
  memo?: string
  fee?: string
  /** ZIP-317 marginal fee per action (zatoshis); omitted = standard tier. */
  marginalFeeZats?: number
  /** Expired transaction being retried by this send. */
  replacesTransactionId?: string
  /** Require this exact account to remain active until the send is dispatched. */
  expectedAccountKey?: string
  displayTo?: string
  quoteBinding?: QuoteBinding
  monitorParams?: {
    depositAddress: string
    tokenInSymbol: string
    tokenOutSymbol: string
    amountOut: string
    actionName: string
    originChain?: string
    destinationChain?: string
  }
  /** Context for the background-owned operation outcome event. */
  analytics?: TxAnalyticsSpec
  onCreated?: (transaction: Transaction, accountKey: string) => void
}

export interface TransactionResult {
  step: 'success' | 'pending' | 'failed'
  txHash?: string
  transactionId?: string
  accountKey?: string
  error?: string
  timestamp?: number
}

export interface UseTransactionReturn {
  step: TransactionStep
  txHash: string
  error: string | null
  currentTx: Transaction | null
  sendTransaction: (params: SendTransactionParams) => Promise<TransactionResult>
  reset: () => void
}

function getActiveAccountKey(): string | null {
  const { currentNetwork, currentWalletId, currentAccountId } = useWalletStore.getState()
  return currentWalletId && currentAccountId
    ? buildAccountKey(currentNetwork, currentWalletId, currentAccountId)
    : null
}

function waitForZcashTxCompleted(
  accountKey: string,
  transactionId: string,
  timeoutMs: number,
  dispatch: () => Promise<unknown>
): Promise<{ txHash: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener)
      reject(new TimeoutError('Transaction timed out'))
    }, timeoutMs)

    const listener = (
      message: {
        type?: string
        accountKey?: string
        transactionId?: string
        txHash?: string
        error?: string
        completionPending?: boolean
      },
      sender: chrome.runtime.MessageSender
    ) => {
      if (
        getOwnExtensionSenderContext(sender, chrome.runtime.id) !== 'service-worker' ||
        message.type !== 'ZCASH_TX_COMPLETED' ||
        message.accountKey !== accountKey ||
        message.transactionId !== transactionId
      ) {
        return
      }

      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(listener)

      if (message.error) {
        reject(
          message.completionPending ? new TimeoutError(message.error) : new Error(message.error)
        )
        return
      }
      if (message.txHash) {
        resolve({ txHash: message.txHash })
        return
      }
      reject(new Error('Transaction completed without tx hash'))
    }

    chrome.runtime.onMessage.addListener(listener)
    void dispatch().catch(error => {
      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(listener)
      reject(error)
    })
  })
}

/**
 * Hook for managing transaction lifecycle: create -> send -> update status
 */
export function useTransaction(): UseTransactionReturn {
  const [step, setStep] = useState<TransactionStep>('idle')
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const currentTxRef = useRef<Transaction | null>(null)

  const network = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)

  const sendTransaction = useCallback(
    async (params: SendTransactionParams): Promise<TransactionResult> => {
      const {
        to,
        amount,
        from,
        fromType: _fromType,
        txType = 'send',
        memo: _memo,
        fee: explicitFee,
        marginalFeeZats,
        replacesTransactionId,
        expectedAccountKey,
        displayTo,
        quoteBinding,
        monitorParams,
        analytics,
        onCreated
      } = params
      const fromType: AddressType = _fromType
      const memo = _memo ?? ''
      const onChainMemo = sanitizeMemoForRecipient(to, _memo)

      // Pending record fee: prefer caller-supplied value; otherwise derive a
      // tier-aware approximation from marginalFeeZats so Fast tier doesn't
      // surface as Standard. The on-chain fee will be reconciled when the
      // tx is mined.
      const fee =
        explicitFee ??
        safeBig(WALLET_CONFIG.NETWORK_FEE)
          .times(sanitizeMarginalFeeZats(marginalFeeZats) / MARGINAL_FEE_ZATS.standard)
          .toFixed()

      setStep('pending')
      setError(null)

      if (expectedAccountKey) {
        if (getActiveAccountKey() !== expectedAccountKey) {
          const errorMessage = 'Account changed. Reopen Speed Up.'
          setError(errorMessage)
          setStep('failed')
          return { step: 'failed', error: errorMessage }
        }
        try {
          await rehydrateWalletStore()
        } catch {
          const errorMessage = 'Unable to verify the active account. Please try again.'
          setError(errorMessage)
          setStep('failed')
          return { step: 'failed', error: errorMessage }
        }
      }
      const activeAtStart = expectedAccountKey ? useWalletStore.getState() : null
      const capturedNetwork = activeAtStart?.currentNetwork ?? network
      const capturedWalletId = activeAtStart?.currentWalletId ?? currentWalletId
      const capturedAccountId = activeAtStart?.currentAccountId ?? currentAccountId
      if (!capturedWalletId || !capturedAccountId) {
        const errorMessage = 'No active account selected'
        setError(errorMessage)
        setStep('failed')
        return { step: 'failed', error: errorMessage }
      }

      const accountKey = buildAccountKey(capturedNetwork, capturedWalletId, capturedAccountId)
      if (expectedAccountKey && accountKey !== expectedAccountKey) {
        const errorMessage = 'Account changed. Reopen Speed Up.'
        setError(errorMessage)
        setStep('failed')
        return { step: 'failed', error: errorMessage }
      }
      let tx: Transaction | undefined
      let hash: string | undefined
      try {
        const response: unknown = await chrome.runtime.sendMessage({
          type: 'ADD_TRANSACTION',
          accountKey,
          transaction: {
            txHash: '',
            status: 'pending',
            type: txType,
            amount,
            to: displayTo || to,
            from,
            fromType,
            memo,
            fee,
            timestamp: Date.now(),
            network: capturedNetwork,
            notified: false,
            ...(replacesTransactionId ? { replacesTransactionId } : {}),
            ...(quoteBinding ? { quoteBinding } : {}),
            ...(monitorParams?.depositAddress
              ? { depositAddress: monitorParams.depositAddress }
              : {})
          }
        })

        if (!isValidAddTransactionResponse(response)) {
          const error =
            typeof response === 'object' && response !== null && 'error' in response
              ? String(response.error)
              : 'Failed to add transaction'
          throw new Error(error)
        }

        const recordedTx = response.transaction
        tx = recordedTx
        if (expectedAccountKey) {
          if (getActiveAccountKey() !== expectedAccountKey) {
            throw new Error('Account changed. Reopen Speed Up.')
          }
          await rehydrateWalletStore()
          if (getActiveAccountKey() !== expectedAccountKey) {
            throw new Error('Account changed. Reopen Speed Up.')
          }
        }
        currentTxRef.current = recordedTx
        onCreated?.(recordedTx, accountKey)

        const completion = waitForZcashTxCompleted(
          accountKey,
          recordedTx.id,
          WALLET_CONFIG.SYNC.RPC_TIMEOUT_MS.TRANSACTION,
          () =>
            chrome.runtime.sendMessage({
              type: 'BACKGROUND_ZCASH_TX',
              action: 'send',
              walletId: capturedWalletId,
              accountId: capturedAccountId,
              accountKey,
              transactionId: recordedTx.id,
              txType,
              sendParams: { to, amount, memo: onChainMemo, fundingSource: fromType },
              marginalFeeZats,
              monitorParams: monitorParams
                ? {
                    depositAddress: monitorParams.depositAddress,
                    tokenInSymbol: monitorParams.tokenInSymbol,
                    tokenOutSymbol: monitorParams.tokenOutSymbol,
                    amountIn: amount,
                    amountOut: monitorParams.amountOut,
                    actionName: monitorParams.actionName,
                    originChain: monitorParams.originChain,
                    destinationChain: monitorParams.destinationChain
                  }
                : undefined,
              analytics
            })
        )
        hash = (await completion).txHash

        try {
          zcashWalletRuntimeClient.requestSync()
        } catch {
          // A later scheduled sync can still reconcile the broadcast.
        }

        setTxHash(hash)
        setStep('submitted')
        return {
          step: 'success',
          txHash: hash,
          transactionId: tx.id,
          accountKey,
          timestamp: tx.timestamp
        }
      } catch (err) {
        if (hash && tx) {
          setTxHash(hash)
          setStep('submitted')
          return {
            step: 'success',
            txHash: hash,
            transactionId: tx.id,
            accountKey,
            timestamp: tx.timestamp
          }
        }
        const persisted = tx
          ? await useAccountDataStore
              .getState()
              .reloadTransactions(accountKey)
              .then(() =>
                useAccountDataStore
                  .getState()
                  .getTransactions(accountKey)
                  .find(record => record.id === tx?.id)
              )
              .catch(() => undefined)
          : undefined
        if (persisted?.txHash && tx) {
          setTxHash(persisted.txHash)
          setStep('submitted')
          return {
            step: 'success',
            txHash: persisted.txHash,
            transactionId: tx.id,
            accountKey,
            timestamp: tx.timestamp
          }
        }
        if (err instanceof TimeoutError && tx) {
          setError(TRANSACTION_PENDING_MESSAGE)
          setStep('pending')
          return {
            step: 'pending',
            error: TRANSACTION_PENDING_MESSAGE,
            transactionId: tx.id,
            accountKey,
            timestamp: tx.timestamp
          }
        }
        console.error('Transaction failed:', err)
        const errorMessage =
          expectedAccountKey &&
          err instanceof Error &&
          err.message === 'Account changed. Reopen Speed Up.'
            ? err.message
            : classifyError(err).userMessage

        if (tx)
          await chrome.runtime
            .sendMessage({
              type: 'UPDATE_TRANSACTION',
              accountKey,
              transactionId: tx.id,
              updates: {
                status: 'failed',
                notified: true
              }
            })
            .catch(() => {})

        setError(errorMessage)
        setStep('failed')
        return { step: 'failed', error: errorMessage, transactionId: tx?.id, accountKey }
      }
    },
    [network, currentWalletId, currentAccountId]
  )

  const reset = useCallback(() => {
    setStep('idle')
    setTxHash('')
    setError(null)
    currentTxRef.current = null
  }, [])

  return {
    step,
    txHash,
    error,
    currentTx: currentTxRef.current,
    sendTransaction,
    reset
  }
}
