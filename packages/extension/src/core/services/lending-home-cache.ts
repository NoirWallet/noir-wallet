import type { Network } from '@/types'
import type { LendingSigningMode } from './lending-service'

const STORAGE_KEY = 'lending_home_cache_v1'
const MAX_CACHE_ENTRIES = 24

export interface LendingHomeCacheEntry {
  suppliedZec: string
  mcaId: string | null
  signingMode: LendingSigningMode
  mcaChecked: boolean
  updatedAt: number
}

type LendingHomeCache = Record<string, LendingHomeCacheEntry>

function buildCacheKey(network: Network, walletId: string, accountId: string): string {
  return `${network}:${walletId}:${accountId}`
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseEntry(value: unknown): LendingHomeCacheEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const entry = value as Record<string, unknown>
  const signingMode = entry.signingMode
  if (
    typeof entry.suppliedZec !== 'string' ||
    !/^\d+(?:\.\d+)?$/.test(entry.suppliedZec) ||
    !isNullableString(entry.mcaId) ||
    (signingMode !== 'derived' && signingMode !== 'legacy' && signingMode !== 'legacy_index0') ||
    typeof entry.mcaChecked !== 'boolean' ||
    typeof entry.updatedAt !== 'number' ||
    !Number.isFinite(entry.updatedAt) ||
    entry.updatedAt <= 0
  ) {
    return null
  }

  return {
    suppliedZec: entry.suppliedZec,
    mcaId: entry.mcaId,
    signingMode,
    mcaChecked: entry.mcaChecked,
    updatedAt: entry.updatedAt
  }
}

function parseCache(value: unknown): LendingHomeCache {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const cache: LendingHomeCache = {}
  for (const [key, entry] of Object.entries(value)) {
    const parsed = parseEntry(entry)
    if (parsed) cache[key] = parsed
  }
  return cache
}

export async function readLendingHomeCache(
  network: Network,
  walletId: string,
  accountId: string
): Promise<LendingHomeCacheEntry | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const cache = parseCache(stored[STORAGE_KEY])
  return cache[buildCacheKey(network, walletId, accountId)] ?? null
}

export async function writeLendingHomeCache(
  network: Network,
  walletId: string,
  accountId: string,
  entry: LendingHomeCacheEntry
): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const cache = parseCache(stored[STORAGE_KEY])
  cache[buildCacheKey(network, walletId, accountId)] = entry

  const trimmedCache = Object.fromEntries(
    Object.entries(cache)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CACHE_ENTRIES)
  )
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmedCache })
}

export async function clearLendingHomeCache(walletId?: string): Promise<void> {
  if (!walletId) {
    await chrome.storage.local.remove(STORAGE_KEY)
    return
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const cache = parseCache(stored[STORAGE_KEY])
  const nextCache = Object.fromEntries(
    Object.entries(cache).filter(([key]) => key.split(':')[1] !== walletId)
  )

  if (Object.keys(nextCache).length === 0) {
    await chrome.storage.local.remove(STORAGE_KEY)
  } else {
    await chrome.storage.local.set({ [STORAGE_KEY]: nextCache })
  }
}
