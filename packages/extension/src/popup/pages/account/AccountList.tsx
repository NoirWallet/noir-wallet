import { useState, useEffect } from 'react'
import { Icon } from '@iconify/react'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/common/PageHeader'
import { RenameAccountContent } from '../../components/account/AccountModals'
import { Input } from '../../components/ui/input'
import { openModal } from '../../provider/ModalManager'
import { accountManager } from '@/core/wallet/account-manager'
import { useNavigate } from '../../provider/Router'
import { useDialog } from '../../hooks/useDialog'
import { openHardwareConnectTab } from '@/lib/hardware-tab'
import { ANALYTICS_EVENTS, PAGE_IDS, sendAnalyticsEvent } from '@/lib/analytics'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useWalletStore } from '@/store/wallet-store'
import { useAccountDataStore } from '@/store/account-data-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  formatAccountName,
  formatNumber,
  formatPrice,
  formatWalletName,
  getAccountDisplayName
} from '@/lib/format'
import Big from '@/lib/big'
import type { AccountData, WalletItem, AddressType, ZcashBalance } from '@/types'
import { matchesAccountSearch } from '@/lib/account-search'
import { isHardwareKeySource } from '@/lib/hardware-capabilities'

interface Account {
  id: string
  name: string
  balance: string
  balanceUsd: string
  addresses: {
    type: AddressType
    address: string
  }[]
  isPinned: boolean
  isHidden: boolean
  walletId: string
  walletName: string
}

