import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createChromeStorageAdapter } from '@/lib/chrome-storage-adapter'
import type { AddressType } from '@/types'

const MAX_RECENT_ADDRESSES = 5

interface SwapPreferences {
  slippage: number
  addressType: AddressType
  recentRefundAddresses: Record<string, string[]>
  recentRecipientAddresses: Record<string, string[]>
  savedTokenInId: string | null
  savedTokenOutId: string | null

  setSlippage: (slippage: number) => void
  setAddressType: (type: AddressType) => void
  addRecentRefundAddress: (chain: string, address: string) => void
  addRecentRecipientAddress: (chain: string, address: string) => void
  getRecentRefundAddresses: (chain: string) => string[]
  getRecentRecipientAddresses: (chain: string) => string[]
  setSavedTokenInId: (id: string | null) => void
  setSavedTokenOutId: (id: string | null) => void
}

function addToRecent(
  record: Record<string, string[]>,
  chain: string,
  address: string
): Record<string, string[]> {
  const list = record[chain] || []
  const filtered = list.filter(a => a !== address)
  return {
    ...record,
    [chain]: [address, ...filtered].slice(0, MAX_RECENT_ADDRESSES)
  }
}

export const useSwapPreferences = create<SwapPreferences>()(
  persist(
    (set, get) => ({
      slippage: 1,
      addressType: 'shielded',
      recentRefundAddresses: {},
      recentRecipientAddresses: {},
      savedTokenInId: null,
      savedTokenOutId: null,

      setSlippage: slippage => set({ slippage }),
      setAddressType: type => set({ addressType: type }),
      setSavedTokenInId: id => set({ savedTokenInId: id }),
      setSavedTokenOutId: id => set({ savedTokenOutId: id }),

      addRecentRefundAddress: (chain, address) => {
        if (!address.trim()) return
        set({ recentRefundAddresses: addToRecent(get().recentRefundAddresses, chain, address) })
      },

      addRecentRecipientAddress: (chain, address) => {
        if (!address.trim()) return
        set({
          recentRecipientAddresses: addToRecent(get().recentRecipientAddresses, chain, address)
        })
      },

      getRecentRefundAddresses: chain => get().recentRefundAddresses[chain] || [],
      getRecentRecipientAddresses: chain => get().recentRecipientAddresses[chain] || []
    }),
    {
      name: 'swap_preferences',
      storage: createChromeStorageAdapter('local') as any,
      partialize: (state: SwapPreferences) => ({
        slippage: state.slippage,
        addressType: state.addressType,
        recentRefundAddresses: state.recentRefundAddresses,
        recentRecipientAddresses: state.recentRecipientAddresses,
        savedTokenInId: state.savedTokenInId,
        savedTokenOutId: state.savedTokenOutId
      })
    }
  )
)
