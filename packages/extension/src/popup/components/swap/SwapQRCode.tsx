import { useState } from 'react'
import { Icon } from '@iconify/react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../../components/ui/button'
import { useCopyToClipboard, CopyToast } from '../common/CopyToast'
import { LabeledCheckbox } from '../common/LabeledCheckbox'
import { Tooltip } from '../ui/tooltip'
import { formatChainName } from '@/lib/format'
import { getIntentsStatusCopy } from '@/lib/transaction-status-copy'
import type { SwapToken } from '@/core/services/intents-api'
import { TokenIcon } from '../tokens/TokenIcon'

interface SwapQRCodeProps {
  depositAddress: string
  amount: string
  token: SwapToken
  onConfirmDeposit: () => void
  isPolling?: boolean
}

function getTokenDepositLabel(symbol: string) {
  if (symbol === 'wNEAR') return 'NEAR or wNEAR'
  return symbol
}

export function SwapQRCode({
  depositAddress,
  amount,
  token,
  onConfirmDeposit,
  isPolling = false
}: SwapQRCodeProps) {
  const { copyToClipboard, showToast } = useCopyToClipboard()
  const [hasConfirmedDepositDetails, setHasConfirmedDepositDetails] = useState(false)
  const networkLabel = formatChainName(token.blockchain)
  const depositLabel = getTokenDepositLabel(token.symbol)
  const contractAddress = token.contractAddress
  const waitingForDepositLabel = getIntentsStatusCopy('PENDING_DEPOSIT').compactLabel

  return (
    <div className="flex flex-col items-center px-5 py-5 flex-1 overflow-y-auto">
      <CopyToast show={showToast} />

      <div className="mb-4 flex w-full items-center justify-center gap-3">
        <TokenIcon token={token} size={40} className="shrink-0" />
        <div className="min-w-0 text-left leading-tight">
          <h2 className="break-words text-lg font-semibold">
            Send {amount} {depositLabel}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Switch to the <span className="font-semibold text-warning">{networkLabel}</span> network
            in your wallet before sending.
          </p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl mb-4">
        <QRCodeSVG value={depositAddress} size={180} level="H" />
      </div>

      <div className="w-full bg-card rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-xs text-muted mb-1">Deposit Address</p>
            <p className="text-xs font-mono break-all">{depositAddress}</p>
          </div>
          <button
            onClick={() => copyToClipboard(depositAddress)}
            aria-label="Copy deposit address"
            className="shrink-0 p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Icon icon="lucide:copy" width={18} height={18} className="text-muted" />
          </button>
        </div>
      </div>

      <LabeledCheckbox
        checked={hasConfirmedDepositDetails}
        onChange={setHasConfirmedDepositDetails}
        className="mb-4 w-full items-start rounded-xl bg-yellow-500/10 p-3"
        label={
          <span className="text-sm leading-snug text-warning">
            I understand that Intents may not refund deposits sent with the{' '}
            {contractAddress ? (
              <Tooltip
                side="top"
                className="max-w-[280px]"
                content={
                  <span>
                    <span className="block font-semibold">{depositLabel} token contract</span>
                    <span className="mt-1 block break-all font-mono">{contractAddress}</span>
                  </span>
                }
              >
                <span
                  tabIndex={0}
                  className="cursor-help underline decoration-dotted underline-offset-2"
                >
                  wrong token
                </span>
              </Tooltip>
            ) : (
              'wrong token'
            )}{' '}
            or on the wrong network, which may result in a loss.
          </span>
        }
      />

      <Button
        onClick={onConfirmDeposit}
        disabled={isPolling || !hasConfirmedDepositDetails}
        className="w-full h-[50px] bg-primary hover:bg-primary/90 text-black font-bold rounded-xl"
      >
        {isPolling ? (
          <span className="flex items-center gap-2">
            <Icon icon="lucide:loader-2" width={18} height={18} className="animate-spin" />
            {waitingForDepositLabel}...
          </span>
        ) : (
          "I've sent it"
        )}
      </Button>
    </div>
  )
}
