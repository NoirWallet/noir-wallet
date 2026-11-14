import { InlineError } from '@/popup/components/common/InlineError'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import type { PortfolioAssetView, PortfolioChainView } from '@/core/portfolio'
import type { TransactionGraph, TransactionId } from '@/core/transactions/domain'
import { formatSortAddress } from '@/lib/format'
import { getTransactionStatusToneClassName } from '@/lib/transaction-status-presentation'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { Button } from '@/popup/components/ui/button'
import { PageHeader } from '@/popup/components/common/PageHeader'
import { ChainIcon } from '@/popup/components/common/ChainIcon'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import {
  TransactionResult,
  TransactionResultDetailRow
} from '@/popup/components/transaction/TransactionResult'
import type { EvmTransferActivity } from '@/popup/services/evm-transfer-activity'
import { shouldApplyOnchainTransactionStatus } from '@/popup/services/evm-transaction-result-status'
import { formatBaseUnitAmount } from '@/lib/number-format'
import { formatPortfolioNetworkName } from '@/popup/components/portfolio/portfolio-format'
import {
  getOnchainTransactionFailureLabel,
  getOnchainResultAction,
  getOnchainResultExitOutcome,
  getOnchainResultTotal,
  getOnchainTransactionStatusPresentation,
  resolveVisibleTransactionStatus
} from '@/popup/services/onchain-transaction-result'

export interface OnchainTransferSubmission {
  readonly status: 'broadcast' | 'signed-pending-broadcast'
  readonly graph: TransactionGraph
}

export interface OnchainTransferClient {
  readonly getTransferActivity: (graph: TransactionGraph) => Promise<EvmTransferActivity | null>
  readonly resumeTransfer: (transactionId: TransactionId) => Promise<OnchainTransferSubmission>
}

export type OnchainResultOutcome = 'pending' | 'final' | 'failed'

interface OnchainTransactionResultProps {
  readonly asset: PortfolioAssetView
  readonly chain: PortfolioChainView
  readonly submission: OnchainTransferSubmission
  readonly client: OnchainTransferClient
  readonly explorerBaseUrl: string
  readonly explorerTransactionPath?: string
  readonly feeDecimals: number
  readonly feeSymbol: string
  readonly feeLabel: string
  readonly totalLabel: string
  readonly showTotal: boolean
  readonly onDone: (outcome: OnchainResultOutcome) => void
  readonly onViewActivity: (transactionId: TransactionId) => void
}

