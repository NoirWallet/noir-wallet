import { Button } from '../ui/button'
import { TransactionResult } from './TransactionResult'
import { formatSortAddress, formatExplorerUrl, formatNumber } from '@/lib/format'
import Big from '@/lib/big'
import { useContactsStore } from '@/store/contacts-store'
import type { TransactionStep } from '@/popup/hooks/useTransaction'
import { getStandardTransactionResultCopy } from '@/lib/transaction-status-copy'

export interface StandardTransactionResultProps {
  step: TransactionStep
  amount: string

  fromAddress?: string
  toAddress?: string
  txHash?: string
  error?: string | null
  timestamp?: number
  confirmed?: boolean
  shield?: boolean

  customTitle?: string
  customDescription?: string

  showFrom?: boolean
  showTo?: boolean
  showTxHash?: boolean
  showTime?: boolean
  extraDetails?: Array<{ label: string; value: string }>

  failureAction?: {
    label: string
    onClick: () => void
  }
  onDone: () => void
  onCancel?: () => void
}

export function StandardTransactionResult({
  step,
  amount,
  fromAddress,
  toAddress,
  txHash,
  error,
  timestamp,
  confirmed = false,
  shield = false,
  customTitle,
  customDescription,
  showFrom = false,
  showTo = true,
  showTxHash = true,
  showTime = true,
  extraDetails,
  failureAction,
  onDone,
  onCancel
}: StandardTransactionResultProps) {
  const displayStep = step === 'success' && !confirmed ? 'submitted' : step
  const toContact = useContactsStore(state => (toAddress ? state.getContact(toAddress) : undefined))
  const baseConfig = getStandardTransactionResultCopy(displayStep, { error, shield })
  const title = customTitle || baseConfig.title
  const description = customDescription || baseConfig.description

  const footer =
    displayStep === 'success' ||
    displayStep === 'submitted' ||
    displayStep === 'confirming' ||
    (displayStep === 'pending' && error) ? (
      <Button onClick={onDone} className="w-full h-[45px]">
        {displayStep === 'success' ? 'Done' : 'Close'}
      </Button>
    ) : displayStep === 'failed' ? (
      <div className="space-y-3">
        {failureAction && (
          <Button onClick={failureAction.onClick} className="w-full h-[45px]">
            {failureAction.label}
          </Button>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="w-full h-[45px]">
            Close
          </Button>
        )}
      </div>
    ) : undefined

  return (
    <TransactionResult
      status={baseConfig.resultStatus}
      title={title}
      description={description}
      footer={footer}
    >
      {step !== 'failed' && (
        <div className="w-full space-y-3">
          <div className="flex justify-between items-center py-3 border-b border-white/10">
            <span className="text-sm text-muted">Amount</span>
            <span className="text-sm font-medium">
              {formatNumber(amount, { rm: Big.roundDown })} ZEC
            </span>
          </div>

          {showFrom && fromAddress && (
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-muted">From</span>
              <span className="text-sm font-mono text-muted">{formatSortAddress(fromAddress)}</span>
            </div>
          )}

          {showTo && toAddress && (
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-muted">To</span>
              <div className="flex flex-col items-end">
                {toContact?.znsName && (
                  <span className="text-xs text-primary">{toContact.znsName}</span>
                )}
                <span className="text-sm font-mono text-muted">{formatSortAddress(toAddress)}</span>
              </div>
            </div>
          )}

          {extraDetails?.map(detail => (
            <div
              key={detail.label}
              className="flex justify-between items-center py-3 border-b border-white/10"
            >
              <span className="text-sm text-muted">{detail.label}</span>
              <span className="text-sm font-medium">{detail.value}</span>
            </div>
          ))}

          {timestamp != null && showTime && (
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-muted">Time</span>
              <span className="text-sm font-medium text-muted">
                {new Date(timestamp).toLocaleString()}
              </span>
            </div>
          )}

          {showTxHash && txHash && step !== 'idle' && (
            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-muted">Transaction Hash</span>
              <a
                href={formatExplorerUrl('zcash', txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-primary cursor-pointer hover:underline"
              >
                {formatSortAddress(txHash)}
              </a>
            </div>
          )}
        </div>
      )}
    </TransactionResult>
  )
}
