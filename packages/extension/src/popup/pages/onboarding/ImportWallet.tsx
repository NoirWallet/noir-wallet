import { useMemo, useState, useRef, KeyboardEvent } from 'react'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { useNavigate } from '../../provider/Router'
import { useOnboardingStore } from '@/store/onboarding-store'
import { validateEnglishMnemonicWords } from '@/core/wallet/mnemonic-validation'
import { useOnboardingTranslation } from '@/popup/components/onboarding/useOnboardingTranslation'

type ValidationError = 'exactWordCount' | 'invalidEnglishWords' | 'invalidChecksum'

export function ImportWallet() {
  const { t, errorText } = useOnboardingTranslation()
  const { navigate } = useNavigate()
  const {
    mnemonicWordCount,
    importedSeedPhrase,
    setImportedSeedPhrase,
    setBirthdayHeight,
    setImportZcashHistorySelection,
    setSelectedNetworkFamilies,
    error
  } = useOnboardingStore()

  const [words, setWords] = useState<string[]>(() => {
    const importedWords = importedSeedPhrase.trim().split(/\s+/).filter(Boolean)
    return importedWords.length === mnemonicWordCount
      ? importedWords
      : Array(mnemonicWordCount).fill('')
  })
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  const [validationError, setValidationError] = useState<ValidationError | null>(null)
  const mnemonicValidation = useMemo(
    () => validateEnglishMnemonicWords(words, mnemonicWordCount),
    [mnemonicWordCount, words]
  )
  const invalidWordIndexes = useMemo(
    () => new Set(mnemonicValidation.invalidWordIndexes),
    [mnemonicValidation.invalidWordIndexes]
  )
  const handleWordChange = (index: number, value: string) => {
    setValidationError(null)
    setImportedSeedPhrase('')

    if (value.includes(' ')) {
      const pastedWords = value.trim() ? value.trim().split(/\s+/) : []
      if (index + pastedWords.length > mnemonicWordCount) {
        setValidationError('exactWordCount')
        return
      }
      const newWordsFromPaste = [...words]
      pastedWords.forEach((word, i) => {
        newWordsFromPaste[index + i] = word.toLowerCase()
      })
      setWords(newWordsFromPaste)

      const nextIndex = Math.min(index + pastedWords.length, mnemonicWordCount - 1)
      inputRefs.current[nextIndex]?.focus()
      return
    }

    const newWords = [...words]
    newWords[index] = value.trim().toLowerCase()
    setWords(newWords)
  }

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !words[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
    if (e.key === ' ' && words[index] && index < mnemonicWordCount - 1) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  const handleContinue = async () => {
    if (mnemonicValidation.invalidWordIndexes.length > 0) {
      setValidationError('invalidEnglishWords')
      return
    }

    if (!mnemonicValidation.isValid) {
      setValidationError('invalidChecksum')
      return
    }

    const seedPhrase = mnemonicValidation.phrase
    if (seedPhrase) {
      setImportedSeedPhrase(seedPhrase)
      setBirthdayHeight(undefined)
      setImportZcashHistorySelection(null)
      setSelectedNetworkFamilies(null)
      navigate('/onboarding/import-accounts')
    }
  }

  const isAllFilled = words.every(word => word.trim() !== '')
  const message = validationError
    ? t(validationError, { count: mnemonicWordCount })
    : error && errorText(error, 'importFailed')

  return (
    <div className="page-container">
      <PageHeader title={t('importPhrase')} showBack />
      <div className="page-content px-5 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <span>{t('enterPhrase', { count: mnemonicWordCount })}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {words.map((word, index) => (
            <div key={index}>
              <Input
                ref={el => {
                  inputRefs.current[index] = el
                }}
                type="text"
                value={word}
                onChange={e => handleWordChange(index, e.target.value)}
                onKeyDown={e => handleKeyDown(index, e)}
                aria-label={t('wordNumber', { number: index + 1 })}
                aria-invalid={invalidWordIndexes.has(index)}
                placeholder=""
                className="w-full h-[52px] text-sm rounded-xl px-3 pl-8"
                startContent={<span className="text-sm text-muted">{index + 1}.</span>}
                classNames={{
                  startContent: 'left-3'
                }}
              />
            </div>
          ))}
        </div>
        {message && (
          <p role="alert" className="text-sm text-destructive mb-4">
            {message}
          </p>
        )}
      </div>
      <div className="page-footer">
        <Button onClick={handleContinue} disabled={!isAllFilled} className="w-full h-[45px]">
          {t('continue')}
        </Button>
      </div>
    </div>
  )
}
