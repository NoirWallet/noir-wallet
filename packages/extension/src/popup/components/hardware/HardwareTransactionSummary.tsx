import { TokenIcon } from '../tokens/TokenIcon'
import { DetailRow } from '../common/DetailRow'
import { AmountDisplay } from '../common/AmountDisplay'
import { formatSortAddress } from '@/lib/format'
import type { HardwareSignRequest } from '@/lib/hardware-tab'

/** Read-only summary of a pending hardware signing request. */
export function HardwareTransactionSummary({
  request,
  feeZec,
  ledgerDisplayAddress
}: {
  request: HardwareSignRequest
  feeZec: string
  ledgerDisplayAddress?: string
}) {
  const subtitle =
    request.kind === 'shield'
      ? 'Shield transparent funds'
      : request.kind === 'unshield'
        ? 'Unshield to the transparent address'
        : request.kind === 'swap'
          ? `Swap${request.monitorParams ? ` ${request.monitorParams.tokenInSymbol} → ${request.monitorParams.tokenOutSymbol}` : ''}`
          : 'Send'

  return (
    <div>
      <div className="flex flex-col items-center pb-4">
        <TokenIcon symbol="ZEC" nativeChain="zcash" size="xl" />
        <div className="mt-3 max-w-full text-center text-2xl font-bold">
          <AmountDisplay value={request.amount} symbol="ZEC" />
        </div>
        <p className="text-xs text-muted mt-0.5">{subtitle}</p>
      </div>
      <div className="bg-card rounded-xl p-4 space-y-3">
        {request.origin && (
          <DetailRow label="Requested by">
            <span className="text-xs text-muted truncate max-w-[180px]">{request.origin}</span>
          </DetailRow>
        )}
        {request.to && (
          <DetailRow label={request.kind === 'swap' ? 'Deposit Address' : 'To'}>
            <span className="font-mono text-xs text-muted">{formatSortAddress(request.to)}</span>
          </DetailRow>
        )}
        {ledgerDisplayAddress && ledgerDisplayAddress !== request.to && (
          <DetailRow label="On Ledger">
            <span className="font-mono text-xs text-muted break-all">{ledgerDisplayAddress}</span>
          </DetailRow>
        )}
        {request.kind === 'swap' && request.displayTo && (
          <DetailRow label="Recipient">
            <span className="font-mono text-xs text-muted">
              {formatSortAddress(request.displayTo)}
            </span>
          </DetailRow>
        )}
        <DetailRow label="Network Fee">
          <span className="text-sm">
            ≈ <AmountDisplay value={feeZec} symbol="ZEC" profile="fee" />
          </span>
        </DetailRow>
      </div>
    </div>
  )
}
