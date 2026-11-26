import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/popup/i18n'
import { shellMessages } from '@/popup/i18n/shell-messages'

interface InlineErrorProps {
  readonly message: ReactNode
  readonly onRetry?: () => void
  readonly retrying?: boolean
  readonly retryLabel?: string
  readonly tone?: 'error' | 'warning' | 'muted'
  readonly role?: 'alert' | 'status'
  readonly className?: string
}

const toneClasses = { error: 'text-danger', warning: 'text-warning', muted: 'text-muted' }

export function InlineError({
  message,
  onRetry,
  retrying = false,
  retryLabel,
  tone = 'error',
  role,
  className
}: InlineErrorProps) {
  const { t } = useTranslation(shellMessages)
  const textRef = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const isText = typeof message === 'string'

  useEffect(() => {
    setExpanded(false)
  }, [message])

  useEffect(() => {
    const element = textRef.current
    if (!isText || !element || expanded) return
    const measure = () => setOverflows(element.scrollWidth > element.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [message, isText, expanded])

  if (!message) return null
  const toggleLabel = t(
    tone === 'error'
      ? expanded
        ? 'collapseError'
        : 'expandError'
      : expanded
        ? 'collapseMessage'
        : 'expandMessage'
  )

  return (
    <div
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
      className={cn('flex min-w-0 items-start gap-3 text-xs', className)}
    >
      <span
        ref={textRef}
        className={cn(
          'min-w-0 flex-1 text-left',
          isText && !expanded ? 'truncate' : 'break-words whitespace-pre-wrap',
          toneClasses[tone]
        )}
      >
        {message}
      </span>
      {isText && overflows && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          title={toggleLabel}
          className={cn(
            'shrink-0 cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            toneClasses[tone]
          )}
        >
          <Icon
            icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
            width={16}
            height={16}
          />
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying || undefined}
          className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50"
        >
          {retryLabel ?? t('retry')}
        </button>
      )}
    </div>
  )
}
