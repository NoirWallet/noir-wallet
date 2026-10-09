export const SPENDABILITY_SYNC_IN_PROGRESS_MESSAGE =
  'Wallet sync is still in progress. Please try again when it finishes.'
export const SPENDABILITY_REPAIR_STARTED_MESSAGE =
  'Wallet balance metadata is being refreshed. Please try again after sync finishes.'
export const SPENDABILITY_MANUAL_RESYNC_REQUIRED_MESSAGE =
  'Wallet balance metadata could not be refreshed. Open the account settings and choose Resync wallet.'

interface SpendabilityRecoveryOptions<T> {
  operation: () => Promise<T>
  isMetadataError: (error: unknown) => boolean
  isSyncing: () => Promise<boolean>
  waitForSyncIdle: () => Promise<boolean>
  recover: () => Promise<void>
  onSyncRace?: () => void
}

interface SpendabilitySnapshotRefreshOptions {
  hasAttempted: () => boolean
  markAttempted: () => void
  clearAttempt: () => void
  reloadPersistedSnapshot: () => Promise<void>
  startCatchUpSync: () => void | Promise<void>
}

/**
 * Reloads the last durable wallet snapshot once without deleting scan state.
 * A persistent metadata failure is escalated to an explicit manual resync.
 */
export async function runSpendabilitySnapshotRefresh({
  hasAttempted,
  markAttempted,
  clearAttempt,
  reloadPersistedSnapshot,
  startCatchUpSync
}: SpendabilitySnapshotRefreshOptions): Promise<void> {
  if (hasAttempted()) {
    throw new Error(SPENDABILITY_MANUAL_RESYNC_REQUIRED_MESSAGE)
  }

  markAttempted()
  try {
    await reloadPersistedSnapshot()
    await startCatchUpSync()
  } catch (error) {
    clearAttempt()
    throw error
  }
}

/**
 * Retries metadata-sensitive work without treating an active sync as corruption.
 * Only two consecutive failures observed while idle are strong enough to refresh
 * the wallet runtime; failures observed during sync are discarded as transient evidence.
 */
export async function runWithSpendabilityRecovery<T>({
  operation,
  isMetadataError,
  isSyncing,
  waitForSyncIdle,
  recover,
  onSyncRace
}: SpendabilityRecoveryOptions<T>): Promise<T> {
  let stableFailures = 0
  const startedDuringSync = await isSyncing()

  try {
    return await operation()
  } catch (error) {
    if (!isMetadataError(error)) throw error
    stableFailures = startedDuringSync || (await isSyncing()) ? 0 : 1
  }

  // Bound retries so repeated sync restarts cannot leave an estimate pending forever.
  for (let retry = 0; retry < 4 && stableFailures < 2; retry++) {
    if (await isSyncing()) {
      stableFailures = 0
      onSyncRace?.()
      if (!(await waitForSyncIdle())) {
        throw new Error(SPENDABILITY_SYNC_IN_PROGRESS_MESSAGE)
      }
    }

    try {
      return await operation()
    } catch (error) {
      if (!isMetadataError(error)) throw error
      if (await isSyncing()) {
        stableFailures = 0
      } else {
        stableFailures += 1
      }
    }
  }

  if (stableFailures < 2) {
    throw new Error(SPENDABILITY_SYNC_IN_PROGRESS_MESSAGE)
  }

  await recover()
  throw new Error(SPENDABILITY_REPAIR_STARTED_MESSAGE)
}
