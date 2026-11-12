import { useEffect, useRef, useState } from 'react'
import type { MoveMethodEstimate } from '@/popup/services/move-method-estimate'

export function useMoveMethodEstimate({
  enabled,
  requestKey,
  estimate
}: {
  readonly enabled: boolean
  readonly requestKey: string
  readonly estimate: (signal: AbortSignal) => Promise<MoveMethodEstimate>
}): { value: MoveMethodEstimate | null; loading: boolean; error: boolean } {
  const estimateRef = useRef(estimate)
  estimateRef.current = estimate
  const [state, setState] = useState<{
    key: string
    value: MoveMethodEstimate | null
    loading: boolean
    error: boolean
  }>({ key: '', value: null, loading: false, error: false })
  useEffect(() => {
    const controller = new AbortController()
    setState({ key: requestKey, value: null, loading: enabled, error: false })
    if (!enabled) return () => controller.abort()
    // These are indicative fees, not execution quotes. Review obtains a fresh
    // quote; polling here repeatedly prepares routes while the user is idle.
    const timer = setTimeout(async () => {
      try {
        const value = await estimateRef.current(controller.signal)
        if (!controller.signal.aborted)
          setState({ key: requestKey, value, loading: false, error: value.routeFeeRaw === null })
      } catch {
        if (!controller.signal.aborted)
          setState({ key: requestKey, value: null, loading: false, error: true })
      }
    }, 450)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [enabled, requestKey])
  return enabled && state.key === requestKey
    ? { value: state.value, loading: state.loading, error: state.error }
    : { value: null, loading: false, error: false }
}
