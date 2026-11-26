import { Icon } from '@iconify/react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { useTranslation } from '@/popup/i18n'
import { shellMessages } from '@/popup/i18n/shell-messages'

export function BalanceHelp({ kind }: { kind: 'available' | 'pending' }) {
  const { t } = useTranslation(shellMessages)
  const available = kind === 'available'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(available ? 'aboutAvailableBalance' : 'aboutPendingBalance')}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Icon icon="lucide:circle-help" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-64 p-3 text-xs leading-5">
        {t(available ? 'availableBalanceHelp' : 'pendingBalanceHelp')}
      </PopoverContent>
    </Popover>
  )
}
