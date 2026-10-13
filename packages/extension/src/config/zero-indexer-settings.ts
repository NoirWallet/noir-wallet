import { decodePersistedWalletSettings } from '@/lib/wallet-settings-storage'

export function parseZeroIndexerEnabled(raw: unknown): boolean {
  const state = decodePersistedWalletSettings(raw)
  return state?.zeroIndexerEnabled !== false
}
