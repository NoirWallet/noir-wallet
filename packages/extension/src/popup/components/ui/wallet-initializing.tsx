import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface WalletInitializingProps {
  className?: string
}

export function WalletInitializing({ className }: WalletInitializingProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center bg-background',
        'transition-opacity duration-500',
        visible ? 'opacity-100' : 'opacity-0',
        className
      )}
    >
      {/* Gradient background effect */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] animate-pulse" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        {/* Animated spinner with rings */}
        <div className="relative">
          {/* Outer ring */}
          <div className="absolute inset-0 w-20 h-20 rounded-full border-2 border-primary/20 animate-ping" />

          {/* Inner spinning icon */}
          <div className="relative w-20 h-20 flex items-center justify-center">
            <img
              src="icons/icon128.png"
              alt="Noir Wallet"
              className="w-14 h-14"
              crossOrigin="anonymous"
            />
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-2 mt-10">
          <div className="flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <div
              className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <div
              className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
