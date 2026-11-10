import { cn } from '@/lib/utils'
import { Icon } from '@iconify/react'

export type TransactionStatus =
  | 'loading'
  | 'submitted'
  | 'neutral'
  | 'success'
  | 'failed'
  | 'warning'

interface TransactionResultProps {
  status: TransactionStatus
  title: string
  description?: string
  showStatus?: boolean
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  bodyClassName?: string
}

const statusConfig = {
  loading: {
    iconClass: 'animate-spin text-foreground/70',
    bgClass: 'bg-foreground/10'
  },
  submitted: {
    iconClass: 'text-foreground/70',
    bgClass: 'bg-foreground/10'
  },
  neutral: {
    iconClass: 'text-foreground/70',
    bgClass: 'bg-foreground/10'
  },
  success: {
    iconClass: 'text-primary',
    bgClass: 'bg-primary/20'
  },
  failed: {
    iconClass: 'text-danger',
    bgClass: 'bg-danger/15'
  },
  warning: {
    iconClass: 'text-warning',
    bgClass: 'bg-warning/15'
  }
}

function ResultStatusIcon({ status, className }: { status: TransactionStatus; className: string }) {
  return (
    <Icon
      icon={
        status === 'loading'
          ? 'lucide:loader-circle'
          : status === 'submitted'
            ? 'lucide:send'
            : status === 'neutral'
              ? 'lucide:circle-minus'
              : status === 'success'
                ? 'lucide:check'
                : status === 'failed'
                  ? 'lucide:x'
                  : 'lucide:rotate-ccw'
      }
      width={36}
      height={36}
      className={className}
      aria-hidden="true"
    />
  )
}

export function TransactionResult({
  status,
  title,
  description,
  showStatus = true,
  children,
  footer,
  className,
  bodyClassName
}: TransactionResultProps) {
  const config = statusConfig[status]

  return (
    <div className={cn('flex flex-col items-center px-5 py-5 flex-1 min-h-0', className)}>
      <div className="flex-1 flex flex-col items-center w-full overflow-y-auto min-h-0">
        {showStatus &&
          (status === 'loading' ? (
            <div
              className="mb-4 w-full rounded-xl border border-border/60 bg-card/50 px-4 py-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-2.5">
                <span
                  data-result-icon
                  className="flex size-6 shrink-0 items-center justify-center text-primary"
                >
                  <Icon
                    icon="lucide:loader-circle"
                    width={18}
                    height={18}
                    className="animate-spin"
                    aria-hidden="true"
                  />
                </span>
                <h2 className="text-sm font-semibold">{title}</h2>
              </div>
              {description && <p className="mt-2 text-xs leading-5 text-muted">{description}</p>}
            </div>
          ) : (
            <>
              <div
                data-result-icon
                className={cn(
                  'w-20 h-20 rounded-full flex items-center justify-center mb-4 shrink-0',
                  config.bgClass
                )}
              >
                <ResultStatusIcon status={status} className={config.iconClass} />
              </div>

              <h2 className="text-xl font-semibold mb-2 text-center">{title}</h2>
              {description && <p className="text-sm text-muted mb-5 text-center">{description}</p>}
            </>
          ))}

        <div className={cn('w-full space-y-4', showStatus ? 'my-4' : 'mb-4', bodyClassName)}>
          {children}
        </div>
      </div>

      <div className="w-full mt-4 shrink-0">{footer}</div>
    </div>
  )
}
