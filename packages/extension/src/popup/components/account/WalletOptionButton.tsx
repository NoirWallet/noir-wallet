import { Icon } from '@iconify/react'
import type { ReactNode } from 'react'
import type { IconifyIcon } from '@iconify/react'
import { WALLET_OPTION_ICONS } from './wallet-option-icons'

export function WalletOptionButton({
  label,
  icon,
  onClick
}: {
  label: string
  icon: IconifyIcon | ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/60 text-foreground">
        {icon && typeof icon === 'object' && 'body' in icon ? (
          <Icon icon={icon} width={20} height={20} aria-hidden="true" />
        ) : (
          icon
        )}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      <Icon
        icon={WALLET_OPTION_ICONS.next}
        width={18}
        height={18}
        className="shrink-0 text-muted"
        aria-hidden="true"
      />
    </button>
  )
}
