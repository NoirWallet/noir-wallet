import { Icon } from '@iconify/react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'

const COPY = {
  available: 'Funds you can use now, before the network fee for this transaction.',
  pending: 'Funds waiting for enough confirmations before you can use them.'
} as const

export function BalanceHelp({ kind }: { kind: keyof typeof COPY }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`About ${kind} balance`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon icon="lucide:circle-help" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 p-3 text-xs leading-5">
        {COPY[kind]}
      </PopoverContent>
    </Popover>
  )
}
