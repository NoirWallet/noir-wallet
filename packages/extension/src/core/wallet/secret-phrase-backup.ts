import type { WalletItem } from '@/types'

const LEGACY_CREATION_START = Date.parse('2026-09-24T00:00:00+08:00')

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function getWalletsNeedingSecretPhraseBackup(wallets: WalletItem[]): WalletItem[] {
  return wallets
    .filter(wallet => {
      // Older records have no creation revision, so only the known generated flow is inferable.
      if (
        !Number.isSafeInteger(wallet.createdAt) ||
        wallet.createdAt < LEGACY_CREATION_START ||
        (wallet.keySource !== undefined && wallet.keySource !== 'software') ||
        !/^Wallet \d{13}$/.test(wallet.name) ||
        isPositiveSafeInteger(wallet.secretPhraseCreationRevision) ||
        isPositiveSafeInteger(wallet.secretPhraseBackupVerifiedAt)
      ) {
        return false
      }

      const primary = wallet.accounts.filter(account => account.derivationIndex === 0)
      return primary.length === 1 && primary[0].name === 'Account 1'
    })
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}
