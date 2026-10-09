import { useState } from 'react'
import { Icon } from '@iconify/react'

interface CopyToastProps {
  show: boolean
  message?: string
}

export function CopyToast({ show, message = 'Copied!' }: CopyToastProps) {
  if (!show) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-card border border-white/10 rounded-lg px-4 py-2.5 flex items-center gap-2 shadow-lg">
        <Icon icon="lucide:check" width={16} height={16} className="text-primary" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  )
}

export function useCopyToClipboard() {
  const [showToast, setShowToast] = useState(false)

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setShowToast(true)
      setTimeout(() => setShowToast(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return { copyToClipboard, showToast }
}
