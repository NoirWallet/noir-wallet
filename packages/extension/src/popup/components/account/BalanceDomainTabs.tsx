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
  labels,
  onChange,
  allowReselect = false,
  className,
  disabled = false
}: {
  readonly value: BalanceDomain
  readonly available?: readonly BalanceDomain[]
  readonly labels?: Partial<Record<BalanceDomain, string>>
  readonly onChange: (value: BalanceDomain) => void
  readonly allowReselect?: boolean
  readonly className?: string
  readonly disabled?: boolean
}) {
  const resolvedLabels = { ...LABELS, ...labels }
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
            if (allowReselect || value !== domain) onChange(domain)
          }}
          className={cn(
            'relative isolate min-h-7 rounded-full border bg-white/5 px-3 py-1 text-sm leading-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50',
            value !== domain &&
              'border-white/10 bg-white/5 font-medium text-muted hover:bg-white/10',
            value === domain && 'font-medium',
            value === domain && domain === 'public' && 'border-white text-black',
            value === domain && domain === 'private' && 'border-private-action text-white',
            value === domain &&
              domain === 'shield' &&
              'border-success text-black shadow-[0_0_6px_var(--color-success)]'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 -z-10 rounded-[inherit] transition-opacity duration-150 ease-out will-change-[opacity] motion-reduce:transition-none',
              domain === 'public' && 'bg-white',
              domain === 'private' && 'bg-private-action',
              domain === 'shield' && 'bg-success',
              value === domain ? 'opacity-100' : 'opacity-0'
            )}
          />
          {resolvedLabels[domain]}
        </button>
      ))}
    </div>
  )
}
