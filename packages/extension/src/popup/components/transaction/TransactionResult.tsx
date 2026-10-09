import { Icon } from '@iconify/react'
import { cn } from '@/lib/utils'

export type TransactionStatus = 'loading' | 'submitted' | 'success' | 'failed' | 'warning'

interface TransactionResultProps {
  status: TransactionStatus
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

const statusConfig = {
  loading: {
    icon: 'lucide:loader-2',
    iconClass: 'animate-spin text-primary',
    bgClass: 'bg-primary/20'
  },
  submitted: {
    icon: 'lucide:clock-3',
    iconClass: 'text-white/80',
    bgClass: 'bg-white/10'
  },
  success: {
    icon: 'lucide:check',
    iconClass: 'text-primary',
    bgClass: 'bg-primary/20'
  },
  failed: {
    icon: 'lucide:x',
    iconClass: 'text-red-500',
    bgClass: 'bg-red-500/20'
  },
  warning: {
    icon: 'lucide:rotate-ccw',
    iconClass: 'text-yellow-500',
    bgClass: 'bg-yellow-500/20'
  }
}

export function TransactionResult({
  status,
  title,
  description,
  children,
  footer,
  className
}: TransactionResultProps) {
  const config = statusConfig[status]

  return (
    <div className={cn('flex flex-col items-center px-5 py-5 flex-1 min-h-0', className)}>
      <div className="flex-1 flex flex-col items-center w-full overflow-y-auto min-h-0">
        <div
          className={cn(
            'w-20 h-20 rounded-full flex items-center justify-center mb-4 shrink-0',
            config.bgClass
          )}
        >
          <Icon icon={config.icon} width={40} height={40} className={config.iconClass} />
        </div>

        <h2 className="text-xl font-semibold mb-2 text-center">{title}</h2>
        {description && <p className="text-sm text-muted mb-5 text-center">{description}</p>}

        <div className="w-full space-y-4 my-4">{children}</div>
      </div>

      <div className="w-full mt-4 shrink-0">{footer}</div>
    </div>
  )
}
