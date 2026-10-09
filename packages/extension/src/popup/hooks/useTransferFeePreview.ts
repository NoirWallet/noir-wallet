import { useEffect, useRef, useState } from 'react'

interface TransferFeePreviewOptions {
  readonly enabled: boolean
  readonly requestKey: string
  readonly estimate: () => Promise<string>
  readonly delayMs?: number
}

interface TransferFeePreview {
  readonly amountRaw: string | null
  readonly loading: boolean
}

export function useTransferFeePreview({
  enabled,
  requestKey,
  estimate,
  delayMs = 450
}: TransferFeePreviewOptions): TransferFeePreview {
  const estimateRef = useRef(estimate)
  const [amountRaw, setAmountRaw] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    estimateRef.current = estimate
  }, [estimate])

  useEffect(() => {
    let active = true
    setAmountRaw(null)
    setLoading(false)
    if (!enabled) return () => undefined
    setLoading(true)

    const timer = window.setTimeout(() => {
      if (!active) return
      void estimateRef
        .current()
        .then(value => {
          if (active) setAmountRaw(value)
        })
        .catch(() => {
          if (active) setAmountRaw(null)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, delayMs)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [delayMs, enabled, requestKey])

  return { amountRaw, loading }
}
