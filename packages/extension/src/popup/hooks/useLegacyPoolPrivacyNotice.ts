import { useCallback, useEffect, useRef, useState } from 'react'
import {
  markLegacyPoolPrivacyNoticeShown,
  readLegacyPoolPrivacyNoticeShown,
  shouldShowLegacyPoolPrivacyNotice
} from '@/lib/legacy-pool-privacy-notice'

export function useLegacyPoolPrivacyNotice(hasLegacyBalance: boolean) {
  const [isOpen, setIsOpen] = useState(false)
  const hasChecked = useRef(false)

  useEffect(() => {
    if (!hasLegacyBalance || hasChecked.current) return

    hasChecked.current = true
    readLegacyPoolPrivacyNoticeShown()
      .then(hasShown => {
        if (!shouldShowLegacyPoolPrivacyNotice(hasLegacyBalance, hasShown)) return
        setIsOpen(true)
      })
      .catch(error => {
        console.warn('[PrivacyNotice] Failed to read shown state:', error)
      })
  }, [hasLegacyBalance])

  const dismiss = useCallback(async (): Promise<void> => {
    try {
      await markLegacyPoolPrivacyNoticeShown()
    } catch (error) {
      console.warn('[PrivacyNotice] Failed to persist dismissed state:', error)
    } finally {
      setIsOpen(false)
    }
  }, [])

  return { isOpen, dismiss }
}
