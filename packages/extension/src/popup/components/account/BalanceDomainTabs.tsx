import { cn } from '@/lib/utils'

export type BalanceDomain = 'public' | 'private' | 'shield'

const LABELS: Record<BalanceDomain, string> = {
  public: 'Public',
  private: 'Private',
  shield: 'Shield'
}

export function BalanceDomainTabs({
  value,
  available = ['public', 'private', 'shield'],
  onChange,
  className,
  disabled = false
}: {
  readonly value: BalanceDomain
  readonly available?: readonly BalanceDomain[]
  readonly onChange: (value: BalanceDomain) => void
  readonly className?: string
  readonly disabled?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Account type"
      className={cn('flex items-center gap-2', className)}
    >
      {available.map(domain => (
        <button
          key={domain}
          type="button"
          aria-pressed={value === domain}
          disabled={disabled}
          onClick={() => {
            if (value !== domain) onChange(domain)
          }}
          className={cn(
            'wallet-interactive min-h-7 rounded-full border px-3 py-1 text-sm leading-[18px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50',
            value !== domain &&
              'border-white/10 bg-white/5 font-medium text-muted hover:bg-white/10',
            value === domain && 'font-medium',
            value === domain && domain === 'public' && 'border-white bg-white text-black',
            value === domain &&
              domain === 'private' &&
              'border-private-action bg-private-action text-white',
            value === domain &&
              domain === 'shield' &&
              'border-success bg-success text-black shadow-[0_0_6px_var(--color-success)]'
          )}
        >
          {LABELS[domain]}
        </button>
      ))}
    </div>
  )
}
