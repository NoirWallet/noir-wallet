import type { AddressBookContact } from '@/core/address-book/address-book'
import type {
  AccountNetworkAddressView,
  AccountNetworksCatalogView
} from '@/popup/services/account-networks-client'

export interface MyAccountRecipientAddress extends AccountNetworkAddressView {
  readonly executionMode?: 'main' | 'private'
}

export interface MyAccountRecipientGroup {
  readonly key: string
  readonly walletId: string
  readonly accountId: string
  readonly walletDisplayName: string
  readonly accountDisplayName: string
  readonly active: boolean
  readonly addresses: readonly MyAccountRecipientAddress[]
}

function normalizedAddress(chainId: string, address: string): string {
  return chainId.startsWith('eip155:') ? address.toLowerCase() : address
}

export function buildMyAccountRecipientGroups(
  catalog: AccountNetworksCatalogView | null,
  chainId: string,
  excludeAddresses: readonly string[] = []
): readonly MyAccountRecipientGroup[] {
  if (!catalog) return Object.freeze([])

  const excluded = new Set(excludeAddresses.map(address => normalizedAddress(chainId, address)))
  const seen = new Set<string>()
  const groups: MyAccountRecipientGroup[] = []

  for (const account of catalog.accounts) {
    const network = account.networks.find(candidate => candidate.chain.id === chainId)
    if (!network) continue

    const isZcash = network.chain.family === 'zcash'
    const isEvm = network.chain.family === 'evm'
    if (account.active && !isZcash && !isEvm) continue

    const receiveAddresses = isZcash
      ? network.addresses
      : [
          network.addresses.find(address => address.preferredForReceive) ?? network.addresses[0]
        ].filter((address): address is AccountNetworkAddressView => address !== undefined)
    const candidates: readonly MyAccountRecipientAddress[] = isEvm
      ? [
          ...receiveAddresses.map(address => ({ ...address, executionMode: 'main' as const })),
          ...(network.privateExecutionAddress
            ? [
                {
                  value: network.privateExecutionAddress,
                  scheme: 'evm',
                  privacy: 'transparent' as const,
                  preferredForReceive: false,
                  executionMode: 'private' as const
                }
              ]
            : [])
        ]
      : receiveAddresses
    const addresses = candidates.filter(address => {
      const normalized = normalizedAddress(chainId, address.value)
      if (excluded.has(normalized) || seen.has(normalized)) return false
      seen.add(normalized)
      return true
    })
    if (addresses.length === 0) continue

    groups.push(
      Object.freeze({
        key: `${account.walletId}:${account.accountId}`,
        walletId: account.walletId,
        accountId: account.accountId,
        walletDisplayName: account.walletDisplayName,
        accountDisplayName: account.accountDisplayName,
        active: account.active,
        addresses: Object.freeze(addresses)
      })
    )
  }

  return Object.freeze(
    groups
      .map((group, index) => ({ group, index }))
      .sort(
        (left, right) =>
          Number(right.group.active) - Number(left.group.active) || left.index - right.index
      )
      .map(entry => entry.group)
  )
}

export function buildSavedRecipientList(
  contacts: readonly AddressBookContact[],
  chainId: string,
  excludeAddresses: readonly string[] = []
): readonly AddressBookContact[] {
  const excluded = new Set(excludeAddresses.map(address => normalizedAddress(chainId, address)))
  return Object.freeze(
    contacts
      .filter(
        contact =>
          contact.chainId === chainId && !excluded.has(normalizedAddress(chainId, contact.address))
      )
      .sort((left, right) => left.name.localeCompare(right.name))
  )
}
