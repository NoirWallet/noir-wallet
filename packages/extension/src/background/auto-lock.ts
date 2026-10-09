export const WALLET_AUTO_LOCK_ALARM = 'wallet-auto-lock'

export interface AutoLockCoordinatorOptions {
  readonly readLastActivityTime: () => Promise<number | null>
  readonly readAutoLockMs: () => Promise<number>
  readonly hasUnlockSession: () => Promise<boolean>
  readonly lock: () => Promise<void>
  readonly scheduleAlarm: (when: number) => Promise<void>
  readonly clearAlarm: () => Promise<void>
  readonly now?: () => number
}

export type AutoLockReconcileResult = 'disabled' | 'locked' | 'no-session' | 'scheduled'

export class AutoLockCoordinator {
  private readonly now: () => number
  private inFlight: Promise<AutoLockReconcileResult> | null = null
  private reconcileRequested = false

  constructor(private readonly options: AutoLockCoordinatorOptions) {
    this.now = options.now ?? Date.now
  }

  reconcile(): Promise<AutoLockReconcileResult> {
    this.reconcileRequested = true
    if (this.inFlight) return this.inFlight
    const operation = this.drainReconcileRequests().finally(() => {
      if (this.inFlight === operation) this.inFlight = null
    })
    this.inFlight = operation
    return operation
  }

  private async drainReconcileRequests(): Promise<AutoLockReconcileResult> {
    let result: AutoLockReconcileResult = 'no-session'
    while (this.reconcileRequested) {
      this.reconcileRequested = false
      result = await this.reconcileOnce()
    }
    return result
  }

  private async reconcileOnce(): Promise<AutoLockReconcileResult> {
    const autoLockMs = await this.options.readAutoLockMs()
    if (!Number.isSafeInteger(autoLockMs) || autoLockMs < 0) {
      throw new Error('Invalid auto-lock duration')
    }
    if (autoLockMs === 0) {
      await this.options.clearAlarm()
      return 'disabled'
    }

    const [lastActivityTime, hasUnlockSession] = await Promise.all([
      this.options.readLastActivityTime(),
      this.options.hasUnlockSession()
    ])
    if (!hasUnlockSession || lastActivityTime === null) {
      await this.options.clearAlarm()
      return 'no-session'
    }
    if (!Number.isSafeInteger(lastActivityTime) || lastActivityTime < 0) {
      throw new Error('Invalid last activity timestamp')
    }

    const deadline = lastActivityTime + autoLockMs
    if (!Number.isSafeInteger(deadline)) {
      throw new Error('Invalid auto-lock deadline')
    }
    if (deadline <= this.now()) {
      await this.options.lock()
      await this.options.clearAlarm()
      return 'locked'
    }

    await this.options.scheduleAlarm(deadline)
    return 'scheduled'
  }
}
