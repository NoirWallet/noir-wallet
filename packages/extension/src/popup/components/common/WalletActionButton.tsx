import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface WalletActionButtonProps {
  readonly icon: ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly active?: boolean
  readonly disabled?: boolean
  readonly title?: string
}

export function WalletActionButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  title
}: WalletActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex flex-col items-center gap-2',
        active && 'rounded-xl ring-2 ring-primary',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      )}
    >
      <span className="flex h-[74px] w-[73px] flex-col items-center justify-center gap-1.5 rounded-xl border border-transparent bg-card text-white transition-colors hover:border-primary/40">
        {icon}
        <span className="text-xs">{label}</span>
      </span>
    </button>
  )
}
