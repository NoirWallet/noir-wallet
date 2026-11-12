import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Input } from '../ui/input'
import { cn } from '@/lib/utils'

export interface TokenSelectionItem {
  readonly key: string
  readonly symbol: string
  readonly symbolSuffix?: ReactNode
  readonly icon: ReactNode
  readonly subtitle?: string
  readonly subtitleTitle?: string
  readonly balance?: ReactNode
  readonly balanceTitle?: string
  readonly ariaLabel?: string
  readonly title?: string
  readonly disabledReason?: string
}

export function TokenSelectionSearch({
  value,
  onChange,
  placeholder = 'Search tokens',
  ariaLabel,
  className,
  autoFocus
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly ariaLabel: string
  readonly className?: string
  readonly autoFocus?: boolean
}) {
  return (
    <Input
      type="text"
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={value}
      onChange={event => onChange(event.target.value)}
      className={className}
      autoFocus={autoFocus}
      startContent={<Icon icon="lucide:search" className="text-muted" width={16} height={16} />}
    />
  )
}

export function TokenSelectionList({
  items,
  selectedKey,
  onSelect,
  emptyMessage,
  variant = 'default',
  className,
  rowClassName
}: {
  readonly items: readonly TokenSelectionItem[]
  readonly selectedKey?: string
  readonly onSelect: (key: string) => void
  readonly emptyMessage?: string
  readonly variant?: 'default' | 'icons' | 'compact' | 'source' | 'deposit' | 'send' | 'transfer'
  readonly className?: string
  readonly rowClassName?: string
}) {
  if (items.length === 0) {
    return emptyMessage ? (
      <p className="py-8 text-center text-sm text-muted">{emptyMessage}</p>
    ) : null
  }

  return (
    <div className={className}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          disabled={Boolean(item.disabledReason)}
          title={item.disabledReason ?? item.title}
          onClick={() => onSelect(item.key)}
          aria-pressed={selectedKey === item.key}
          aria-label={item.ariaLabel}
          className={cn(
            'wallet-interactive flex w-full items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-45',
            variant === 'default' &&
              'min-h-[55px] justify-between rounded-lg px-3 py-2.5 hover:bg-card active:bg-white/10 focus-visible:-outline-offset-2',
            variant === 'icons' &&
              'min-h-[72px] justify-between px-4 py-3 hover:bg-white/5 active:bg-white/10 focus-visible:-outline-offset-2',
            variant === 'compact' &&
              'min-h-14 rounded-md px-2 py-2 hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-offset-2',
            variant === 'source' &&
              'rounded-md px-2 py-2 hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-offset-2',
            variant === 'deposit' &&
              'h-16 rounded-md px-1 hover:bg-wallet-selected active:bg-white/15',
            variant === 'send' &&
              'min-h-[55px] justify-between py-2.5 transition-colors hover:bg-card/60',
            variant === 'transfer' && 'min-h-[70px] rounded-lg hover:bg-accent',
            selectedKey === item.key &&
              (variant === 'default' || variant === 'icons'
                ? 'bg-primary/[0.08]'
                : variant === 'send'
                  ? 'bg-card/60'
                  : 'bg-wallet-selected'),
            rowClassName
          )}
        >
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center',
              variant === 'icons' ? 'gap-2' : 'gap-3'
            )}
          >
            {item.icon}
            <div className="min-w-0 flex-1">
              <span className={cn('flex min-w-0 items-center', item.symbolSuffix && 'gap-1.5')}>
                <span
                  className={cn(
                    'block truncate',
                    variant === 'default' && 'font-semibold',
                    variant === 'icons' && 'text-base font-medium',
                    (variant === 'compact' || variant === 'source' || variant === 'deposit') &&
                      'text-sm',
                    variant === 'send' && 'text-sm font-medium',
                    variant === 'transfer' && 'text-base'
                  )}
                >
                  {item.symbol}
                </span>
                {item.symbolSuffix}
              </span>
              {item.subtitle && (
                <span className="block truncate text-xs text-muted" title={item.subtitleTitle}>
                  {item.subtitle}
                </span>
              )}
            </div>
          </div>
          {item.balance !== undefined && (
            <div
              className={cn(
                'min-w-0 shrink-0 text-right',
                variant === 'default' || variant === 'icons' || variant === 'send'
                  ? 'max-w-[55%]'
                  : variant === 'transfer'
                    ? 'max-w-[45%]'
                    : 'max-w-[42%]'
              )}
              title={item.balanceTitle}
            >
              {item.balance}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}
