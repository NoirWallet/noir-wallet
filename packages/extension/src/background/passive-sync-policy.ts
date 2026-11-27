export interface PeriodicSyncActivityState {
  isSchedulerRunning: boolean
  isWalletLocked: boolean
  hasPersistedSnapshot: boolean
  currentHeight: number
  networkHeight: number
  lagObservedAt: number
  now: number
  minBlockGap: number
  maxLagMs: number
}

export interface PassiveSyncDelayOptions {
  baseMinutes: number
  maxMinutes: number
  failureCount: number
}

export interface InterruptedSyncResumeState {
  now: number
  updatedAt: number
  maxAgeMs: number
  resumeOnStartup?: boolean
}

export function shouldRequestPeriodicSync(state: PeriodicSyncActivityState): boolean {
  if (state.isSchedulerRunning) return false
  if (state.isWalletLocked && !state.hasPersistedSnapshot) return false
  if (!Number.isSafeInteger(state.networkHeight) || state.networkHeight <= 0) return false
  const gap = Math.max(0, state.networkHeight - Math.max(0, state.currentHeight))
  return gap > 0 && (gap >= state.minBlockGap || state.now - state.lagObservedAt >= state.maxLagMs)
}

export function computePassiveSyncDelayMinutes(options: PassiveSyncDelayOptions): number {
  const multiplier = 2 ** Math.max(0, Math.floor(options.failureCount))
  return Math.max(1, Math.min(options.maxMinutes, options.baseMinutes * multiplier))
}

export function shouldResumeInterruptedSync(state: InterruptedSyncResumeState): boolean {
  return state.resumeOnStartup !== false && state.now - state.updatedAt < state.maxAgeMs
}
