import { Icon } from '@iconify/react'
import { getWalletsNeedingSecretPhraseBackup } from '@/core/wallet/secret-phrase-backup'
import { formatWalletBackupName } from '@/lib/format'
import { useWalletStore } from '@/store/wallet-store'
import { useNavigate } from '../../provider/Router'

export function SecretPhraseBackupBanner() {
  const wallets = useWalletStore(state => state.wallets)
  const displayNames = useWalletStore(state => state.accountDisplayNames)
  const { navigate } = useNavigate()
  const pending = getWalletsNeedingSecretPhraseBackup(wallets)
  const wallet = pending[0]

  if (!wallet) return null

  const remaining = pending.length - 1

  return (
    <aside className="secret-phrase-backup-banner" aria-label="Secret phrase backup reminder">
      <Icon icon="lucide:triangle-alert" width={18} height={18} className="shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-4 text-white break-words">
          Your wallet {formatWalletBackupName(wallet, wallets, displayNames)} hasn’t backed up its
          Secret Phrase yet. Please do so soon.
        </p>
        {remaining > 0 && (
          <p className="mt-1 text-xs text-white/60">
            {remaining} more {remaining === 1 ? 'wallet' : 'wallets'} to back up
          </p>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 self-center rounded bg-warning px-2.5 py-1.5 text-xs font-medium text-black hover:bg-warning/90"
        onClick={() =>
          navigate(`/view-seed-phrase?walletId=${encodeURIComponent(wallet.id)}&backup=1`, {
            state: { fromBackupBanner: true }
          })
        }
      >
        Back up
      </button>
    </aside>
  )
}
