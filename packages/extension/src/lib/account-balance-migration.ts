import Big from 'big.js'
import { safeBig } from './big'
import type { ZcashBalance } from '@/types'

function storedAmount(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? safeBig(value).toFixed() : '0'
}

function storedRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function storedEntries(value: unknown): [string, unknown][] {
  if (value instanceof Map) {
    return Array.from(value.entries()).filter(
      (entry): entry is [string, unknown] => typeof entry[0] === 'string'
    )
  }

  const record = storedRecord(value)
  return record ? Object.entries(record) : []
}

function nonNegativeAmount(value: Big): string {
  return value.gt(0) ? value.toFixed() : '0'
}

/** Normalizes pre-v1 cached balances without treating an unknown amount as spendable. */
export function migrateStoredBalance(value: unknown): ZcashBalance {
  const balance = storedRecord(value) ?? {}
  const transparent = storedAmount(balance.transparent)
  const shielded = storedAmount(balance.shielded)
  const total =
    balance.total == null
      ? safeBig(transparent).plus(shielded).toFixed()
      : storedAmount(balance.total)
  const storedPending = storedRecord(balance.pending)
  const storedConfirmed = storedRecord(balance.confirmed)

  const recoverConfirmed = (
    storedConfirmedAmount: unknown,
    sourceTotal: string,
    storedPendingAmount: unknown
  ): string => {
    if (storedConfirmedAmount != null) return storedAmount(storedConfirmedAmount)
    if (storedPending) {
      return nonNegativeAmount(safeBig(sourceTotal).minus(storedAmount(storedPendingAmount)))
    }
    return '0'
  }
  const confirmed = {
    shielded: recoverConfirmed(storedConfirmed?.shielded, shielded, storedPending?.shielded),
    transparent: recoverConfirmed(
      storedConfirmed?.transparent,
      transparent,
      storedPending?.transparent
    )
  }

  const pending = storedPending
    ? {
        shielded: storedAmount(storedPending.shielded),
        transparent: storedAmount(storedPending.transparent),
        total:
          storedPending.total == null
            ? safeBig(storedAmount(storedPending.shielded))
                .plus(storedAmount(storedPending.transparent))
                .toFixed()
            : storedAmount(storedPending.total)
      }
    : {
        shielded: nonNegativeAmount(safeBig(shielded).minus(confirmed.shielded)),
        transparent: nonNegativeAmount(safeBig(transparent).minus(confirmed.transparent)),
        total: nonNegativeAmount(
          safeBig(total).minus(safeBig(confirmed.shielded).plus(confirmed.transparent))
        )
      }

  const spendable =
    balance.spendable == null
      ? safeBig(confirmed.shielded).plus(confirmed.transparent).toFixed()
      : storedAmount(balance.spendable)

  return {
    ...balance,
    transparent,
    shielded,
    total,
    spendable,
    available: spendable,
    confirmed,
    pending
  } as ZcashBalance
}

export function migrateAccountDataState(persisted: unknown, version = 0): unknown {
  if (version >= 2) return persisted
  const state = storedRecord(persisted)
  if (!state) return persisted

  // v1 balances used a stricter confirmation policy, so their selectable amounts
  // remain conservative until a fresh wallet summary is available.
  const balances =
    version < 1
      ? Object.fromEntries(
          storedEntries(state.balances).map(([key, balance]) => [
            key,
            migrateStoredBalance(balance)
          ])
        )
      : state.balances
  const syncStates = Object.fromEntries(
    storedEntries(state.syncStates).map(([key, syncState]) => [
      key,
      { ...(storedRecord(syncState) ?? {}), isSyncing: false, lastSyncTime: null }
    ])
  )

  return { ...state, balances, syncStates }
}

/** Restores persisted records to the Map-backed shapes required by the runtime store. */
export function rehydrateAccountDataState<T extends object>(persisted: unknown, current: T): T {
  const stored = storedRecord(persisted) ?? {}
  const balances = new Map(storedEntries(stored.balances))
  const syncStates = new Map(
    storedEntries(stored.syncStates).map(([key, syncState]) => [
      key,
      { ...(storedRecord(syncState) ?? {}), isSyncing: false }
    ])
  )

  return {
    ...current,
    ...stored,
    balances,
    syncStates,
    transactionsCache: new Map(),
    transactionsLoaded: new Set()
  } as T
}
