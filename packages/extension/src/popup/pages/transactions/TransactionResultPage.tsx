import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '../../components/common/PageHeader'
import { StandardTransactionResult } from '../../components/transaction/StandardTransactionResult'
import { SwapStatusDisplay } from '../../components/swap/SwapStatus'
import { resolveZcashResultView, useTransactionResultStore } from '@/store/transaction-result-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { useWalletStore } from '@/store/wallet-store'
import { useNavigate } from '../../provider/Router'
import { pollingSwapStatus } from '@/core/services/intents-api'
import {
  getConfirmationFailureResultCopy,
  getConfirmedTransactionResultCopy,
  getStandardTransactionResultCopy,
  getSubmittedTransactionResultCopy
} from '@/lib/transaction-status-copy'
import { getTransactionRecoveryAction } from '@/lib/transaction-replacement'
import { useSpeedUp } from '@/popup/hooks/useSpeedUp'
import { isTransactionStatusUpdatedMessage } from '@/types/transaction-messages'
import { isZcashDestination } from '@/lib/cross-chain-transaction'
import { pollingTransactionConfirmations } from '@/lib/zcash-node-rpc'
import { getNetworkConfig } from '@/config/networks'
import { WALLET_CONFIG } from '@/config/wallet'

export function TransactionResultPage() {
  const { navigate, goBack } = useNavigate()
  const { requestSpeedUp, speedUpSheet } = useSpeedUp()
  const { data, returnPath, clear, updateStep, updateSwapStatus } = useTransactionResultStore()
  const dataRef = useRef(data)
  const [destinationConfirmations, setDestinationConfirmations] = useState<number | null>(null)
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const resultAccountKey = data?.type === 'zcash' ? data.accountKey : undefined
  const resultTransactionId = data?.type === 'zcash' ? data.transactionId : undefined
  const resultTransaction = useAccountDataStore(state => {
    if (!resultAccountKey || !resultTransactionId) return undefined
    return state.getTransactions(resultAccountKey).find(tx => tx.id === resultTransactionId)
  })
  const resultView =
    data?.type === 'zcash' ? resolveZcashResultView(data, resultTransaction) : undefined
  const resultStep = resultView?.step ?? 'idle'
  const recoveryAction = getTransactionRecoveryAction(resultTransaction)
  const syncState = useAccountDataStore(state =>
    currentWalletId
      ? state.getWalletSyncState(currentNetwork, currentWalletId)
      : { isSyncing: false }
  )
  const swapDepositAddress = data?.type === 'swap' ? data.depositAddress : undefined
  const waitsForZcashDestination =
    data?.type === 'swap' &&
    data.status?.status === 'SUCCESS' &&
    isZcashDestination({
      destinationAsset: data.status.destinationAsset,
      destinationChain: data.destinationChain
    })
  const destinationZcashTxHash =
    waitsForZcashDestination && data.status?.swapDetails?.destinationChainTxHashes?.length
      ? data.status.swapDetails.destinationChainTxHashes[0].hash
      : undefined

  useEffect(() => {
    dataRef.current = data
  }, [data])

  useEffect(() => {
    if (resultAccountKey && resultTransactionId) {
      void useAccountDataStore.getState().reloadTransactions(resultAccountKey)
    }
  }, [resultAccountKey, resultTransactionId])

  useEffect(() => {
    if (!data) {
      navigate('/', { replace: true })
    }
  }, [])

  useEffect(() => {
    if (!swapDepositAddress) return

    const controller = new AbortController()
    void pollingSwapStatus(swapDepositAddress, status => updateSwapStatus(status), {
      interval: 5_000,
      signal: controller.signal
    }).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('[TransactionResultPage] Status polling failed:', error)
    })

    return () => controller.abort()
  }, [swapDepositAddress, updateSwapStatus])

  useEffect(() => {
    setDestinationConfirmations(null)
    if (!waitsForZcashDestination || !destinationZcashTxHash) return

    const rpcUrl = getNetworkConfig(currentNetwork).nodeRpcUrl
    if (!rpcUrl) return

    const controller = new AbortController()
    void pollingTransactionConfirmations(
      rpcUrl,
      destinationZcashTxHash,
      WALLET_CONFIG.SPENDABILITY_CONFIRMATIONS,
      setDestinationConfirmations,
      { interval: 5_000, signal: controller.signal }
    ).catch(error => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.error('[TransactionResultPage] Zcash confirmation polling failed:', error)
    })

    return () => controller.abort()
  }, [currentNetwork, destinationZcashTxHash, waitsForZcashDestination])

  useEffect(() => {
    const listener = (message: any) => {
      const currentData = dataRef.current

      if (
        message.type === 'ZCASH_TX_COMPLETED' &&
        currentData?.type === 'zcash' &&
        currentData.step === 'pending' &&
        currentData.accountKey === message.accountKey &&
        currentData.transactionId === message.transactionId
      ) {
        if (message.error) {
          const outcomeStep = message.completionPending === true ? 'pending' : 'failed'
          const copy = getStandardTransactionResultCopy(outcomeStep, {
            shield: currentData.customTitle?.includes('Shield'),
            error: message.error
          })
          updateStep(
            outcomeStep,
            {
              error: message.error,
              customTitle: copy.title,
              customDescription: copy.description
            },
            message.accountKey,
            message.transactionId
          )
        } else if (message.txHash) {
          const copy = getSubmittedTransactionResultCopy(
            currentData.customTitle?.includes('Shield')
          )
          updateStep(
            'submitted',
            {
              txHash: message.txHash,
              customTitle: copy.title,
              customDescription: copy.description
            },
            message.accountKey,
            message.transactionId
          )
        }
      }

      if (
        isTransactionStatusUpdatedMessage(message) &&
        currentData?.type === 'zcash' &&
        currentData.accountKey === message.accountKey &&
        currentData.transactionId === message.transactionId
      ) {
        if (message.status === 'success') {
          const copy = getConfirmedTransactionResultCopy()
          updateStep(
            'success',
            {
              customTitle: copy.title,
              customDescription: copy.description
            },
            message.accountKey,
            message.transactionId
          )
        } else if (message.status === 'failed') {
          const copy = getConfirmationFailureResultCopy(message.failureReason)
          updateStep(
            'failed',
            {
              customTitle: copy.title,
              customDescription: copy.description,
              accountKey: message.accountKey,
              transactionId: message.transactionId
            },
            message.accountKey,
            message.transactionId
          )
        }
        void useAccountDataStore.getState().reloadTransactions(message.accountKey)
      }

      if (message.type === 'CROSS_CHAIN_STATUS_UPDATED' && currentData?.type === 'swap') {
        const { updateSwapStatus } = useTransactionResultStore.getState()
        updateSwapStatus(message.status)
      }
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [updateStep])

  if (!data) return null

  const handleDone = () => {
    const path = returnPath
    clear()
    navigate(path, { replace: true })
  }

  const handleRetry = () => {
    clear()
    goBack()
  }

  const handleSpeedUp = () => {
    if (recoveryAction === 'speed_up' && resultTransaction) {
      requestSpeedUp(resultTransaction)
    }
  }

  const handleCancel = () => {
    clear()
    goBack()
  }

  if (data.type === 'zcash') {
    const recordCopy =
      resultStep === data.step
        ? undefined
        : resultStep === 'failed'
          ? getConfirmationFailureResultCopy(resultTransaction?.failureReason)
          : resultStep === 'success'
            ? getConfirmedTransactionResultCopy()
            : getStandardTransactionResultCopy(resultStep, {
                shield: resultTransaction?.type === 'shield'
              })
    const isLoadingRecoveryRecord =
      resultStep === 'failed' &&
      !!data.accountKey &&
      !!data.transactionId &&
      resultTransaction?.status !== 'failed'
    const failureAction =
      resultStep !== 'failed' || isLoadingRecoveryRecord
        ? undefined
        : recoveryAction === 'speed_up'
          ? { label: 'Speed Up', onClick: handleSpeedUp }
          : { label: 'Try Again', onClick: handleRetry }
    const pendingDescription =
      resultStep === 'pending'
        ? data.error ||
          (syncState.isSyncing
            ? 'Waiting for the current sync batch before sending...'
            : data.customDescription ||
              'Building and broadcasting your transaction. This may take a few minutes.')
        : data.customDescription

    return (
      <div className="page-container">
        <PageHeader title=" " />
        <StandardTransactionResult
          step={resultStep}
          confirmed={resultStep === 'success'}
          shield={resultTransaction?.type === 'shield' || data.customTitle?.includes('Shield')}
          amount={data.amount}
          fromAddress={data.fromAddress}
          toAddress={data.toAddress}
          txHash={resultView?.txHash}
          timestamp={resultView?.timestamp}
          error={data.error}
          customTitle={recordCopy?.title ?? data.customTitle}
          customDescription={recordCopy?.description ?? pendingDescription}
          showFrom={data.showFrom}
          showTo={data.showTo}
          showTxHash={data.showTxHash}
          showTime={data.showTime}
          extraDetails={data.extraDetails}
          failureAction={failureAction}
          onDone={handleDone}
          onCancel={resultStep === 'failed' ? handleCancel : undefined}
        />
        {speedUpSheet}
      </div>
    )
  }

  if (data.type === 'swap') {
    const handleSwapBack = () => {
      data.onBack?.()
      handleDone()
    }

    return (
      <div className="page-container">
        <PageHeader title={data.actionName || 'Swap'} />
        <SwapStatusDisplay
          status={data.status}
          tokenInSymbol={data.tokenInSymbol}
          tokenOutSymbol={data.tokenOutSymbol}
          amountIn={data.amountIn}
          amountOut={data.amountOut}
          actionName={data.actionName}
          destinationChain={data.destinationChain}
          destinationConfirmations={destinationConfirmations}
          zcashTxHash={data.zcashTxHash}
          fee={data.fee}
          onClose={handleDone}
          onBack={handleSwapBack}
        />
      </div>
    )
  }

  return null
}
