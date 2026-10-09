import { Icon } from '@iconify/react'
import {
  formatSortAddress,
  formatAccountName,
  formatWalletName,
  getAccountDisplayName
} from '@/lib/format'
import { AddressTypeLabel } from '../account/AddressType'
import { useEffect, useState } from 'react'
import { accountManager } from '@/core/wallet/account-manager'
import { useWalletStore } from '@/store/wallet-store'
import { useContactsStore, type Contact } from '@/store/contacts-store'
import type { WalletItem, AddressType } from '@/types'

interface AccountGroup {
  accountId: string
  accountName: string
  walletName: string
  isCurrent: boolean
  addresses: {
    type: AddressType
    address: string
  }[]
}

interface MyAddressSelectorProps {
  currentAccountId?: string
  excludeAddresses?: string[]
  onSelect: (address: string) => void
}

export function MyAddressSelector({
  currentAccountId,
  excludeAddresses = [],
  onSelect
}: MyAddressSelectorProps) {
  const [wallets, setWallets] = useState<WalletItem[]>([])
  const [loading, setLoading] = useState(true)
  const { accountDisplayNames } = useWalletStore()
  const { contacts, removeContact } = useContactsStore()

  useEffect(() => {
    loadWallets()
  }, [])

  const loadWallets = async () => {
    try {
      const allWallets = await accountManager.getAllWallets()
      setWallets(allWallets)
    } catch (error) {
      console.error('Failed to load wallets:', error)
    } finally {
      setLoading(false)
    }
  }

  const excluded = new Set(excludeAddresses.filter(Boolean))
  const visibleContacts = contacts.filter((contact: Contact) => !excluded.has(contact.address))

  const accountGroups: AccountGroup[] = wallets.flatMap(wallet =>
    wallet.accounts
      .filter(account => !account.isHidden)
      .map(account => {
        const displayName = getAccountDisplayName(
          wallet.id,
          account.id,
          account.name,
          accountDisplayNames
        )

        return {
          accountId: account.id,
          accountName: displayName,
          walletName: formatWalletName(wallet, wallets),
          isCurrent: account.id === currentAccountId,
          addresses: [
            { type: 'shielded' as AddressType, address: account.addresses.shielded },
            { type: 'transparent' as AddressType, address: account.addresses.transparent }
          ].filter(addr => !excluded.has(addr.address))
        }
      })
      .filter(group => group.addresses.length > 0)
  )

  const handleRemoveContact = (e: React.MouseEvent, address: string) => {
    e.stopPropagation()
    removeContact(address)
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-muted">
        <Icon icon="lucide:loader-2" className="animate-spin mx-auto mb-2" width={24} height={24} />
        Loading addresses...
      </div>
    )
  }

  return (
    <div className="py-2 px-6 -mx-6 max-h-[400px] overflow-y-auto">
      <div className="space-y-5">
        {visibleContacts.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Icon icon="lucide:bookmark" width={14} height={14} className="text-primary" />
              <span className="text-xs font-medium text-muted uppercase tracking-wider">
                Saved Contacts
              </span>
            </div>
            <div className="space-y-2">
              {visibleContacts.map((contact: Contact) => (
                <button
                  key={contact.address}
                  onClick={() => onSelect(contact.address)}
                  className="w-full p-2.5 rounded-lg transition-colors cursor-pointer bg-card hover:bg-white/5 border border-transparent hover:border-primary/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-left truncate">{contact.name}</p>
                      {contact.znsName && (
                        <p className="text-xs text-primary text-left">{contact.znsName}</p>
                      )}
                      <p className="font-mono text-xs text-muted text-left">
                        {formatSortAddress(contact.address)}
                      </p>
                    </div>
                    <button
                      onClick={e => handleRemoveContact(e, contact.address)}
                      className="p-1.5 text-muted hover:text-danger rounded-md hover:bg-danger/10 transition-colors shrink-0"
                      title="Remove contact"
                    >
                      <Icon icon="lucide:x" width={14} height={14} />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleContacts.length > 0 && accountGroups.length > 0 && (
          <div className="border-t border-border" />
        )}

        {accountGroups.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Icon icon="lucide:wallet" width={14} height={14} className="text-muted" />
              <span className="text-xs font-medium text-muted uppercase tracking-wider">
                My Wallets
              </span>
            </div>
            <div className="space-y-5">
              {accountGroups.map(group => (
                <div key={group.accountId}>
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <span className="text-sm font-medium truncate">
                      {formatAccountName(group.accountName, 20)}
                    </span>
                    {group.isCurrent && (
                      <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                        Current
                      </span>
                    )}
                    <span className="text-xs text-muted ml-auto">{group.walletName}</span>
                  </div>
                  <div className="space-y-2">
                    {group.addresses.map(addr => (
                      <button
                        key={`${group.accountId}-${addr.type}`}
                        onClick={() => onSelect(addr.address)}
                        className="w-full p-2.5 rounded-lg transition-colors cursor-pointer bg-card hover:bg-white/5 border border-transparent hover:border-primary/20"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <AddressTypeLabel type={addr.type} />
                            <p className="font-mono text-xs text-muted break-all">
                              {formatSortAddress(addr.address)}
                            </p>
                          </div>
                          <Icon
                            icon="lucide:arrow-right"
                            width={14}
                            height={14}
                            className="text-muted shrink-0 mt-1"
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
