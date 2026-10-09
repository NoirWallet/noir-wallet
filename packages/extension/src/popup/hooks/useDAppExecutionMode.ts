import { useCallback, useEffect, useRef, useState } from 'react'

import type { DAppExecutionMode, DAppExecutionModeState } from '@/core/dapp/dapp-execution-mode'
import { dappExecutionModeClient } from '@/popup/services/dapp-execution-mode-client'

export function useDAppExecutionMode(
  enabled: boolean,
  walletId: string | null | undefined,
  accountId: string | null | undefined
) {
  const [state, setState] = useState<DAppExecutionModeState | null>(null)
  const [loading, setLoading] = useState(Boolean(enabled && walletId && accountId))
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestVersion = useRef(0)
  const scopeKey = enabled && walletId && accountId ? JSON.stringify([walletId, accountId]) : null

  const refresh = useCallback(async () => {
    if (!scopeKey) {
      setState(null)
      setError(null)
      setLoading(false)
      return null
    }
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    try {
      const next = await dappExecutionModeClient.read()
      if (version === requestVersion.current) setState(next)
      return next
    } catch (caught) {
      if (version === requestVersion.current) {
        setState(null)
        setError(caught instanceof Error ? caught.message : 'Unable to read dApp account mode')
      }
      throw caught
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [scopeKey])

  useEffect(() => {
    void refresh().catch(() => {})
    return () => {
      requestVersion.current += 1
    }
  }, [refresh])

  const setMode = useCallback(
    async (
      mode: DAppExecutionMode,
      options: Readonly<{
        confirmPrivateSetup?: boolean
        confirmAffectedOperations?: boolean
      }> = {}
    ) => {
      if (!scopeKey) throw new Error('No active dApp account mode scope')
      const version = ++requestVersion.current
      setUpdating(true)
      setError(null)
      try {
        const next = await dappExecutionModeClient.set(mode, options)
        if (version === requestVersion.current) setState(next)
        return next
      } catch (caught) {
        if (version === requestVersion.current) {
          setError(caught instanceof Error ? caught.message : 'Unable to change dApp account mode')
        }
        throw caught
      } finally {
        if (version === requestVersion.current) setUpdating(false)
      }
    },
    [scopeKey]
  )

  return Object.freeze({ state, loading, updating, error, refresh, setMode })
}
