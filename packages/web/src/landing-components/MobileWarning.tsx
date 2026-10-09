import { useState } from 'react'

export function MobileWarning({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 px-6 md:hidden">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-2xl">
          💻
        </div>
        <h3 className="text-lg font-medium text-white">Desktop Only</h3>
        <p className="mt-2 text-sm leading-relaxed text-text-60">
          Noir Wallet is a Chrome browser extension and is only available on desktop. Please visit
          this page on your computer to install.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          Got it
        </button>
      </div>
    </div>
  )
}

export function useMobileWarning() {
  const [show, setShow] = useState(false)

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768

  const handleClick = (e: React.MouseEvent, fallback?: () => void) => {
    if (isMobile()) {
      e.preventDefault()
      setShow(true)
    } else {
      fallback?.()
    }
  }

  return { show, setShow, handleClick }
}
