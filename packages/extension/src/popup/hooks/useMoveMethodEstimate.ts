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
}): { value: MoveMethodEstimate | null; loading: boolean } {
  const estimateRef = useRef(estimate)
  estimateRef.current = estimate
  const [state, setState] = useState<{
    key: string
    value: MoveMethodEstimate | null
    loading: boolean
  }>({ key: '', value: null, loading: false })
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    setState({ key: requestKey, value: null, loading: enabled })
    if (!enabled) return () => controller.abort()
    const refresh = async () => {
      setState({ key: requestKey, value: null, loading: true })
      try {
        const value = await estimateRef.current(controller.signal)
        if (controller.signal.aborted) return
        const expiresIn = Math.min(30_000, value.expiresAt - Date.now())
        setState({ key: requestKey, value: expiresIn > 0 ? value : null, loading: false })
        if (expiresIn > 0) timer = setTimeout(() => void refresh(), expiresIn)
      } catch {
        if (!controller.signal.aborted) setState({ key: requestKey, value: null, loading: false })
      }
    }
    timer = setTimeout(() => void refresh(), 450)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [enabled, requestKey])
  return enabled && state.key === requestKey
    ? { value: state.value, loading: state.loading }
    : { value: null, loading: false }
}
