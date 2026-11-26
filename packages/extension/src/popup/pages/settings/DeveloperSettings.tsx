import { useEffect, useState } from 'react'
import { Icon } from '@iconify/react'
import { resolveActiveEvmNetworkConfig } from '@/core/chains/evm-runtime-config'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { useActiveAccountNetworks } from '@/popup/hooks/useActiveAccountNetworks'
import { toast } from '@/store/toast-store'
import type { Network } from '@/types'
import { PageHeader } from '../../components/common/PageHeader'
import { Switch } from '../../components/ui/switch'
import { useDialog } from '../../hooks/useDialog'
import { chainEndpointSettingsClient } from '../../services/chain-endpoint-settings-client'
import { clearEvmActivity } from '../../services/evm-activity-settings-client'
import { networkModeClient } from '../../services/network-mode-client'

export function DeveloperSettings() {
  const { confirm, alert } = useDialog()
  const { activeAccount, contextChanging } = useActiveAccountNetworks()
  const [networkMode, setNetworkMode] = useState<Network>(DEFAULT_NETWORK)
  const [activeEvmChainId, setActiveEvmChainId] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [clearing, setClearing] = useState(false)
  const activeEvmNetwork = activeAccount?.networks.find(
    network =>
      network.chain.family === 'evm' &&
      network.chain.id === activeEvmChainId &&
      network.chain.capabilities.transaction.status === 'available'
  )
  const busy = switching || clearing

  useEffect(() => {
    void networkModeClient
      .read()
      .then(result => setNetworkMode(result.networkMode))
      .catch(() => {})
    void chainEndpointSettingsClient
      .read()
      .then(settings =>
        setActiveEvmChainId(resolveActiveEvmNetworkConfig(DEFAULT_NETWORK, settings).chainId)
      )
      .catch(() => {})
  }, [])

  const handleToggle = async () => {
    if (busy) return
    const target: Network = networkMode === 'mainnet' ? 'testnet' : 'mainnet'
    const accepted = await confirm({
      title: target === 'testnet' ? 'Enable Testnet Mode?' : 'Return to Mainnet?',
      message:
        target === 'testnet'
          ? 'Noir Wallet will lock and restart. Only test networks, test balances, and test activity will be visible. Test assets have no real value.'
          : 'Noir Wallet will lock and restart. Only main networks, balances, and activity will be visible.',
      confirmText: target === 'testnet' ? 'Enable & Restart' : 'Switch & Restart'
    })
    if (!accepted) return

    setSwitching(true)
    try {
      await networkModeClient.switch(target)
      setNetworkMode(target)
    } catch (error) {
      setSwitching(false)
      await alert({
        title: 'Network switch unavailable',
        message: error instanceof Error ? error.message : 'Network mode could not be switched.'
      })
    }
  }

  const handleClearActivity = async () => {
    if (busy || contextChanging || !activeAccount || !activeEvmNetwork) return
    const target = {
      networkMode,
      chainId: activeEvmNetwork.chain.id,
      walletId: activeAccount.walletId,
      accountId: activeAccount.accountId
    }
    setClearing(true)
    try {
      const accepted = await confirm({
        title: 'Clear activity and nonce data?',
        message: `Delete local transaction records for ${activeAccount.accountDisplayName} on ${activeEvmNetwork.chain.displayName}, including pending transactions. This cannot be undone. Transactions already broadcast can still confirm on-chain.`,
        confirmText: 'Clear activity',
        variant: 'danger'
      })
      if (!accepted) return
      await clearEvmActivity(target)
      toast.success('Activity cleared')
    } catch (error) {
      await alert({
        title: 'Could not clear activity',
        message:
          error instanceof Error ? error.message : 'Check the account and network and try again.'
      })
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="page-container">
      <PageHeader title="Developer Settings" showBack backDisabled={busy} />

      <div className="page-content space-y-4">
        <button
          type="button"
          role="switch"
          aria-checked={networkMode === 'testnet'}
          disabled={busy}
          onClick={handleToggle}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-card p-4 text-left transition-colors hover:bg-white/5 disabled:cursor-wait disabled:opacity-70"
        >
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">Testnet Mode</span>
              {networkMode === 'testnet' && (
                <span className="rounded-full bg-warning-surface px-2 py-0.5 text-[10px] font-medium text-warning">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-warning">
              Show only test networks across Zcash, EVM, Bitcoin, and supported chains.
            </p>
          </div>
          {switching ? (
            <Icon
              icon="lucide:loader-2"
              className="shrink-0 animate-spin text-primary"
              width={22}
            />
          ) : (
            <Switch checked={networkMode === 'testnet'} />
          )}
        </button>

        <div className="rounded-xl border border-warning/20 bg-warning-surface p-4">
          <div className="flex gap-3">
            <Icon
              icon="lucide:triangle-alert"
              className="mt-0.5 shrink-0 text-warning"
              width={18}
            />
            <p className="text-xs leading-5 text-warning">
              Switching networks cancels unsigned approvals, disconnects dApps, locks the wallet,
              and restarts the extension. Mainnet and testnet balances and activity remain isolated.
              Keystone accounts may need to reconnect a firmware export for the target network.
            </p>
          </div>
        </div>

        {activeEvmNetwork && (
          <button
            type="button"
            disabled={busy || contextChanging}
            onClick={handleClearActivity}
            className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-card p-4 text-left transition-colors hover:bg-white/5 disabled:opacity-70"
          >
            <Icon
              icon="lucide:trash-2"
              width={18}
              className="shrink-0 text-danger"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                Clear activity and nonce data
              </span>
              <span className="mt-1 block truncate text-xs text-muted">
                {activeEvmNetwork.chain.displayName}
              </span>
            </span>
            <Icon
              icon="lucide:chevron-right"
              width={16}
              className="shrink-0 text-muted"
              aria-hidden="true"
            />
          </button>
        )}
      </div>
    </div>
  )
}