export function AccountList() {
  const { navigate, replace } = useNavigate()
  const { confirm } = useDialog()
  const [searchQuery, setSearchQuery] = useState('')
  const { wallets, accountDisplayNames } = useWalletStore()
  const { enableDerivedAccounts } = useSettingsStore()
  const [loading, setLoading] = useState(true)
  const [accountBalances, setAccountBalances] = useState<Map<string, ZcashBalance>>(new Map())

  useEffect(() => {
    loadWallets()
  }, [])

  useEffect(() => {
    const listener = (message: any) => {
      if (message.type === 'SYNC_PROGRESS') {
        loadWallets()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const loadWallets = async () => {
    try {
      const allWallets = accountManager.getAllWallets()

      const balanceMap = new Map<string, ZcashBalance>()
      for (const wallet of allWallets) {
        const walletBalances = await accountManager.loadAllAccountBalances(wallet.id)
        walletBalances.forEach((balance, accountId) => {
          balanceMap.set(accountId, balance)
        })
      }
      setAccountBalances(balanceMap)
    } catch (error) {
      console.error('Failed to load wallets:', error)
    } finally {
      setLoading(false)
    }
  }

  const accounts: Account[] = wallets.flatMap(wallet =>
    wallet.accounts.map(account => {
      const balance = accountBalances.get(account.id)
      const totalBalance = balance?.total ?? '0'
      const totalUsd = useAccountDataStore.getState().getBalanceUsd(wallet.id, account.id)

      const displayName = getAccountDisplayName(
        wallet.id,
        account.id,
        account.name,
        accountDisplayNames
      )

      return {
        id: account.id,
        name: displayName,
        balance: balance ? `${formatNumber(totalBalance, { rm: Big.roundDown })} ZEC` : '0 ZEC',
        balanceUsd: totalUsd > 0 ? formatPrice(totalUsd, { showSign: true }) : '$0',
        addresses: [
          { type: 'shielded' as const, address: account.addresses.shielded },
          { type: 'transparent' as const, address: account.addresses.transparent }
        ],
        isPinned: account.isPinned || false,
        isHidden: account.isHidden || false,
        walletId: wallet.id,
        walletName: formatWalletName(wallet, wallets)
      }
    })
  )

  const accountBalanceMap = new Map(
    accounts.map(acc => [acc.id, { balance: acc.balance, balanceUsd: acc.balanceUsd }])
  )

  const filteredAccounts = accounts.filter(account => matchesAccountSearch(account, searchQuery))
  const filteredAccountKeys = new Set(
    filteredAccounts.map(account => `${account.walletId}:${account.id}`)
  )

  const sortedAccounts = [...filteredAccounts].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1
    }
    if (a.isHidden !== b.isHidden) {
      return a.isHidden ? 1 : -1
    }
    return 0
  })

  const pinnedAccounts = sortedAccounts.filter(acc => acc.isPinned && !acc.isHidden)
  const hiddenAccounts = sortedAccounts.filter(acc => acc.isHidden)

  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null)
  const [addingWalletId, setAddingWalletId] = useState<string | null>(null)

  const handleAccountSelect = async (accountId: string, walletId: string) => {
    try {
      const currentAccount = useWalletStore.getState().getCurrentAccount()
      const { currentWalletId } = useWalletStore.getState()

      if (currentAccount?.id === accountId && currentWalletId === walletId) {
        replace('/')
        return
      }

      setSwitchingAccountId(accountId)

      const isCrossWalletSwitch = currentWalletId && currentWalletId !== walletId
      const syncState = isCrossWalletSwitch
        ? await chrome.runtime.sendMessage({
            type: 'GET_SYNC_STATE',
            walletId: currentWalletId,
            accountId: currentAccount?.id
          })
        : null

      if (syncState?.isSyncing) {
        const progress = syncState.syncProgress || 0
        if (progress >= 95) {
          const waitForSync = () =>
            new Promise<void>(resolve => {
              const listener = (msg: any) => {
                if (
                  msg.type === 'SYNC_PROGRESS' &&
                  msg.walletId === currentWalletId &&
                  !msg.isSyncing
                ) {
                  chrome.runtime.onMessage.removeListener(listener)
                  resolve()
                }
              }
              chrome.runtime.onMessage.addListener(listener)
              setTimeout(() => {
                chrome.runtime.onMessage.removeListener(listener)
                resolve()
              }, 30000)
            })
          await waitForSync()
        } else {
          const proceed = await confirm({
            title: 'Switch Account',
            message: `Blockchain sync is in progress (${progress}%). Switching now will interrupt the sync. Continue?`,
            confirmText: 'Switch anyway',
            cancelText: 'Cancel',
            variant: 'default'
          })

          if (!proceed) {
            setSwitchingAccountId(null)
            return
          }
        }
      }

      await accountManager.switchAccount(walletId, accountId)
      sendAnalyticsEvent(ANALYTICS_EVENTS.ACCOUNT_SWITCHED, {
        pageId: PAGE_IDS.ACCOUNT_LIST,
        extra: { cross_wallet: Boolean(isCrossWalletSwitch) }
      })
      replace('/')
    } catch (error) {
      console.error('Failed to switch account:', error)
      setSwitchingAccountId(null)
    }
  }

  const handleAddWallet = async () => {
    const action = await openModal<'import' | 'create' | 'hardware'>({
      title: 'Add Wallet',
      body: (resolve: (value: any) => void, close: () => void) => (
        <AddWalletContent
          onImport={() => {
            close()
            resolve('import')
          }}
          onCreate={() => {
            close()
            resolve('create')
          }}
          onHardware={() => {
            close()
            resolve('hardware')
          }}
        />
      )
    })

    if (action === 'import') {
      navigate('/import-wallet')
    } else if (action === 'create') {
      navigate('/add-wallet')
    } else if (action === 'hardware') {
      openHardwareConnectTab()
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Noir Wallet" showBack onBack={() => replace('/')} />

      <div className="page-content">
        <div className="mb-4">
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search Account"
            className="h-[46px] rounded-xl pl-10"
            startContent={
              <Icon
                icon="lucide:search"
                width={18}
                height={18}
                className="text-muted pointer-events-none"
              />
            }
          />
        </div>

        <div className="space-y-2">
          <div className="space-y-6">
            {loading ? (
              <div className="text-center py-8 text-muted">Loading wallets...</div>
            ) : wallets.length === 0 ? (
              <div className="text-center py-8 text-muted">No wallets found</div>
            ) : searchQuery.trim() && filteredAccounts.length === 0 ? (
              <div className="text-center py-8 text-muted">No accounts found</div>
            ) : (
              <>
                {pinnedAccounts.length > 0 && (
                  <div className="space-y-2">
                    <div className="px-2">
                      <span className="text-sm font-medium text-muted">Pinned</span>
                    </div>
                    <div className="space-y-2">
                      {pinnedAccounts.map(account => {
                        const wallet = wallets.find(w => w.id === account.walletId)
                        if (!wallet) return null
                        const accountData = wallet.accounts.find(a => a.id === account.id)
                        if (!accountData) return null
                        const balanceInfo = accountBalanceMap.get(account.id)
                        return (
                          <AccountItem
                            key={account.id}
                            account={accountData}
                            wallet={wallet}
                            walletDisplayName={formatWalletName(wallet, wallets)}
                            showWalletName={true}
                            switchingAccountId={switchingAccountId}
                            balance={balanceInfo?.balance}
                            onSelect={handleAccountSelect}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}

                {wallets.map(wallet => {
                  const walletNormalAccounts = wallet.accounts.filter(
                    account =>
                      !account.isPinned &&
                      !account.isHidden &&
                      filteredAccountKeys.has(`${wallet.id}:${account.id}`)
                  )

                  if (walletNormalAccounts.length === 0 && searchQuery) {
                    return null
                  }

                  return (
                    <div key={wallet.id} className="space-y-2">
                      {enableDerivedAccounts && (
                        <div className="px-2">
                          <span className="text-sm font-medium text-muted">
                            {formatWalletName(wallet, wallets)}
                          </span>
                        </div>
                      )}
                      <div className="space-y-2">
                        {walletNormalAccounts.map(account => {
                          const balanceInfo = accountBalanceMap.get(account.id)
                          return (
                            <AccountItem
                              key={account.id}
                              account={account}
                              wallet={wallet}
                              showWalletName={false}
                              switchingAccountId={switchingAccountId}
                              balance={balanceInfo?.balance}
                              onSelect={handleAccountSelect}
                            />
                          )
                        })}

                        {enableDerivedAccounts && !isHardwareKeySource(wallet.keySource) && (
                          <Button
                            onClick={async () => {
                              if (addingWalletId) return
                              try {
                                setAddingWalletId(wallet.id)
                                await accountManager.addNewAccount(wallet.id)
                                await loadWallets()
                              } catch (e) {
                                console.error('Failed to add account:', e)
                              } finally {
                                setAddingWalletId(null)
                              }
                            }}
                            disabled={addingWalletId === wallet.id}
                            variant="outline"
                            className="w-full p-3 h-10 rounded-xl border border-dashed border-border/50 text-muted hover:text-foreground text-sm"
                          >
                            {addingWalletId === wallet.id ? (
                              <Icon
                                icon="lucide:loader-2"
                                width={16}
                                height={16}
                                className="animate-spin"
                              />
                            ) : (
                              <Icon icon="lucide:plus" width={16} height={16} />
                            )}
                            {addingWalletId === wallet.id ? 'Adding...' : 'Add account'}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {hiddenAccounts.length > 0 && (
                  <div className="space-y-2">
                    <div className="px-2">
                      <span className="text-sm font-medium text-muted">
                        Hidden ({hiddenAccounts.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {hiddenAccounts.map(account => {
                        const wallet = wallets.find(w => w.id === account.walletId)
                        if (!wallet) return null
                        const accountData = wallet.accounts.find(a => a.id === account.id)
                        if (!accountData) return null
                        const balanceInfo = accountBalanceMap.get(account.id)
                        return (
                          <AccountItem
                            key={account.id}
                            account={accountData}
                            wallet={wallet}
                            walletDisplayName={formatWalletName(wallet, wallets)}
                            showWalletName={true}
                            switchingAccountId={switchingAccountId}
                            balance={balanceInfo?.balance}
                            onSelect={handleAccountSelect}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="page-footer">
        <Button onClick={handleAddWallet} className="w-full h-[45px]">
          Add Wallet
        </Button>
      </div>
    </div>
  )
}

function AccountItem({
  account,
  wallet,
  walletDisplayName,
  showWalletName = true,
  switchingAccountId,
  balance,
  onSelect
}: {
  account: AccountData
  wallet: WalletItem
  walletDisplayName?: string
  showWalletName?: boolean
  switchingAccountId: string | null
  balance?: string
  onSelect: (accountId: string, walletId: string) => void
}) {
  const { navigate } = useNavigate()
  const { getCurrentAccount, accountDisplayNames } = useWalletStore()
  const currentAccount = getCurrentAccount()

  const displayName = getAccountDisplayName(
    wallet.id,
    account.id,
    account.name,
    accountDisplayNames
  )

  const isActiveAccount = currentAccount?.id === account.id
  const balanceDisplay = balance || '--'

  return (
    <div className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(account.id, wallet.id)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelect(account.id, wallet.id)
          }
        }}
        className={cn(
          'w-full p-4 rounded-xl hover:bg-card transition-colors cursor-pointer',
          isActiveAccount ? 'bg-card/60' : ''
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-left">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium">{formatAccountName(displayName, 20)}</span>
                {isActiveAccount && (
                  <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-medium">
                    Active
                  </span>
                )}
              </div>
              {showWalletName && (
                <span className="text-sm text-muted">{walletDisplayName || wallet.name}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              {switchingAccountId === account.id ? (
                <Icon
                  icon="lucide:loader-2"
                  className="animate-spin text-primary"
                  width={20}
                  height={20}
                />
              ) : (
                <p className="font-semibold text-muted text-sm">{balanceDisplay}</p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon-sm" onClick={e => e.stopPropagation()}>
                  <Icon icon="lucide:more-vertical" width={20} height={20} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation()
                    navigate(`/account-detail?accountId=${account.id}&walletId=${wallet.id}`)
                  }}
                >
                  <Icon icon="lucide:wallet" className="mr-2 h-4 w-4" />
                  Account details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation()
                    navigate(`/addresses-list?accountId=${account.id}&walletId=${wallet.id}`)
                  }}
                >
                  <Icon icon="lucide:scan-qr-code" className="mr-2 h-4 w-4" />
                  Addresses
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async e => {
                    e.stopPropagation()
                    await openModal({
                      title: 'Rename account',
                      body: (_resolve: (value: any) => void, close: () => void) => (
                        <RenameAccountContent
                          walletId={wallet.id}
                          accountId={account.id}
                          currentName={displayName}
                          close={close}
                        />
                      )
                    })
                  }}
                >
                  <Icon icon="lucide:pencil" className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async e => {
                    e.stopPropagation()
                    await accountManager.togglePinAccount(wallet.id, account.id)
                  }}
                >
                  <Icon
                    icon={account.isPinned ? 'lucide:pin-off' : 'lucide:pin'}
                    className="mr-2 h-4 w-4"
                  />
                  {account.isPinned ? 'Unpin' : 'Pin to top'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async e => {
                    e.stopPropagation()
                    await accountManager.toggleHideAccount(wallet.id, account.id)
                  }}
                >
                  <Icon
                    icon={account.isHidden ? 'lucide:eye' : 'lucide:eye-off'}
                    className="mr-2 h-4 w-4"
                  />
                  {account.isHidden ? 'Show account' : 'Hide account'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AddWalletContentProps {
  onImport: () => void
  onCreate: () => void
  onHardware: () => void
}

function AddWalletContent({ onImport, onCreate, onHardware }: AddWalletContentProps) {
  return (
    <div className="space-y-2">
      <button
        onClick={onImport}
        className="w-full p-4 bg-card rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Icon icon="lucide:import" width={16} height={16} className="mr-2" />
            <span>Import wallet</span>
          </div>
          <Icon icon="lucide:chevron-right" width={16} height={16} className="text-muted" />
        </div>
      </button>
      <button
        onClick={onCreate}
        className="w-full p-4 bg-card rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Icon icon="lucide:plus" width={16} height={16} className="mr-2" />
            <span>Create new wallet</span>
          </div>
          <Icon icon="lucide:chevron-right" width={16} height={16} className="text-muted" />
        </div>
      </button>
      <button
        onClick={onHardware}
        className="w-full p-4 bg-card rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Icon icon="lucide:shield" width={16} height={16} className="mr-2" />
            <span>Connect Hardware Wallet</span>
          </div>
          <Icon icon="lucide:chevron-right" width={16} height={16} className="text-muted" />
        </div>
      </button>
    </div>
  )
}
