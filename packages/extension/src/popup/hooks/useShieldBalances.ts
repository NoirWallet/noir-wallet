import { useCallback, useEffect, useRef, useState } from 'react'
import { DedupPromise } from '@/lib/async-utils'
import {
  confidentialFundingClient,
  type ConfidentialBalance
} from '@/popup/services/confidential-funding-client'
import type { Network } from '@/types/wallet'

const BALANCE_REUSE_MS = 30_000

type BalanceScope = Readonly<{ network: Network; keyDomainId: string; accountId: string }>
type BalanceCache = {
  balances: readonly ConfidentialBalance[] | null
  refreshedAt: number
  request: DedupPromise<readonly ConfidentialBalance[]>
}

export function useShieldBalances({
  active,
  enabled,
  scopeKey,
  scope,
  refreshPortfolio,
  readProjection
}: Readonly<{
  active: boolean
  enabled: boolean
  scopeKey: string
  scope: BalanceScope | null
  refreshPortfolio: (force?: boolean) => Promise<void>
  readProjection?: () => Promise<void>
}>) {
  const cacheRef = useRef<{ key: string; cache: BalanceCache } | null>(null)
  if (cacheRef.current?.key !== scopeKey) {
    cacheRef.current = {
      key: scopeKey,
      cache: { balances: null, refreshedAt: 0, request: new DedupPromise() }
    }
  }
  const cache = cacheRef.current.cache
  const [snapshot, setSnapshot] = useState(() => ({ key: scopeKey, balances: cache.balances }))
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const currentKey = useRef(scopeKey)
  const activeRef = useRef(active)
  const refreshPortfolioRef = useRef(refreshPortfolio)
  const readProjectionRef = useRef(readProjection)
  currentKey.current = scopeKey
  activeRef.current = active
  refreshPortfolioRef.current = refreshPortfolio
  readProjectionRef.current = readProjection

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    setConnecting(false)
    setError(null)
  }, [scopeKey])

  const refreshBalances = useCallback(
    async (force = true) => {
      if (!scope || !enabled || !activeRef.current) return false
      if (cache.request.isPending) return false
      const age = Date.now() - cache.refreshedAt
      if (!force && cache.balances && age >= 0 && age < BALANCE_REUSE_MS) {
        setSnapshot({ key: scopeKey, balances: cache.balances })
        return true
      }
      setConnecting(true)
      setError(null)
      try {
        const balances = await cache.request.run(
          () => confidentialFundingClient.refreshBalances(scope, true),
          value => {
            cache.balances = value
            cache.refreshedAt = Date.now()
          }
        )
        if (mounted.current && currentKey.current === scopeKey) {
          setSnapshot({ key: scopeKey, balances })
          if (activeRef.current) {
            if (readProjectionRef.current) void readProjectionRef.current().catch(() => {})
            else void refreshPortfolioRef.current(force).catch(() => {})
          }
        }
        return true
      } catch (cause) {
        if (mounted.current && currentKey.current === scopeKey)
          setError(cause instanceof Error ? cause.message : 'Shield balance unavailable')
        return false
      } finally {
        if (mounted.current && currentKey.current === scopeKey) setConnecting(false)
      }
    },
    [scopeKey, scope?.network, scope?.keyDomainId, scope?.accountId, enabled, cache]
  )

  useEffect(() => {
    if (active) void refreshBalances(false)
  }, [active, refreshBalances])

  return {
    balances: snapshot.key === scopeKey ? snapshot.balances : cache.balances,
    connecting,
    error,
    refreshBalances
  }
}
