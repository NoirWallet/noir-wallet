import { Icon } from '@iconify/react'
import { cn } from '@/lib/utils'

interface WarningBoxProps {
  children: React.ReactNode
  className?: string
}

export function WarningBox({ children, className }: WarningBoxProps) {
  return (
    <div className={cn('flex items-start gap-3 p-3 bg-warning/10 rounded-lg', className)}>
      <div className="flex-shrink-0 mt-0.5">
        <Icon icon="lucide:triangle-alert" width={18} height={18} style={{ color: '#FFC201' }} />
      </div>
      <p className="text-xs text-white/70 leading-relaxed">{children}</p>
    </div>
  )
}
