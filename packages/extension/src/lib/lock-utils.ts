import { accountManager } from '@/core/wallet/account-manager'
import { SecureStorage } from '@/core/wallet/secure-storage'
import { readPersistedAutoLockMs, shouldRequireUnlock } from '@/config/auto-lock'

/**
 * Check if unlock is needed based on activity timeout
 * @returns true if manual unlock required, false if already unlocked or can restore from session
 */
export async function needsUnlock(): Promise<boolean> {
  const [lastActivityTime, autoLockMs] = await Promise.all([
    SecureStorage.getLastActivityTime(),
    readPersistedAutoLockMs()
  ])

  return shouldRequireUnlock({
    lastActivityTime,
    autoLockMs,
    isLocked: accountManager.isLocked(),
    restoreSession: async () => {
      const sessionPassword = await SecureStorage.getSessionPassword()
      if (!sessionPassword) return false

      try {
        const result = await accountManager.unlock(sessionPassword, { skipFailCount: true })
        return result.success
      } catch {
        // Session restore is best effort; the caller will require a manual unlock.
        return false
      }
    }
  })
}
