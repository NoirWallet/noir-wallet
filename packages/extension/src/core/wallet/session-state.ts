export const SESSION_PASSWORD_STORAGE_KEY = 'session_password'

interface StorageChangeLike {
  readonly oldValue?: unknown
  readonly newValue?: unknown
}

export function didWalletSessionEnd(
  changes: Readonly<Record<string, StorageChangeLike>>,
  areaName: string
): boolean {
  if (areaName !== 'session') return false
  const passwordChange = changes[SESSION_PASSWORD_STORAGE_KEY]
  return passwordChange?.oldValue !== undefined && passwordChange.newValue === undefined
}
