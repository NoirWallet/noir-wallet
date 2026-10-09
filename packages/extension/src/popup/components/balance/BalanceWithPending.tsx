import { Icon } from '@iconify/react'
import Big from '@/lib/big'
import { safeBig } from '@/lib/big'
import { formatNumber, formatPrice } from '@/lib/format'
import { Tooltip } from '../ui/tooltip'
import { cn } from '@/lib/utils'

const CONFIRMING_TOOLTIP =
  'Included in total balance but not yet spendable. Wallet-created funds require 3 confirmations; externally received funds require 10.'

interface BalanceWithPendingProps {
  amount: string
  pending?: string
  fiatValue?: number
  className?: string
  amountClassName?: string
}

export function BalanceWithPending({
  amount,
  pending,
  fiatValue,
  className,
  amountClassName
}: BalanceWithPendingProps) {
  const showPending = pending != null && safeBig(pending).gt(0)

  return (
    <div className={cn('flex flex-col items-end gap-1', className)}>
      <p className={cn('font-medium', amountClassName)}>
        {formatNumber(amount, { rm: Big.roundDown })} ZEC
      </p>
      {showPending && (
        <div className="flex items-center gap-1 text-xs text-muted">
          <span>{formatNumber(pending!, { rm: Big.roundDown })} ZEC unspendable</span>
          <Tooltip content={CONFIRMING_TOOLTIP} className="max-w-[240px]">
            <span className="inline-flex cursor-default">
              <Icon icon="lucide:info" width={12} height={12} className="text-muted" />
            </span>
          </Tooltip>
        </div>
      )}
      {fiatValue != null && (
        <p className="text-xs text-muted">{formatPrice(fiatValue, { showSign: true })}</p>
      )}
    </div>
  )
}
