import { useCallback, useEffect, useState } from 'react'
import { accountManager } from '@/core/wallet/account-manager'
import { classifyError } from '@/lib/errors'
import type { ShieldedReceiveAddress } from '@/types'
import { useWalletStore } from '@/store/wallet-store'

const EMPTY_HISTORY: ShieldedReceiveAddress[] = []

interface UseShieldedAddressActionsOptions {
  walletId?: string | null
  accountId?: string | null
}

export function useShieldedAddressActions({
  walletId,
  accountId
}: UseShieldedAddressActionsOptions) {
  const cachedHistory = useWalletStore(state => {
    if (!walletId || !accountId) return EMPTY_HISTORY
    const wallet = state.wallets.find(item => item.id === walletId)
    const account = wallet?.accounts.find(item => item.id === accountId)
    return Array.isArray(account?.shieldedAddressHistory)
      ? account.shieldedAddressHistory
      : EMPTY_HISTORY
  })
  const [isRotating, setIsRotating] = useState(false)
  const [rotateError, setRotateError] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ShieldedReceiveAddress[]>(cachedHistory)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectingAddress, setSelectingAddress] = useState<string | null>(null)
  const isLocked = accountManager.isLocked()

  useEffect(() => {
    setHistory(cachedHistory)
  }, [cachedHistory])

  const rotateShieldedAddress = useCallback(async () => {
    if (isLocked || isRotating || !walletId || !accountId) return

    setRotateError(null)
    setIsRotating(true)
    try {
      await accountManager.rotateShieldedReceiveAddress(walletId, accountId)
    } catch (error) {
      setRotateError(classifyError(error).userMessage)
    } finally {
      setIsRotating(false)
    }
  }, [accountId, isLocked, isRotating, walletId])

  const loadHistory = useCallback(async () => {
    if (!walletId || !accountId) return
    setHistoryError(null)
    setHistoryLoading(true)
    try {
      setHistory(await accountManager.getShieldedReceiveAddresses(walletId, accountId))
    } catch (error) {
      setHistoryError(classifyError(error).userMessage)
    } finally {
      setHistoryLoading(false)
    }
  }, [accountId, walletId])

  useEffect(() => {
    if (historyOpen) void loadHistory()
  }, [historyOpen, loadHistory])

  const selectHistoryAddress = useCallback(
    async (address: string) => {
      if (!walletId || !accountId) return
      setHistoryError(null)
      setSelectingAddress(address)
      try {
        await accountManager.setShieldedReceiveAddress(address, walletId, accountId)
        setHistoryOpen(false)
      } catch (error) {
        setHistoryError(classifyError(error).userMessage)
      } finally {
        setSelectingAddress(null)
      }
    },
    [accountId, walletId]
  )

  return {
    canRotate: !isLocked && !isRotating,
    history,
    historyError,
    historyLoading,
    historyOpen,
    isLocked,
    isRotating,
    loadHistory,
    rotateError,
    rotateShieldedAddress,
    selectHistoryAddress,
    selectingAddress,
    setHistoryOpen
  }
}
