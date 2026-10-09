import { Icon } from '@iconify/react'
import { useToastStore, type ToastType } from '@/store/toast-store'

const iconConfig: Record<ToastType, { icon: string; color: string; bg: string }> = {
  success: { icon: 'lucide:check', color: 'text-primary', bg: 'bg-primary/20' },
  error: { icon: 'lucide:x', color: 'text-red-500', bg: 'bg-red-500/20' },
  warning: { icon: 'lucide:alert-triangle', color: 'text-yellow-500', bg: 'bg-yellow-500/20' },
  info: { icon: 'lucide:info', color: 'text-primary', bg: 'bg-primary/15' }
}

export function ToastContainer() {
  const toasts = useToastStore(state => state.toasts)
  const removeToast = useToastStore(state => state.removeToast)

  if (toasts.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3"
    >
      {toasts.map(toast => {
        const config = iconConfig[toast.type]
        if (toast.variant === 'notification') {
          return (
            <div
              key={toast.id}
              data-toast-variant="notification"
              className="pointer-events-auto w-full max-w-[351px] animate-in overflow-hidden rounded-2xl border border-white/15 bg-[#242429]/95 shadow-[0_14px_36px_rgba(0,0,0,0.48)] backdrop-blur-2xl fade-in slide-in-from-top-2 duration-200"
            >
              <button
                type="button"
                aria-label={toast.action?.label || toast.title}
                onClick={() => {
                  removeToast(toast.id)
                  toast.action?.onClick()
                }}
                className="grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.07]"
              >
                <img
                  src="/icons/icon128.png"
                  alt=""
                  className="size-11 shrink-0 rounded-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
                />
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-semibold leading-5 text-white">
                      {toast.title}
                    </p>
                    <span className="shrink-0 text-[11px] leading-4 text-muted">Now</span>
                  </div>
                  {toast.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-white/65">
                      {toast.description}
                    </p>
                  )}
                </div>
              </button>
            </div>
          )
        }

        return (
          <div
            key={toast.id}
            data-toast-variant="compact"
            className="pointer-events-auto w-full max-w-[340px] animate-in rounded-xl border border-white/10 bg-card px-4 py-3 shadow-lg fade-in slide-in-from-top-2 duration-200"
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-full ${config.bg}`}
              >
                <Icon icon={config.icon} width={16} height={16} className={config.color} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs text-muted">{toast.description}</p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => removeToast(toast.id)}
                className="shrink-0 text-muted transition-colors hover:text-white"
              >
                <Icon icon="lucide:x" width={14} height={14} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
