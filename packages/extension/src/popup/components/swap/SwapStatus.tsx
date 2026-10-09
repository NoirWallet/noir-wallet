import { Button } from '../ui/button'
import type { SwapStatus } from '@/core/services/intents-api'
import {
  formatNumber,
  formatSortAddress,
  formatExplorerUrl,
  getChainFromAssetId,
  formatChainName
} from '@/lib/format'
import { TransactionResult, type TransactionStatus } from '../transaction/TransactionResult'
import { isZcashDestination } from '@/lib/cross-chain-transaction'
import { WALLET_CONFIG } from '@/config/wallet'
import { getIntentsStatusCopy } from '@/lib/transaction-status-copy'

interface SwapStatusDisplayProps {
  status: SwapStatus | null
  tokenInSymbol: string
  tokenOutSymbol: string
  amountIn: string
  amountOut: string
  actionName?: string
  destinationChain?: string
  destinationConfirmations?: number | null
  zcashTxHash?: string
  /** ZEC fee for the on-chain leg, in ZEC. Omit to hide the fee row. */
  fee?: string
  onClose: () => void
  onBack?: () => void
}

function TxHashLink({ hash, chain }: { hash: string; chain: string }) {
  const explorerUrl = formatExplorerUrl(chain, hash)
  const chainLabel = formatChainName(chain)

  if (!explorerUrl) {
    return (
      <div className="flex justify-between items-center py-3 border-b border-white/10">
        <span className="text-sm text-muted">{chainLabel} Tx</span>
        <span className="text-sm font-mono text-muted">{formatSortAddress(hash)}</span>
      </div>
    )
  }

  return (
    <div className="flex justify-between items-center py-3 border-b border-white/10">
      <span className="text-sm text-muted">{chainLabel} Tx</span>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm font-mono text-primary cursor-pointer hover:underline"
      >
        {formatSortAddress(hash)}
      </a>
    </div>
  )
}

function getActionLabels(actionName?: string): { sendLabel: string; receiveLabel: string } {
  switch (actionName) {
    case 'Supply':
      return { sendLabel: 'Send', receiveLabel: 'Supplied' }
    case 'Withdraw':
      return { sendLabel: 'Withdraw', receiveLabel: 'Received' }
    case 'Claim':
      return { sendLabel: 'Claimed', receiveLabel: 'Received' }
    default:
      return { sendLabel: 'Send', receiveLabel: 'Receive' }
  }
}

export function SwapStatusDisplay({
  status,
  tokenInSymbol,
  tokenOutSymbol,
  amountIn,
  amountOut,
  actionName,
  destinationChain: destinationChainHint,
  destinationConfirmations,
  zcashTxHash,
  fee,
  onClose,
  onBack
}: SwapStatusDisplayProps) {
  const currentStatus = status?.status || 'PENDING_DEPOSIT'
  const destinationTxHash = status?.swapDetails?.destinationChainTxHashes?.[0]?.hash
  const requiredConfirmations = WALLET_CONFIG.SPENDABILITY_CONFIRMATIONS
  const waitsForZcashDestination =
    currentStatus === 'SUCCESS' &&
    isZcashDestination({
      destinationAsset: status?.destinationAsset,
      destinationChain: destinationChainHint
    })
  const destinationIsSpendable =
    destinationConfirmations != null && destinationConfirmations >= requiredConfirmations
  const waitsForSpendability = waitsForZcashDestination && !destinationIsSpendable
  const actionLabel = actionName || 'Swap'
  const statusCopy = getIntentsStatusCopy(currentStatus, {
    actionName: actionLabel,
    hasDestinationTxHash: !!destinationTxHash,
    waitsForZcashConfirmations: waitsForSpendability,
    destinationConfirmations,
    requiredConfirmations
  })
  const txStatus: TransactionStatus = statusCopy.resultStatus
  const isComplete = txStatus === 'success' || txStatus === 'warning' || txStatus === 'failed'

  const originChain = getChainFromAssetId(status?.originAsset || '')
  const destinationHashChain = getChainFromAssetId(status?.destinationAsset || '')
  const labels = getActionLabels(actionName)
  const showFee = !!fee

  return (
    <TransactionResult
      status={txStatus}
      title={statusCopy.title}
      description={statusCopy.description}
      footer={
        isComplete ? (
          <Button
            onClick={onClose}
            className="w-full h-[50px] bg-primary hover:bg-primary/90 text-black font-bold rounded-xl"
          >
            Done
          </Button>
        ) : (
          <Button
            onClick={onBack}
            variant="outline"
            className="w-full h-[50px] border-white/20 hover:bg-white/5 font-semibold rounded-xl"
          >
            Back
          </Button>
        )
      }
    >
      <div className="w-full space-y-3">
        <div className="flex justify-between items-center py-3 border-b border-white/10">
          <span className="text-sm text-muted">{labels.sendLabel}</span>
          <span className="text-sm font-medium">
            {formatNumber(amountIn)} {tokenInSymbol}
          </span>
        </div>
        <div className="flex justify-between items-center py-3 border-b border-white/10">
          <span className="text-sm text-muted">{labels.receiveLabel}</span>
          <span className="text-sm font-medium">
            {formatNumber(amountOut)} {tokenOutSymbol}
          </span>
        </div>

        {showFee && (
          <div className="flex justify-between items-center py-3 border-b border-white/10">
            <span className="text-sm text-muted">Fee</span>
            <span className="text-sm font-medium">≈ {fee} ZEC</span>
          </div>
        )}

        {zcashTxHash && !status?.swapDetails?.originChainTxHashes?.length && (
          <TxHashLink hash={zcashTxHash} chain="zcash" />
        )}

        {status?.swapDetails?.originChainTxHashes?.map((tx, i) => (
          <TxHashLink key={`origin-${i}`} hash={tx.hash} chain={originChain} />
        ))}

        {status?.swapDetails?.destinationChainTxHashes?.map((tx, i) => (
          <TxHashLink key={`dest-${i}`} hash={tx.hash} chain={destinationHashChain} />
        ))}
      </div>
    </TransactionResult>
  )
}
