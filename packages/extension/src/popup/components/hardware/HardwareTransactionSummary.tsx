import { Icon } from '@iconify/react'
import { TokenIcon } from '../tokens/TokenIcon'
import { DetailRow } from '../common/DetailRow'
import { formatNumber, formatSortAddress } from '@/lib/format'
import type { HardwareSignRequest } from '@/lib/hardware-tab'
import { AddressTypeLabel } from '../account/AddressType'

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
      : request.kind === 'swap'
        ? `Swap${request.monitorParams ? ` ${request.monitorParams.tokenInSymbol} → ${request.monitorParams.tokenOutSymbol}` : ''}`
        : 'Send'

  return (
    <div>
      <div className="flex flex-col items-center pb-4">
        <TokenIcon symbol="ZEC" size="xl" />
        <p className="text-2xl font-bold mt-3">{formatNumber(request.amount)} ZEC</p>
        <p className="text-xs text-muted mt-0.5">{subtitle}</p>
      </div>
      <div className="bg-card rounded-xl p-4 space-y-3">
        {request.origin && (
          <DetailRow label="Requested by">
            <span className="text-xs text-muted truncate max-w-[180px]">{request.origin}</span>
          </DetailRow>
        )}
        {request.kind === 'send' && (
          <DetailRow label="From">
            <AddressTypeLabel type={request.fundingSource ?? 'shielded'} />
          </DetailRow>
        )}
        {request.to && (
          <DetailRow label={request.kind === 'swap' ? 'Deposit Address' : 'To'}>
            <span className="font-mono text-xs text-muted">{formatSortAddress(request.to)}</span>
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
          <span className="text-sm">≈ {feeZec} ZEC</span>
        </DetailRow>
      </div>
      {ledgerDisplayAddress && ledgerDisplayAddress !== request.to && (
        <div className="mt-3 rounded-lg border border-border bg-card/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
            <Icon icon="lucide:shield-check" width={14} height={14} className="text-primary" />
            <span>Address shown on Ledger</span>
          </div>
          <p className="break-all font-mono text-[11px] leading-4 text-muted">
            {ledgerDisplayAddress}
          </p>
          <p className="mt-2 text-[11px] leading-4 text-muted">
            This is the private receiver selected from the recipient Unified Address.
          </p>
        </div>
      )}
    </div>
  )
}
