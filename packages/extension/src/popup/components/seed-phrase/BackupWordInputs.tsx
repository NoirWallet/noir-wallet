import { Input } from '../ui/input'
import type { useWalletBackupVerification } from '@/popup/hooks/useWalletBackupVerification'

export function BackupWordInputs({
  verification
}: {
  verification: ReturnType<typeof useWalletBackupVerification>
}) {
  if (verification.isPreparing)
    return <p className="text-sm text-muted">Preparing backup check...</p>
  if (!verification.wordIndices) {
    return verification.error ? (
      <p role="alert" className="text-sm text-danger">
        {verification.error}
      </p>
    ) : null
  }
  return (
    <div className="space-y-4">
      {verification.wordIndices.map((wordIndex, position) => (
        <label key={wordIndex} className="block text-sm text-muted">
          Word {wordIndex + 1}
          <Input
            value={verification.words[position]}
            onChange={event => verification.setWord(position, event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="mt-2 h-[46px]"
          />
        </label>
      ))}
      {verification.error && (
        <p role="alert" className="text-sm text-danger">
          {verification.error}
        </p>
      )}
    </div>
  )
}