export function OnchainTransactionResult({
  asset,
  chain,
  submission,
  client,
  explorerBaseUrl,
  explorerTransactionPath = 'tx',
  feeDecimals,
  feeSymbol,
  feeLabel,
  totalLabel,
  showTotal,
  onDone,
  onViewActivity
}: OnchainTransactionResultProps) {
  const [graph, setGraph] = useState(submission.graph)
  const [activity, setActivity] = useState<EvmTransferActivity | null>(null)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [resuming, setResuming] = useState(false)
  const [resumeError, setResumeError] = useState(false)
  const initialStatus =
    submission.status === 'signed-pending-broadcast' ? 'signed' : submission.graph.root.status
  const status = resolveVisibleTransactionStatus(activity?.status ?? initialStatus)
  const reconfirming = activity
    ? activity.reconfirming === true
    : submission.graph.root.reconfirming === true
  const segmentEvidence = graph.segments[0]?.evidence
  const presentation = getOnchainTransactionStatusPresentation(status, reconfirming, {
    code: activity?.failureCode ?? graph.root.failure?.code,
    evidence: {
      replacementTransactionHash:
        activity?.replacementTransactionHash ?? segmentEvidence?.replacementTransactionHash,
      confirmations: activity?.confirmations ?? segmentEvidence?.confirmations,
      requiredConfirmations:
        activity?.requiredConfirmations ?? segmentEvidence?.requiredConfirmations
    }
  })

  useEffect(() => {
    if (status === 'final' || status === 'failed' || status === 'signed') return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const next = await client.getTransferActivity(graph)
        if (!active) return
        setRefreshFailed(false)
        if (next) {
          setActivity(current => {
            const currentSnapshot = current ?? {
              status: graph.root.status,
              updatedAt: graph.root.updatedAt
            }
            return shouldApplyOnchainTransactionStatus(currentSnapshot, next) ? next : current
          })
          if (next.status === 'final' || next.status === 'failed') return
        }
      } catch {
        if (active) setRefreshFailed(true)
      }
      if (active) timer = setTimeout(poll, 2_000)
    }

    void poll()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [client, graph, status])

  const amountRaw = graph.root.intent?.primaryAmount?.amountRaw ?? '0'
  const feeRaw = graph.root.intent?.feeLimit?.amountRaw ?? '0'
  const amount = formatBaseUnitAmount(amountRaw, asset.metadata.decimals)
  const fee = formatBaseUnitAmount(feeRaw, feeDecimals)
  const total = useMemo(
    () => getOnchainResultTotal(amountRaw, feeRaw, asset.metadata.decimals, showTotal),
    [amountRaw, asset.metadata.decimals, feeRaw, showTotal]
  )
  const transactionHash = activity?.transactionHash ?? segmentEvidence?.transactionHash
  const replacementTransactionHash =
    activity?.replacementTransactionHash ?? segmentEvidence?.replacementTransactionHash
  const sender = graph.root.intent?.sender?.address
  const recipient = graph.root.intent?.recipient?.address
  const explorerUrl =
    transactionHash && explorerBaseUrl
      ? `${explorerBaseUrl}/${explorerTransactionPath}/${transactionHash}`
      : null
  const replacementExplorerUrl =
    replacementTransactionHash && explorerBaseUrl
      ? `${explorerBaseUrl}/${explorerTransactionPath}/${replacementTransactionHash}`
      : null
  const compactDetails = reconfirming || replacementTransactionHash !== undefined
  const resultAction = getOnchainResultAction(status, explorerUrl)

  const handleResume = async () => {
    setResuming(true)
    setResumeError(false)
    try {
      const next = await client.resumeTransfer(graph.root.id)
      setGraph(next.graph)
      if (next.status === 'broadcast') {
        setActivity({ status: 'broadcast', updatedAt: Date.now() })
      }
    } catch {
      setResumeError(true)
    } finally {
      setResuming(false)
    }
  }

  return (
    <div className="page-container" data-transaction-status={status}>
      <PageHeader title="" />
      <TransactionResult
        status={presentation.resultStatus}
        title={presentation.title}
        description={resultAction === 'retry' ? undefined : presentation.description}
        layout="single-asset"
        onClose={() => onDone(getOnchainResultExitOutcome(status))}
        className={compactDetails ? 'pb-0' : undefined}
        bodyClassName={compactDetails ? 'mt-5' : undefined}
        footer={
          <div className="flex w-full flex-col gap-2">
            {resultAction === 'explorer' && explorerUrl ? (
              <Button asChild className="h-[45px] w-full">
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  View on Explorer
                </a>
              </Button>
            ) : resultAction === 'activity' ? (
              <Button className="h-[45px] w-full" onClick={() => onViewActivity(graph.root.id)}>
                View Activity
              </Button>
            ) : null}
            <Button
              variant={resultAction === 'done' ? 'default' : 'outline'}
              className="h-[45px] w-full"
              onClick={() => onDone(getOnchainResultExitOutcome(status))}
            >
              Done
            </Button>
          </div>
        }
      >
        <div className="w-full">
          <div>
            <TransactionResultDetailRow label="Amount">
              <AmountDisplay value={amount} symbol={asset.metadata.symbol} />
            </TransactionResultDetailRow>
            {sender && (
              <TransactionResultDetailRow label="Send from">
                <span className="font-mono" title={sender}>
                  {formatSortAddress(sender)}
                </span>
              </TransactionResultDetailRow>
            )}
            {recipient && (
              <TransactionResultDetailRow label="Recipient">
                <span className="font-mono" title={recipient}>
                  {formatSortAddress(recipient)}
                </span>
              </TransactionResultDetailRow>
            )}
            <TransactionResultDetailRow label="Network">
              <span className="inline-flex items-center justify-end gap-1.5">
                <ChainIcon
                  chain={resolveChainIconAlias(
                    chain.chain.family,
                    chain.chain.displayName,
                    chain.chain.id
                  )}
                  className="size-4"
                />
                {formatPortfolioNetworkName(chain)}
              </span>
            </TransactionResultDetailRow>
            {transactionHash && (
              <TransactionResultDetailRow label="Transaction Hash">
                <a
                  href={explorerUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                  title={transactionHash}
                >
                  {formatSortAddress(transactionHash)}
                  <Icon icon="lucide:external-link" width={12} height={12} />
                </a>
              </TransactionResultDetailRow>
            )}
            {replacementTransactionHash && replacementExplorerUrl && (
              <TransactionResultDetailRow label="Replacement">
                <a
                  href={replacementExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                  title={replacementTransactionHash}
                >
                  {formatSortAddress(replacementTransactionHash)}
                  <Icon icon="lucide:external-link" width={12} height={12} />
                </a>
              </TransactionResultDetailRow>
            )}
            <TransactionResultDetailRow label="Status">
              <span className={getTransactionStatusToneClassName(presentation.tone)}>
                {presentation.label}
              </span>
            </TransactionResultDetailRow>
            {status === 'failed' && presentation.tone === 'error' && (
              <TransactionResultDetailRow label="Reason">
                {getOnchainTransactionFailureLabel(activity?.failureCode)}
              </TransactionResultDetailRow>
            )}
            <TransactionResultDetailRow label={feeLabel}>
              <AmountDisplay value={fee} symbol={feeSymbol} profile="fee" />
            </TransactionResultDetailRow>
            {total && (
              <TransactionResultDetailRow label={totalLabel}>
                <AmountDisplay value={total} symbol={asset.metadata.symbol} />
              </TransactionResultDetailRow>
            )}
          </div>

          {refreshFailed && status !== 'final' && status !== 'failed' && (
            <p role="status" className="mt-3 text-center text-xs text-muted">
              Status update delayed.
            </p>
          )}
          {resultAction === 'retry' ? (
            <InlineError
              className="mt-3"
              message={
                resumeError
                  ? 'Broadcast retry failed. Check the network and try again.'
                  : presentation.description || presentation.title
              }
              onRetry={handleResume}
              retrying={resuming}
              retryLabel="Retry broadcast"
              tone={resumeError || presentation.tone === 'error' ? 'error' : 'warning'}
            />
          ) : (
            resumeError && (
              <p role="alert" className="mt-3 text-center text-xs text-danger">
                Broadcast retry failed. Check the network and try again.
              </p>
            )
          )}
        </div>
      </TransactionResult>
    </div>
  )
}
