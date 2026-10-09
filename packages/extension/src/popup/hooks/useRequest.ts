import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { sleep } from '@/lib/utils'

interface RequestOptions<T> {
  /** Dependencies that trigger auto-refresh */
  refreshDeps?: React.DependencyList
  /** Pre-check before request, return false to cancel */
  before?: () => boolean | undefined
  /** If true, won't auto-run on mount */
  manual?: boolean
  /** Success callback */
  onSuccess?: (res: T) => void
  /** Error callback */
  onError?: (err: Error) => void
  /** Retry count on failure */
  retryCount?: number
  /** Retry interval in ms */
  retryInterval?: number
  /** Polling interval in ms (0 = disabled) */
  pollingInterval?: number
}

interface RequestResult<T> {
  data: T | undefined
  loading: boolean
  error: Error | undefined
  run: () => Promise<void>
  mutate: (data: T | undefined) => void
  clearPolling: () => void
}

/**
 * Custom hook for async requests with polling, retry and caching
 */
export function useRequest<T>(
  request: () => Promise<T>,
  options?: RequestOptions<T>
): RequestResult<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<Error | undefined>(undefined)

  const {
    refreshDeps = [],
    before,
    manual = false,
    onSuccess,
    onError,
    retryCount = 0,
    retryInterval = 1000,
    pollingInterval = 0
  } = useMemo(() => options || {}, [options])

  const pollingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const clearPolling = useCallback(() => {
    if (pollingTimer.current) {
      clearTimeout(pollingTimer.current)
      pollingTimer.current = null
    }
  }, [])

  const run = useCallback(async () => {
    clearPolling()

    // Pre-check
    if (before && !before()) return

    let attempts = 0

    const executeRequest = async (): Promise<boolean> => {
      try {
        setLoading(true)
        setError(undefined)
        const res = await request()

        if (!mountedRef.current) return true

        setData(res)
        onSuccess?.(res)
        return true
      } catch (err) {
        if (!mountedRef.current) return false

        const error = err instanceof Error ? err : new Error(String(err))
        console.error('useRequest error:', error)
        setError(error)
        onError?.(error)
        return false
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    }

    const attemptRequest = async (): Promise<void> => {
      const success = await executeRequest()
      if (!success && attempts < retryCount && mountedRef.current) {
        attempts += 1
        await sleep(retryInterval)
        await attemptRequest()
      }
    }

    await attemptRequest()

    // Setup polling
    if (pollingInterval > 0 && mountedRef.current) {
      pollingTimer.current = setTimeout(run, pollingInterval)
    }
  }, [
    clearPolling,
    before,
    request,
    onSuccess,
    onError,
    retryCount,
    retryInterval,
    pollingInterval
  ])

  // Auto-run on mount and when refreshDeps change
  useEffect(() => {
    mountedRef.current = true

    if (!manual) {
      run()
    }

    return () => {
      mountedRef.current = false
      clearPolling()
    }
  }, [manual, ...refreshDeps])

  return {
    data,
    loading,
    error,
    run,
    mutate: setData,
    clearPolling
  }
}

/**
 * Simplified hook for polling-only scenarios
 */
export function usePolling<T>(
  request: () => Promise<T>,
  interval: number,
  options?: Omit<RequestOptions<T>, 'pollingInterval'>
): RequestResult<T> {
  return useRequest(request, { ...options, pollingInterval: interval })
}
