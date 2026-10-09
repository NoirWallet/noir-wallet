export interface PassiveSyncState {
  now: number
  lastSyncTime: number | null
  maxAgeMs: number
  isSchedulerRunning: boolean
}

export interface PeriodicSyncActivityState {
  isSchedulerRunning: boolean
  isWalletUiOpen: boolean
  hasPendingTransactions: boolean
}

export function shouldSchedulePassiveSync(state: PassiveSyncState): boolean {
  if (state.isSchedulerRunning) return false
  if (state.lastSyncTime === null) return true
  return state.now - state.lastSyncTime >= state.maxAgeMs
}

export function shouldRequestPeriodicSync(state: PeriodicSyncActivityState): boolean {
  if (state.isSchedulerRunning) return false
  return state.isWalletUiOpen || state.hasPendingTransactions
}
