import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@iconify/react'

interface CopyToastProps {
  show: boolean
}

export function CopyToast({ show }: CopyToastProps) {
  if (!show) return null

  return createPortal(
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="bg-card border border-white/10 rounded-lg px-4 py-2.5 flex items-center gap-2 shadow-lg">
        <Icon icon="lucide:circle-alert" width={16} height={16} className="text-destructive" />
        <span className="text-sm font-medium">Could not copy</span>
      </div>
    </div>,
    document.body
  )
}

export function CopyFeedbackIcon({
  copied,
  width = 16,
  height = width,
  className
}: {
  copied: boolean
  width?: number
  height?: number
  className?: string
}) {
  return (
    <Icon
      icon={copied ? 'lucide:check' : 'lucide:copy'}
      width={width}
      height={height}
      className={className}
    />
  )
}

export function useCopyToClipboard() {
  const [showToast, setShowToast] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copiedKeys, setCopiedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const requests = useRef(new Map<string, number>())

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const timer of timers.current.values()) clearTimeout(timer)
      if (errorTimer.current) clearTimeout(errorTimer.current)
    }
  }, [])

  const copyToClipboard = async (text: string, key = 'default'): Promise<boolean> => {
    const currentRequest = (requests.current.get(key) ?? 0) + 1
    requests.current.set(key, currentRequest)
    const oldTimer = timers.current.get(key)
    if (oldTimer) clearTimeout(oldTimer)
    timers.current.delete(key)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    setShowToast(false)
    try {
      await navigator.clipboard.writeText(text)
      if (!mounted.current || currentRequest !== requests.current.get(key)) return true
      setCopiedKey(key)
      setCopiedKeys(current => new Set(current).add(key))
      timers.current.set(
        key,
        setTimeout(() => {
          setCopiedKeys(current => {
            const next = new Set(current)
            next.delete(key)
            return next
          })
          setCopiedKey(current => (current === key ? null : current))
          timers.current.delete(key)
        }, 2000)
      )
      return true
    } catch {
      if (mounted.current && currentRequest === requests.current.get(key)) {
        setCopiedKeys(current => {
          const next = new Set(current)
          next.delete(key)
          return next
        })
        setCopiedKey(current => (current === key ? null : current))
        setShowToast(true)
        errorTimer.current = setTimeout(() => {
          setShowToast(false)
          errorTimer.current = null
        }, 2000)
      }
      return false
    }
  }

  return {
    copyToClipboard,
    showToast,
    copiedKey,
    isCopied: (key = 'default') => copiedKeys.has(key)
  }
}
