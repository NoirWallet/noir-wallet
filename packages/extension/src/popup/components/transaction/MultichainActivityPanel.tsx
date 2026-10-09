import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import type { ActivityItem, ActivityReadModel } from '@/core/activity'
import type { PortfolioReadModel } from '@/core/portfolio'
import { evmWalletClient } from '@/popup/services/evm-wallet-client'
import type { Network } from '@/types'
import { Button } from '../ui/button'
import { useSettingsStore } from '@/store/settings-store'
import { useUserEvmAssets } from '@/popup/hooks/useUserEvmAssets'
import type { AccountNetworkView } from '@/popup/services/account-networks-client'
import { formatChainAddressExplorerUrl } from '@/popup/services/chain-explorer'
import { ListSkeleton } from '../ui/skeleton'
import { NetworkFilter } from '../common/NetworkFilter'
import { MultichainActivityRow } from './MultichainActivityRow'
import { EvmNonceRecoveryBanner } from './EvmNonceRecoveryBanner'
import { resolveActivityChainId } from './activity-chain'
import { cn } from '@/lib/utils'
import { getOwnExtensionSenderContext } from '@/lib/runtime-message-security'
import type { DAppExecutionMode } from '@/core/dapp/dapp-execution-mode'
import { buildActivityPresentationCatalog } from '@/popup/services/activity-presentation-catalog'
import {
  filterActivityItems,
  groupActivityItemsByDate,
  resolveAvailableActivityChainSelection
} from '@/popup/services/activity-list-model'
import { buildActivityExecutionAddressModes } from './multichain-activity-presentation'

interface MultichainActivityPanelProps {
  readonly walletId: string | null
  readonly accountId: string | null
  readonly network: Network
  readonly initialModel?: ActivityReadModel | null
  readonly portfolio?: PortfolioReadModel | null
  readonly accountNetworks?: readonly AccountNetworkView[]
  readonly onItemClick?: (item: ActivityItem) => void
  readonly filterAssetId?: string
  readonly showToolbar?: boolean
  readonly maxItems?: number
  readonly compact?: boolean
  readonly accountMode?: DAppExecutionMode
  readonly focusTransactionId?: string | null
}

const PENDING_EVM_RECHECK_INTERVAL_MS = 3_000
const PENDING_ACTIVITY_REFRESH_INTERVAL_MS = 60_000

