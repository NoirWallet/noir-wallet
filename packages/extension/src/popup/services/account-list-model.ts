import type { AccountPortfolioValueSnapshot } from '@/core/wallet/account-portfolio-value'
import { matchesAccountSearch } from '@/lib/account-search'
import { safeBig } from '@/lib/big'
import { formatWalletName, getAccountDisplayName } from '@/lib/format'
import { buildAccountKey } from '@/store/account-data-store'
import type { AddressType, WalletItem, ZcashBalance } from '@/types'
import type { AccountNetworksCatalogView } from './account-networks-client'

export interface AccountListItem {
  readonly id: string
  readonly name: string
  readonly addresses: readonly Readonly<{ type: AddressType; address: string }>[]
  readonly isPinned: boolean
  readonly isHidden: boolean
  readonly walletId: string
  readonly walletName: string
}

export function accountListKey(walletId: string, accountId: string): string {
  return `${walletId}:${accountId}`
}

export function resolveAccountPortfolioValue(
  walletId: string,
  accountId: string,
  network: 'mainnet' | 'testnet',
  portfolioValues: ReadonlyMap<string, AccountPortfolioValueSnapshot>,
  zcashBalances: ReadonlyMap<string, ZcashBalance>,
  zecPrice: number
): AccountPortfolioValueSnapshot | null {
  const key = buildAccountKey(network, walletId, accountId)
  const snapshot = portfolioValues.get(key)
  if (snapshot) return snapshot
  const balance = zcashBalances.get(key)
  if (!balance || zecPrice <= 0) return null
  return Object.freeze({
    totalUsd: safeBig(balance.total).times(zecPrice).toFixed(),
    updatedAt: 0,
    complete: false
  })
}

export function buildVisibleAccountList(input: {
  readonly wallets: WalletItem[]
  readonly accountDisplayNames: Record<string, string>
  readonly nativeAccounts: AccountNetworksCatalogView['accounts']
  readonly searchQuery: string
}): Readonly<{
  filteredAccounts: readonly AccountListItem[]
  filteredAccountKeys: ReadonlySet<string>
  pinnedAccounts: readonly AccountListItem[]
  hiddenAccounts: readonly AccountListItem[]
  nativeAccounts: AccountNetworksCatalogView['accounts']
}> {
  const accounts: AccountListItem[] = input.wallets.flatMap(wallet =>
    wallet.accounts.map(account => ({
      id: account.id,
      name: getAccountDisplayName(wallet.id, account.id, account.name, input.accountDisplayNames),
      addresses: Object.freeze([
        { type: 'shielded' as const, address: account.addresses.shielded },
        { type: 'transparent' as const, address: account.addresses.transparent }
      ]),
      isPinned: account.isPinned || false,
      isHidden: account.isHidden || false,
      walletId: wallet.id,
      walletName: formatWalletName(wallet, input.wallets)
    }))
  )
  const filteredAccounts = accounts.filter(account =>
    matchesAccountSearch(account, input.searchQuery)
  )
  const sortedAccounts = [...filteredAccounts].sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1
    if (left.isHidden !== right.isHidden) return left.isHidden ? 1 : -1
    return 0
  })
  const retainedAccountKeys = new Set(
    accounts.map(account => accountListKey(account.walletId, account.id))
  )
  const query = input.searchQuery.trim().toLowerCase()
  const nativeAccounts = input.nativeAccounts.filter(account => {
    if (retainedAccountKeys.has(accountListKey(account.walletId, account.accountId))) return false
    return (
      !query ||
      account.accountDisplayName.toLowerCase().includes(query) ||
      account.walletDisplayName.toLowerCase().includes(query) ||
      account.networks.some(network => network.chain.displayName.toLowerCase().includes(query))
    )
  })
  return Object.freeze({
    filteredAccounts: Object.freeze(filteredAccounts),
    filteredAccountKeys: new Set(
      filteredAccounts.map(account => accountListKey(account.walletId, account.id))
    ),
    pinnedAccounts: Object.freeze(
      sortedAccounts.filter(account => account.isPinned && !account.isHidden)
    ),
    hiddenAccounts: Object.freeze(sortedAccounts.filter(account => account.isHidden)),
    nativeAccounts: Object.freeze(nativeAccounts)
  })
}
