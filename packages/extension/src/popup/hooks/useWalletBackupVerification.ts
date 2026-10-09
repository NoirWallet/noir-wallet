import { useCallback, useEffect, useRef, useState } from 'react'
import { accountManager, type WalletBackupVerification } from '@/core/wallet/account-manager'
import { didWalletSessionEnd } from '@/core/wallet/session-state'
import { classifyError } from '@/lib/errors'
import { useWalletStore } from '@/store/wallet-store'

export function useWalletBackupVerification(walletId: string | null) {
  const walletExists = useWalletStore(state => Boolean(walletId && state.getWallet(walletId)))
  const [wordIndices, setWordIndices] = useState<[number, number] | null>(null)
  const [words, setWords] = useState<[string, string]>(['', ''])
  const [error, setError] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mounted = useRef(false)
  const version = useRef(0)
  const submitting = useRef(false)
  const sessionEnded = useRef(false)

  const reset = useCallback(() => {
    version.current += 1
    setWordIndices(null)
    setWords(['', ''])
    setError('')
    setIsPreparing(false)
    setIsSubmitting(false)
  }, [])

  const isCurrent = useCallback(
    (requestVersion: number) =>
      mounted.current &&
      !sessionEnded.current &&
      requestVersion === version.current &&
      !accountManager.isLocked(),
    []
  )

  useEffect(() => {
    mounted.current = true
    sessionEnded.current = false
    reset()
    const handleSessionChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (!didWalletSessionEnd(changes, areaName)) return
      sessionEnded.current = true
      reset()
    }
    chrome.storage.onChanged.addListener(handleSessionChange)
    return () => {
      mounted.current = false
      version.current += 1
      chrome.storage.onChanged.removeListener(handleSessionChange)
    }
  }, [walletId, reset])

  useEffect(() => {
    if (!walletExists) reset()
  }, [walletExists, reset])

  const prepare = useCallback(async () => {
    if (!walletId || submitting.current || sessionEnded.current || accountManager.isLocked())
      return false
    reset()
    const requestVersion = version.current
    setIsPreparing(true)
    try {
      const indices = await accountManager.getWalletBackupWordIndices(walletId)
      if (!isCurrent(requestVersion)) return false
      setWordIndices(indices)
      return true
    } catch (cause) {
      if (isCurrent(requestVersion)) setError(classifyError(cause).userMessage)
      return false
    } finally {
      if (isCurrent(requestVersion)) setIsPreparing(false)
    }
  }, [walletId, reset, isCurrent])

  const setWord = (position: number, value: string) => {
    if (submitting.current || (position !== 0 && position !== 1)) return
    setWords(current => {
      const next: [string, string] = [...current]
      next[position] = value
      return next
    })
    setError('')
  }

  const canSubmit = Boolean(
    walletId && wordIndices && words.every(word => word.trim()) && !isPreparing && !isSubmitting
  )

  const submit = async (action: (verification: WalletBackupVerification) => Promise<void>) => {
    const requestVersion = version.current
    if (
      !canSubmit ||
      !wordIndices ||
      submitting.current ||
      !isCurrent(requestVersion) ||
      !walletId ||
      !useWalletStore.getState().getWallet(walletId)
    )
      return
    submitting.current = true
    setIsSubmitting(true)
    setError('')
    try {
      await action({ wordIndices, words: [words[0].trim(), words[1].trim()] })
    } catch (cause) {
      if (isCurrent(requestVersion)) setError(classifyError(cause).userMessage)
    } finally {
      submitting.current = false
      if (isCurrent(requestVersion)) setIsSubmitting(false)
    }
  }

  return {
    wordIndices,
    words,
    error,
    isPreparing,
    isSubmitting,
    canSubmit,
    prepare,
    reset,
    setWord,
    submit
  }
}
