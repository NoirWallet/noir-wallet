import type { ShieldProvider } from '@/popup/services/asset-domains'
import { ShieldProviderLogo } from './shield-providers'

export function ShieldSendProviderTabs({
  value,
  onChange,
  disabled = false
}: {
  readonly value: ShieldProvider
  readonly onChange: (provider: ShieldProvider) => void
  readonly disabled?: boolean
}) {
  return (
    <div
      className="grid h-11 grid-cols-2 gap-1 rounded-lg bg-wallet-surface p-1"
      aria-label="Shield provider"
    >
      {(['near-confidential', 'zcash-shield'] as const).map(provider => (
        <button
          key={provider}
          type="button"
          aria-pressed={value === provider}
          disabled={disabled}
          onClick={() => onChange(provider)}
          className={`wallet-interactive flex min-w-0 items-center justify-center gap-2 rounded-md px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-45 ${value === provider ? 'bg-wallet-selected text-foreground' : 'text-muted hover:text-foreground'}`}
        >
          <ShieldProviderLogo provider={provider} size={20} />
          {provider === 'near-confidential' ? 'Confidential' : 'Zcash'}
        </button>
      ))}
    </div>
  )
}
