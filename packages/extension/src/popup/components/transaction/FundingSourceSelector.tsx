import Big from 'big.js'
import type { FundingSource } from '@/types'
import { formatNumber, formatPrice, formatSortAddress } from '@/lib/format'
import { safeBig } from '@/lib/big'
import { AddressTypeLabel } from '../account/AddressType'
import { WarningBox } from '../ui/WarningBox'

export interface FundingSourceOption {
  type: FundingSource
  address: string
  available: string
  pending?: string
  disabledReason?: string
}

export function FundingSourceSelector({
  options,
  selectedType,
  zecPrice,
  onSelect
}: {
  options: FundingSourceOption[]
  selectedType: FundingSource
  zecPrice: number
  onSelect: (type: FundingSource) => void
}) {
  return (
    <div className="space-y-3 py-2">
      {options.map(option => {
        const disabled = Boolean(option.disabledReason)
        return (
          <button
            key={option.type}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option.type)}
            className={`w-full rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              selectedType === option.type
                ? 'border-primary bg-primary/5'
                : 'border-transparent bg-card hover:border-primary/20 hover:bg-white/5'
            }`}
          >
            <span className="flex items-start gap-3">
              <span
                className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                  selectedType === option.type ? 'border-primary' : 'border-white/30'
                }`}
              >
                {selectedType === option.type && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <AddressTypeLabel type={option.type} />
                <span className="mt-1.5 block truncate font-mono text-xs text-muted">
                  {formatSortAddress(option.address)}
                </span>
                {option.disabledReason && (
                  <span className="mt-2 block text-xs text-warning">{option.disabledReason}</span>
                )}
              </span>
              <span className="shrink-0 pt-0.5 text-right">
                <span className="flex items-baseline justify-end gap-1.5">
                  <span className="text-[10px] text-muted">Available</span>
                  <span className="text-sm font-medium">
                    {formatNumber(option.available, { rm: Big.roundDown })} ZEC
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {formatPrice(safeBig(option.available).times(zecPrice).toFixed(), {
                    showSign: true
                  })}
                </span>
                {safeBig(option.pending ?? '0').gt(0) && (
                  <span className="mt-0.5 block text-[11px] text-warning/80">
                    {formatNumber(option.pending!, { rm: Big.roundDown })} ZEC pending
                  </span>
                )}
              </span>
            </span>
          </button>
        )
      })}

      <WarningBox>
        Transparent sends reveal the sender, recipient, amount, and may link selected UTXOs
        on-chain.
      </WarningBox>
    </div>
  )
}
