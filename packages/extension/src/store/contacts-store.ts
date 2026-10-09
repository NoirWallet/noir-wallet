import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createChromeStorageAdapter } from '@/lib/chrome-storage-adapter'

export interface Contact {
  address: string
  name: string
  addedAt: number
  znsName?: string
}

interface ContactsStore {
  contacts: Contact[]
  addContact: (address: string, name: string, znsName?: string) => void
  removeContact: (address: string) => void
  getContact: (address: string) => Contact | undefined
}

export const CONTACTS_STORAGE_KEY = 'wallet_contacts'

export const useContactsStore = create<ContactsStore>()(
  persist(
    (set, get) => ({
      contacts: [],

      addContact: (address, name, znsName?) => {
        const existing = get().contacts
        const filtered = existing.filter(c => c.address !== address)
        set({ contacts: [...filtered, { address, name, addedAt: Date.now(), znsName }] })
      },

      removeContact: address => {
        set({ contacts: get().contacts.filter(c => c.address !== address) })
      },

      getContact: address => {
        return get().contacts.find(c => c.address === address)
      }
    }),
    {
      name: CONTACTS_STORAGE_KEY,
      storage: createChromeStorageAdapter('local') as any,
      partialize: state => ({
        contacts: state.contacts
      })
    }
  )
)
