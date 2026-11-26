import { useEffect } from 'react'
import { FOREGROUND_ZCASH_PROBE_PORT } from '@/config/extension'

export function useHomeZcashTipProbe(scopeKey: string | null) {
  useEffect(() => {
    if (!scopeKey) return

    let active = true
    let wasVisible = false
    let port: chrome.runtime.Port | null = null

    const onDisconnect = (connection: chrome.runtime.Port) => {
      void chrome.runtime.lastError
      if (port === connection) port = null
    }

    const disconnect = () => {
      const connection = port
      if (!connection) return
      port = null
      connection.onDisconnect.removeListener(onDisconnect)
      connection.disconnect()
    }

    const onVisibilityChange = () => {
      if (!active) return
      const visible = document.visibilityState === 'visible'
      if (visible === wasVisible) return
      wasVisible = visible
      if (!visible) {
        disconnect()
        return
      }

      try {
        port = chrome.runtime.connect({ name: FOREGROUND_ZCASH_PROBE_PORT })
      } catch {
        return
      }
      port.onDisconnect.addListener(onDisconnect)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    queueMicrotask(onVisibilityChange)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      disconnect()
    }
  }, [scopeKey])
}
