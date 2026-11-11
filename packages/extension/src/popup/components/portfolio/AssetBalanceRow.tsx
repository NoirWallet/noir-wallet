import type { ReactNode } from 'react'

export function AssetBalanceRow({
  label,
  subtitle,
  balance,
  fiat,
  pending
}: {
  readonly label: string
  readonly subtitle?: ReactNode
  readonly balance: ReactNode
  readonly fiat: string
  readonly pending?: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-h-[62px] items-center justify-between gap-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted">{subtitle}</div>
      </div>
      <div className="min-w-0 max-w-[48%] text-right">
        <div className="truncate text-sm">{balance}</div>
        <p className="mt-1 text-xs text-muted">{fiat}</p>
        {pending && <p className="mt-1 text-xs text-muted">{pending}</p>}
      </div>
    </div>
  )
}
