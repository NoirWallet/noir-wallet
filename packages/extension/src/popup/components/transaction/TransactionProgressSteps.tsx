import { Icon } from '@iconify/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { TransactionProgressStep } from '@/popup/services/transaction-progress'

interface TransactionProgressStepsProps {
  readonly steps: readonly TransactionProgressStep[]
  readonly className?: string
  readonly referenceByStepId?: ReadonlyMap<string, ReactNode>
}

export function TransactionProgressSteps({
  steps,
  className,
  referenceByStepId
}: TransactionProgressStepsProps) {
  return (
    <section aria-label="Transaction progress" className={cn('w-full', className)}>
      <h3 className="mb-3 text-sm font-medium">Transaction progress</h3>
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="flex gap-3"
            data-progress-step={step.id}
            data-progress-state={step.state}
          >
            <div className="relative flex w-5 shrink-0 justify-center">
              {index < steps.length - 1 && (
                <span className="absolute bottom-[-8px] top-5 w-px bg-border" />
              )}
              <span
                className={cn(
                  'relative z-10 flex size-5 items-center justify-center rounded-full border bg-background',
                  step.state === 'complete'
                    ? 'border-primary text-primary'
                    : step.state === 'failed'
                      ? 'border-danger text-danger'
                      : step.state === 'warning'
                        ? 'border-warning text-warning'
                        : step.state === 'active'
                          ? 'border-foreground/60 text-foreground/80'
                          : 'border-muted text-muted'
                )}
              >
                <Icon
                  icon={
                    step.state === 'complete'
                      ? 'lucide:check'
                      : step.state === 'failed'
                        ? 'lucide:x'
                        : step.state === 'warning'
                          ? 'lucide:triangle-alert'
                          : 'lucide:clock-3'
                  }
                  width={11}
                  height={11}
                />
              </span>
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{step.label}</p>
                  {step.detail && <p className="mt-0.5 text-[11px] text-muted">{step.detail}</p>}
                  {referenceByStepId?.get(step.id) && (
                    <div className="mt-1.5 text-xs">{referenceByStepId.get(step.id)}</div>
                  )}
                </div>
                <span
                  className={cn(
                    'shrink-0 text-[11px] font-medium',
                    step.statusLabel === 'Submitted'
                      ? 'text-muted'
                      : step.state === 'complete'
                        ? 'text-primary'
                        : step.state === 'failed'
                          ? 'text-danger'
                          : step.state === 'warning'
                            ? 'text-warning'
                            : step.state === 'active'
                              ? 'text-foreground/80'
                              : 'text-muted'
                  )}
                >
                  {step.statusLabel}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
