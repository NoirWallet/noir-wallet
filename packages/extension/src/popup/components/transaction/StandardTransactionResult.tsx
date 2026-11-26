import { useTranslation } from '@/popup/i18n'
import { createSendCopy } from '@/popup/i18n/send-copy'
import { sendMessages } from '@/popup/i18n/send-messages'
import { Button } from '../ui/button'
import { TransactionResult, TransactionResultDetailRow } from './TransactionResult'
import { formatSortAddress } from '@/lib/format'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { getZcashChainId } from '@/core/chains/registry'
import { formatChainTransactionExplorerUrl } from '@/popup/services/chain-explorer'
import { AmountDisplay } from '@/popup/components/common/AmountDisplay'
import { useAddressBookStore } from '@/store/address-book-store'
import type { TransactionStep } from '@/popup/hooks/useTransaction'
import { getStandardTransactionResultCopy } from '@/lib/transaction-status-copy'
import { TransactionNotice } from './TransactionNotice'
import { ActivityTransactionBody, type ActivityTransactionView } from './ActivityTransactionBody'

export interface StandardTransactionResultProps {
  activityView?: ActivityTransactionView | null
  step: TransactionStep
  operation?: 'send' | 'move'
  phaseLayout?: boolean
  amount: string

  fromAddress?: string
  toAddress?: string
  txHash?: string
  timestamp?: number
  error?: string | null
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
    retry?: boolean
  }
  onDone: () => void
  onCancel?: () => void
}

export function StandardTransactionResult({
  activityView,
  step,
  operation = 'send',
  phaseLayout = false,
  amount,
  fromAddress,
  toAddress,
  txHash,
  timestamp,
  error,
  shield,
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
  const { locale, t } = useTranslation(sendMessages)
  const copy = createSendCopy(locale)
  const zcashChainId = getZcashChainId(DEFAULT_NETWORK)
  const toContact = useAddressBookStore(state =>
    toAddress ? state.getContact(zcashChainId, toAddress) : undefined
  )
  const baseConfig = getStandardTransactionResultCopy(step, { error, shield })
  const title = copy(customTitle || baseConfig.title)
  const description = copy(customDescription || baseConfig.description)
  const showStatusDetail =
    phaseLayout && (step === 'submitted' || step === 'confirming' || step === 'success')

  const footer =
    step === 'success' ||
    step === 'submitted' ||
    step === 'confirming' ||
    (step === 'pending' && error) ? (
      <Button onClick={onDone} className="w-full h-[45px]">
        {t('done')}
      </Button>
    ) : step === 'failed' ? (
      <div className="space-y-3">
        {failureAction && !failureAction.retry && (
          <Button onClick={failureAction.onClick} className="w-full h-[45px]">
            {copy(failureAction.label)}
          </Button>
        )}
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="w-full h-[45px]">
            {t('cancel')}
          </Button>
        )}
      </div>
    ) : undefined

  return (
    <TransactionResult
      status={baseConfig.resultStatus}
      title={title}
      description={step === 'failed' ? undefined : description}
      layout="single-asset"
      onClose={onDone}
      footer={footer}
    >
      {step === 'failed' && (description || error || failureAction?.retry) && (
        <TransactionNotice
          message={description || error || title}
          tone="error"
          onRetry={failureAction?.retry ? failureAction.onClick : undefined}
          retryLabel={failureAction?.label}
        />
      )}
      {activityView ? (
        <ActivityTransactionBody view={activityView} showDate={showTime} showAmountsAsDetails />
      ) : (
        step !== 'failed' && (
          <div className="w-full">
            <TransactionResultDetailRow label={t('amount')}>
              <AmountDisplay value={amount} symbol="ZEC" />
            </TransactionResultDetailRow>

            {showFrom && fromAddress && (
              <TransactionResultDetailRow label={t(operation === 'send' ? 'sendFrom' : 'from')}>
                <span className="font-mono" title={fromAddress}>
                  {formatSortAddress(fromAddress)}
                </span>
              </TransactionResultDetailRow>
            )}

            {showTo && toAddress && (
              <TransactionResultDetailRow label={t(operation === 'send' ? 'recipient' : 'to')}>
                <span className="flex flex-col items-end">
                  {toContact?.znsName && (
                    <span className="text-xs text-primary">{toContact.znsName}</span>
                  )}
                  <span className="font-mono" title={toAddress}>
                    {formatSortAddress(toAddress)}
                  </span>
                </span>
              </TransactionResultDetailRow>
            )}

            <TransactionResultDetailRow label={t('network')}>
              {DEFAULT_NETWORK === 'testnet' ? 'Zcash Testnet' : 'Zcash'}
            </TransactionResultDetailRow>

            {showStatusDetail && (
              <TransactionResultDetailRow label={t('status')}>
                {t(
                  step === 'success'
                    ? 'confirmedStatus'
                    : step === 'confirming'
                      ? 'confirmingStatus'
                      : 'submittedStatus'
                )}
              </TransactionResultDetailRow>
            )}

            {extraDetails?.map(detail => (
              <TransactionResultDetailRow key={detail.label} label={copy(detail.label)}>
                {detail.value}
              </TransactionResultDetailRow>
            ))}

            {(step === 'success' || step === 'submitted' || step === 'confirming') &&
              showTime &&
              timestamp && (
                <TransactionResultDetailRow label={t('time')}>
                  <span className="text-muted">
                    {new Date(timestamp).toLocaleString(locale === 'en' ? undefined : locale)}
                  </span>
                </TransactionResultDetailRow>
              )}

            {showTxHash && txHash && (
              <TransactionResultDetailRow label={t('txHash')}>
                <a
                  href={formatChainTransactionExplorerUrl(
                    getZcashChainId(DEFAULT_NETWORK),
                    txHash,
                    DEFAULT_NETWORK
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-primary cursor-pointer hover:underline"
                >
                  {formatSortAddress(txHash)}
                </a>
              </TransactionResultDetailRow>
            )}
          </div>
        )
      )}
    </TransactionResult>
  )
}
