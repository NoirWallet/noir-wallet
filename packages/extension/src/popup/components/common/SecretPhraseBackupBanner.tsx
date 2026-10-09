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

  return (
    <aside
      aria-label="Secret phrase backup reminder"
      className="flex shrink-0 items-center gap-3 border-b border-warning/25 bg-warning/10 px-3 py-2"
    >
      <Icon icon="lucide:triangle-alert" width={18} height={18} className="shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-xs leading-4 text-foreground">
          Back up the secret phrase for {formatWalletBackupName(wallet, wallets, displayNames)}.
        </p>
        {pending.length > 1 && (
          <p className="text-xs text-muted">{pending.length - 1} more to back up</p>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 rounded bg-warning px-2 py-1.5 text-xs font-medium text-warning-foreground"
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
