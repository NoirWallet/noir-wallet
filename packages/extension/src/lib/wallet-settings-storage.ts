const LOCK_NAME = 'noir-wallet-settings'

export async function withWalletSettingsLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('Wallet settings coordination is unavailable')
  return navigator.locks.request(LOCK_NAME, operation)
}
