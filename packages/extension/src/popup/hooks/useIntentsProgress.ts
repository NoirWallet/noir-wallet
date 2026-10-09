import { useCallback, useEffect, useRef, useState } from 'react'
import type { IntentsProgressEntry } from '@/lib/intents-progress'

export function useIntentsProgress(accountKey?: string): IntentsProgressEntry[] {
  const latestAccountKeyRef = useRef(accountKey)
  latestAccountKeyRef.current = accountKey
  const [snapshot, setSnapshot] = useState<{
    accountKey?: string
    entries: IntentsProgressEntry[]
  }>({ accountKey, entries: [] })

  const loadProgress = useCallback(async () => {
    if (!accountKey) {
      setSnapshot({ accountKey: undefined, entries: [] })
      return
    }

    const response = await chrome.runtime.sendMessage({ type: 'GET_INTENTS_PROGRESS', accountKey })
    if (latestAccountKeyRef.current !== accountKey) return
    setSnapshot({
      accountKey,
      entries: response?.success && Array.isArray(response.progress) ? response.progress : []
    })
  }, [accountKey])

  useEffect(() => {
    setSnapshot({ accountKey, entries: [] })
    loadProgress().catch(() => {
      if (latestAccountKeyRef.current === accountKey) {
        setSnapshot({ accountKey, entries: [] })
      }
    })
    const listener = (message: { type?: string; accountKey?: string }) => {
      if (message.type === 'INTENTS_PROGRESS_UPDATED' && message.accountKey === accountKey) {
        loadProgress().catch(() => {})
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [accountKey, loadProgress])

  return snapshot.accountKey === accountKey ? snapshot.entries : []
}
