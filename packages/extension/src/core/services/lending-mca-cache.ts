export type McaCacheStatus = {
  mcaId: string | null
  publicKey: string | null
  signingMode: 'derived' | 'legacy' | 'legacy_index0'
}

const mcaStatusCache = new Map<string, McaCacheStatus>()
const mcaCheckInFlight = new Map<string, Promise<McaCacheStatus>>()

export function getMcaCacheKey(walletId: string, accountId: string): string {
  return `${walletId}:${accountId}`
}

export function getCachedMcaStatus(key: string): McaCacheStatus | undefined {
  return mcaStatusCache.get(key)
}

export function setCachedMcaStatus(key: string, status: McaCacheStatus): void {
  mcaStatusCache.set(key, status)
}

export function clearLendingMcaCache(walletId?: string, accountId?: string): void {
  if (walletId && accountId) {
    mcaStatusCache.delete(getMcaCacheKey(walletId, accountId))
    return
  }
  if (walletId) {
    for (const key of mcaStatusCache.keys()) {
      if (key.startsWith(`${walletId}:`)) {
        mcaStatusCache.delete(key)
      }
    }
    return
  }
  mcaStatusCache.clear()
  mcaCheckInFlight.clear()
}

export function runMcaCheckDeduped(
  cacheKey: string,
  operation: () => Promise<McaCacheStatus>
): Promise<McaCacheStatus> {
  const cached = mcaStatusCache.get(cacheKey)
  if (cached) {
    return Promise.resolve(cached)
  }

  const pending = mcaCheckInFlight.get(cacheKey)
  if (pending) {
    return pending
  }

  const promise = operation()
    .then(result => {
      mcaStatusCache.set(cacheKey, result)
      return result
    })
    .finally(() => {
      if (mcaCheckInFlight.get(cacheKey) === promise) {
        mcaCheckInFlight.delete(cacheKey)
      }
    })

  mcaCheckInFlight.set(cacheKey, promise)
  return promise
}