function EmptyState({
  icon,
  title,
  description,
  onRetry,
  compact = false
}: {
  readonly icon: string
  readonly title: string
  readonly description?: string
  readonly onRetry?: () => void
  readonly compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        compact ? 'min-h-28 py-4' : 'min-h-48 py-8'
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-foreground/5',
          compact ? 'mb-2 size-9' : 'mb-3 size-12'
        )}
      >
        <Icon
          icon={icon}
          width={compact ? 19 : 24}
          height={compact ? 19 : 24}
          className="text-muted"
        />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p
          className={cn(
            'mt-1 max-w-[260px] text-xs text-muted',
            compact ? 'leading-4' : 'leading-5'
          )}
        >
          {description}
        </p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function MultichainActivityPanel({
  walletId,
  accountId,
  network,
  initialModel = null,
  portfolio = null,
  accountNetworks = [],
  onItemClick,
  filterAssetId,
  showToolbar = true,
  maxItems,
  compact = false,
  accountMode,
  focusTransactionId
}: MultichainActivityPanelProps) {
  const requestSequence = useRef(0)
  const focusedTransactionId = useRef<string | null>(null)
  const scopedInitialModel = initialModel?.scope.accountId === accountId ? initialModel : null
  const [model, setModel] = useState<ActivityReadModel | null>(scopedInitialModel)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    scopedInitialModel ? 'ready' : 'loading'
  )
  const scopeKey = JSON.stringify([walletId ?? '', accountId ?? ''])
  const persistedChainSelection = useSettingsStore(
    state => state.portfolioChainSelectionByAccount[scopeKey]
  )
  const setPortfolioChainSelection = useSettingsStore(state => state.setPortfolioChainSelection)
  const endpointSettings = useSettingsStore(state => state.chainEndpointSettings)
  const userEvmAssets = useUserEvmAssets()
  const filteredChainId = filterAssetId
    ? portfolio?.assets.find(asset => asset.asset.id === filterAssetId)?.asset.chainId
    : undefined

  const { assetMetadata, chainMetadata } = useMemo(
    () => buildActivityPresentationCatalog({ network, endpointSettings, userEvmAssets, portfolio }),
    [endpointSettings, network, portfolio, userEvmAssets]
  )
  const executionAddressModes = useMemo(
    () => buildActivityExecutionAddressModes(accountNetworks),
    [accountNetworks]
  )

  const load = useCallback(async () => {
    const request = ++requestSequence.current
    setStatus('loading')
    let localModelAvailable = false
    try {
      const local = await evmWalletClient.getActivity('read', 'all')
      if (request !== requestSequence.current) return
      if (local) {
        localModelAvailable = true
        setModel(local)
        if (local.items.length > 0) setStatus('ready')
      }
    } catch {
      // A supplemental refresh can still recover when the local read is temporarily unavailable.
    }

    try {
      const refreshed = await evmWalletClient.getActivity(
        'refresh',
        'all',
        filteredChainId ? { chainIds: [filteredChainId] } : undefined
      )
      if (request !== requestSequence.current) return
      if (!refreshed) {
        setStatus(localModelAvailable ? 'ready' : 'error')
        return
      }
      setModel(refreshed)
      setStatus('ready')
    } catch {
      if (request !== requestSequence.current) return
      setStatus(localModelAvailable ? 'ready' : 'error')
    }
  }, [filteredChainId])

  useEffect(() => {
    const retainedModel = initialModel?.scope.accountId === accountId ? initialModel : null
    setModel(retainedModel)
    if (!walletId || !accountId) {
      setStatus('ready')
      return
    }
    if (retainedModel) {
      setStatus('ready')
      return
    }
    setStatus('loading')
    void load()
    return () => {
      requestSequence.current += 1
    }
  }, [walletId, accountId, initialModel, load])

  useEffect(() => {
    if (!walletId || !accountId) return

    let cancelled = false
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (getOwnExtensionSenderContext(sender, chrome.runtime.id) !== 'service-worker') return
      if (!message || typeof message !== 'object' || !('type' in message)) return
      if (
        message.type !== 'TRANSACTION_ADDED' &&
        message.type !== 'TRANSACTION_UPDATED' &&
        message.type !== 'TRANSACTION_STATUS_UPDATED' &&
        message.type !== 'CROSS_CHAIN_STATUS_UPDATED'
      ) {
        return
      }

      void evmWalletClient
        .getActivity('read', 'all')
        .then(next => {
          if (!cancelled && next?.scope.accountId === accountId) {
            setModel(next)
            setStatus('ready')
          }
        })
        .catch(() => {})
    }

    chrome.runtime.onMessage.addListener(listener)
    return () => {
      cancelled = true
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [accountId, walletId])

  const visibleModel = model?.scope.accountId === accountId ? model : null
  useEffect(() => {
    if (!focusTransactionId || !visibleModel || !onItemClick) return
    const item = visibleModel.items.find(candidate => candidate.id === focusTransactionId)
    if (!item || focusedTransactionId.current === focusTransactionId) return
    focusedTransactionId.current = focusTransactionId
    onItemClick(item)
  }, [focusTransactionId, onItemClick, visibleModel])
  const availableChainIds = useMemo(
    () => accountNetworks.map(entry => entry.chain.id),
    [accountNetworks]
  )
  const selectedChainIds = useMemo(
    () => resolveAvailableActivityChainSelection(availableChainIds, persistedChainSelection),
    [availableChainIds, persistedChainSelection]
  )
  const selectedNetwork =
    selectedChainIds.length === 1
      ? accountNetworks.find(entry => entry.chain.id === selectedChainIds[0])
      : undefined
  const selectedAddress = selectedNetwork?.addresses.find(address => address.preferredForReceive)
  const selectedHistoryAddress =
    accountMode === 'private' && selectedNetwork?.privateExecutionAddress
      ? selectedNetwork.privateExecutionAddress
      : selectedAddress?.value
  const fullHistoryUrl =
    selectedNetwork && selectedHistoryAddress
      ? formatChainAddressExplorerUrl(selectedNetwork.chain.id, selectedHistoryAddress, network)
      : ''
  const visibleItems = useMemo(
    () =>
      filterActivityItems({
        items: visibleModel?.items ?? [],
        selectedChainIds,
        assetId: filterAssetId
      }),
    [filterAssetId, selectedChainIds, visibleModel]
  )
  const pendingEvmChainKey = useMemo(
    () =>
      [
        ...new Set(
          (visibleModel?.items ?? []).flatMap(item => {
            const chainId = resolveActivityChainId(item)
            const isPending =
              item.status === 'signed' ||
              item.status === 'broadcast' ||
              item.status === 'confirming'
            return isPending && chainId?.startsWith('eip155:') ? [chainId] : []
          })
        )
      ]
        .sort()
        .join(','),
    [visibleModel]
  )
  useEffect(() => {
    if (!walletId || !accountId || !pendingEvmChainKey) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastSupplementalRefreshAt = 0
    const refreshPending = async () => {
      try {
        await chrome.runtime
          .sendMessage({ type: 'RECHECK_FAST_PENDING_TRANSACTIONS', family: 'evm' })
          .catch(() => {})
        const currentTime = Date.now()
        const shouldRefreshSupplemental =
          currentTime - lastSupplementalRefreshAt >= PENDING_ACTIVITY_REFRESH_INTERVAL_MS
        const refreshed = await evmWalletClient.getActivity(
          shouldRefreshSupplemental ? 'refresh' : 'read',
          'all',
          shouldRefreshSupplemental ? { chainIds: pendingEvmChainKey.split(',') } : undefined
        )
        if (shouldRefreshSupplemental) lastSupplementalRefreshAt = currentTime
        if (active && refreshed?.scope.accountId === accountId) setModel(refreshed)
      } catch {
        // Keep the last valid Activity model and retry while it still contains pending EVM items.
      } finally {
        if (active) {
          timer = setTimeout(() => void refreshPending(), PENDING_EVM_RECHECK_INTERVAL_MS)
        }
      }
    }
    timer = setTimeout(() => void refreshPending(), PENDING_EVM_RECHECK_INTERVAL_MS)
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [accountId, pendingEvmChainKey, walletId])
  const displayedItems = useMemo(
    () => (maxItems === undefined ? visibleItems : visibleItems.slice(0, maxItems)),
    [maxItems, visibleItems]
  )
  const groups = useMemo(() => groupActivityItemsByDate(displayedItems), [displayedItems])
  const recoveryChainIds = selectedChainIds.filter(
    chainId =>
      chainId.startsWith('eip155:') &&
      (selectedChainIds.length === 1 || pendingEvmChainKey.split(',').includes(chainId))
  )
  const recoveryBanners = accountId
    ? recoveryChainIds.map(chainId => {
        const nativeAsset = portfolio?.assets.find(
          entry => entry.asset.chainId === chainId && entry.asset.kind === 'native'
        )
        return (
          <EvmNonceRecoveryBanner
            key={`${accountId}:${chainId}:${accountMode ?? 'main'}`}
            accountId={accountId}
            chainId={chainId}
            networkName={chainMetadata.get(chainId)?.displayName ?? 'EVM'}
            executionMode={accountMode === 'private' ? 'private' : 'main'}
            feeSymbol={nativeAsset?.metadata.symbol ?? 'native'}
            feeDecimals={nativeAsset?.metadata.decimals ?? 18}
            activityItems={visibleModel?.items ?? []}
            onUpdated={() => void load()}
          />
        )
      })
    : null

  const toolbar = showToolbar ? (
    <div className="shrink-0 px-4 pb-3 pt-3">
      <div className="flex items-center justify-between gap-3">
        <NetworkFilter
          ariaLabelPrefix="Filter activity by network"
          options={accountNetworks.map(entry => entry.chain)}
          selectedIds={selectedChainIds}
          onSelectionChange={chainIds =>
            setPortfolioChainSelection(
              scopeKey,
              chainIds.length === availableChainIds.length ? null : chainIds
            )
          }
        />
      </div>
    </div>
  ) : null

  const fullHistoryLink = fullHistoryUrl ? (
    <div className="border-t border-border/60 px-5 py-3 text-center">
      <a
        href={fullHistoryUrl}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        Full history
        <Icon icon="lucide:external-link" width={13} height={13} />
      </a>
    </div>
  ) : null

  if (status === 'loading' && (!visibleModel || visibleItems.length === 0)) {
    return (
      <section aria-label="Multichain activity" className="min-h-0">
        {toolbar}
        {recoveryBanners}
        <ListSkeleton rows={3} label="Loading activity" className="px-5 py-3" />
      </section>
    )
  }

  if (status === 'error' && !visibleModel) {
    return (
      <section aria-label="Multichain activity" className="min-h-0">
        {toolbar}
        {recoveryBanners}
        <EmptyState
          icon="lucide:wifi-off"
          title="Unable to load activity"
          description="Your local transaction records are safe. Try loading this account again."
          onRetry={() => void load()}
          compact={compact}
        />
        {fullHistoryLink}
      </section>
    )
  }

  if (!visibleModel || visibleItems.length === 0) {
    return (
      <section aria-label="Multichain activity" className="min-h-0">
        {toolbar}
        {recoveryBanners}
        <EmptyState
          icon="lucide:inbox"
          title={filterAssetId ? 'No activity for this asset' : 'No activity yet'}
          compact={compact}
        />
        {fullHistoryLink}
      </section>
    )
  }

  return (
    <section aria-label="Multichain activity" className="min-h-0">
      {toolbar}
      {recoveryBanners}
      <div className="space-y-4 pb-4">
        {groups.map(([date, items]) => (
          <section key={date} aria-label={date}>
            <p className="mb-1 px-5 text-[11px] font-medium text-muted">{date}</p>
            <div className="divide-y divide-border/50">
              {items.map(item => {
                const amount = item.snapshot?.primaryAmount
                const asset = amount ? assetMetadata.get(amount.assetId) : undefined
                const chainId = asset?.asset.chainId ?? resolveActivityChainId(item)
                const chain = chainId ? chainMetadata.get(chainId) : undefined

                return (
                  <MultichainActivityRow
                    key={`${item.source}:${item.id}`}
                    item={item}
                    assetMetadata={assetMetadata}
                    chainMetadata={chainMetadata}
                    networkName={chain?.displayName ?? 'Wallet'}
                    chainIconAlias={chain?.iconAlias}
                    chainId={chainId}
                    executionAddressModes={executionAddressModes}
                    onClick={onItemClick}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
      {fullHistoryLink}
    </section>
  )
}
