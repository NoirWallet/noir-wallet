import { Icon } from '@iconify/react'
import { cn } from '@/lib/utils'

export type EndpointProbeResult = {
  status: 'pending' | 'ok' | 'unreachable'
  latencyMs?: number
}

export function EndpointLatencyBadge({ result }: { result?: EndpointProbeResult }) {
  if (!result || result.status === 'pending') {
    return (
      <Icon icon="lucide:loader-2" width={14} height={14} className="animate-spin text-muted" />
    )
  }
  if (result.status === 'unreachable' || result.latencyMs === undefined) {
    return <span className="text-xs text-danger">--</span>
  }
  const tone =
    result.latencyMs < 200
      ? 'text-primary'
      : result.latencyMs < 500
        ? 'text-warning'
        : 'text-danger'
  return <span className={cn('text-xs tabular-nums', tone)}>{result.latencyMs} ms</span>
}

export function EndpointSelectionIndicator({
  selected,
  applying
}: {
  selected: boolean
  applying: boolean
}) {
  if (applying) {
    return (
      <Icon icon="lucide:loader-2" width={16} height={16} className="animate-spin text-primary" />
    )
  }
  return (
    <span
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border bg-white/5',
        selected ? 'border-primary bg-primary/15' : 'border-white/15'
      )}
      aria-hidden="true"
    >
      {selected && <span className="size-2 rounded-full bg-primary" />}
    </span>
  )
}
