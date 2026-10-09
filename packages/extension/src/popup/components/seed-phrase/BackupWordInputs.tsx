import { useId } from 'react'
import { Input } from '../ui/input'
import type { useWalletBackupVerification } from '../../hooks/useWalletBackupVerification'

type VerificationFields = Pick<
  ReturnType<typeof useWalletBackupVerification>,
  'wordIndices' | 'words' | 'error' | 'isPreparing' | 'isSubmitting' | 'setWord'
>

export function BackupWordInputs({ verification }: { verification: VerificationFields }) {
  const id = useId()
  const { wordIndices, words, error, isPreparing, isSubmitting, setWord } = verification
  const errorId = `${id}-error`

  return (
    <div className="space-y-4">
      {isPreparing && (
        <p role="status" className="text-sm text-muted">
          Preparing confirmation...
        </p>
      )}
      {wordIndices && (
        <div className="grid grid-cols-2 gap-3">
          {wordIndices.map((index, position) => (
            <div key={index}>
              <label htmlFor={`${id}-${position}`} className="block text-sm text-muted mb-2">
                Word #{index + 1}
              </label>
              <Input
                id={`${id}-${position}`}
                type="password"
                value={words[position]}
                onChange={event => setWord(position, event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={isSubmitting}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="h-[46px] rounded-xl"
              />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
