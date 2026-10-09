import { useEffect } from 'react'
import { Button } from '../ui/button'
import { BackupWordInputs } from '../seed-phrase/BackupWordInputs'
import { useWalletBackupVerification } from '../../hooks/useWalletBackupVerification'
import type { WalletBackupVerification } from '@/core/wallet/account-manager'

interface RemoveWalletContentProps {
  walletId: string
  onRemove: (verification: WalletBackupVerification) => Promise<void>
  onCancel: () => void
  onViewBackup: () => void
}

export function RemoveWalletContent({
  walletId,
  onRemove,
  onCancel,
  onViewBackup
}: RemoveWalletContentProps) {
  const verification = useWalletBackupVerification(walletId)
  const { prepare, isSubmitting } = verification

  useEffect(() => {
    void prepare()
  }, [prepare])

  const handleRemove = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await verification.submit(onRemove)
  }

  return (
    <form onSubmit={handleRemove} className="space-y-4" autoComplete="off">
      <p className="text-sm text-muted">
        Enter these words from your saved backup to remove this wallet.{' '}
        <Button
          type="button"
          variant="link"
          onClick={onViewBackup}
          disabled={isSubmitting}
          className="inline h-auto p-0 text-sm"
        >
          View secret phrase
        </Button>
      </p>

      <BackupWordInputs verification={verification} />

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="flex-1 h-[45px]"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={!verification.canSubmit}
          isLoading={isSubmitting}
          className="flex-1 h-[45px]"
        >
          Remove
        </Button>
      </div>
    </form>
  )
}
