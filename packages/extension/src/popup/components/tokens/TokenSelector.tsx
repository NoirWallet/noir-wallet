/**
 * Token selector component for Swap and other scenarios
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { SwapToken } from '@/core/services/intents-api'
import { RHEA_SWAP_CHAIN_CATALOG } from '@/core/services/rhea-swap'
import type { InspectedTokenAddress } from '@/popup/services/token-address-discovery'
import { formatChainName, formatSymbol } from '@/lib/format'
import { TokenIcon } from './TokenIcon'
import { TokenBalanceDisplay } from './TokenBalanceDisplay'
import { TokenSelectorView } from './TokenSelectorView'
import { sortTokensByBalanceValue } from './token-balance-order'
import { swapTokenCatalogClient } from '@/popup/services/swap-token-catalog-client'
import {
  compareSwapTokenSearchRelevance,
  matchesSwapTokenSearch
} from '@/popup/services/swap-token-selection'
import { createDebugRequestId, logDebugTiming } from '@/lib/debug-performance'
import {
  deferredChainChoices,
  isSelectableSwapBlockchain
} from '@/popup/services/chain-selection-availability'
import { useWalletStore } from '@/store/wallet-store'
import {
  orderNetworkIdsByRecency,
  recordRecentChainSelection,
  tokenSelectorChainOrderStorageKey
} from './token-selector-chain-order'

const MAX_RENDERED_TOKENS = 100

export interface TokenSelectorProps {
  selectedToken?: SwapToken
  onSelect: (token: SwapToken) => void
  tokens?: readonly SwapToken[]
  defaultTokens?: readonly SwapToken[]
  defaultCatalogLoading?: boolean
  balances?: ReadonlyMap<string, string>
  catalogLoading?: boolean
  stableCatalogOrder?: boolean
  fullHeight?: boolean
  networkFilterStyle?: 'dropdown' | 'icons'
  excludeAssetId?: string
  emptyMessage?: string
  unavailableNetworks?: readonly Readonly<{ id: string; label: string; iconChain: string }>[]
  onDiscoveredToken?: (result: InspectedTokenAddress) => string | void
}

export function TokenSelector({
  selectedToken,
  onSelect,
  tokens: providedTokens,
  defaultTokens,
  defaultCatalogLoading = false,
  balances,
  catalogLoading = false,
  stableCatalogOrder = false,
  fullHeight = false,
  networkFilterStyle = 'dropdown',
  excludeAssetId,
  emptyMessage = 'No tokens found',
  unavailableNetworks = [],
  onDiscoveredToken
}: TokenSelectorProps) {
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const chainOrderKey = useMemo(
    () =>
      currentWalletId && currentAccountId
        ? tokenSelectorChainOrderStorageKey({
            network: currentNetwork,
            walletId: currentWalletId,
            accountId: currentAccountId
          })
        : null,
    [currentAccountId, currentNetwork, currentWalletId]
  )
  const [recentChainIds, setRecentChainIds] = useState<readonly string[]>([])
  const [search, setSearch] = useState('')
  const [selectedBlockchain, setSelectedBlockchain] = useState('all')
  const [fetchedTokens, setFetchedTokens] = useState<readonly SwapToken[]>([])
  const [fetchedLoading, setFetchedLoading] = useState(providedTokens === undefined)
  const [selectionTraceId] = useState(() => createDebugRequestId('token-selector'))
  const previousRows = useRef<{ filter: string; keys: readonly string[] } | null>(null)
  const [renderWindow, setRenderWindow] = useState({ filter: 'all:', count: MAX_RENDERED_TOKENS })
  const hasProvidedTokens = providedTokens !== undefined
  const tokens = useMemo(
    () =>
      (providedTokens ?? fetchedTokens).filter(token =>
        isSelectableSwapBlockchain(token.blockchain, __ENABLED_CHAIN_FEATURE_FLAGS__)
      ),
    [providedTokens, fetchedTokens]
  )
  const loading = !hasProvidedTokens && fetchedLoading

  useEffect(() => {
    if (!chainOrderKey) {
      setRecentChainIds([])
      return
    }
    let cancelled = false
    void chrome.storage.session
      .get(chainOrderKey)
      .then(result => {
        if (cancelled) return
        const stored = result[chainOrderKey]
        setRecentChainIds(
          Array.isArray(stored)
            ? stored.filter((value): value is string => typeof value === 'string')
            : []
        )
      })
      .catch(() => {
        if (!cancelled) setRecentChainIds([])
      })
    return () => {
      cancelled = true
    }
  }, [chainOrderKey])

  const selectBlockchain = useCallback(
    (chainId: string) => {
      setSelectedBlockchain(chainId)
      if (!chainOrderKey) return
      setRecentChainIds(current => {
        const next = recordRecentChainSelection(current, chainId)
        void chrome.storage.session.set({ [chainOrderKey]: next }).catch(() => {})
        return next
      })
    },
    [chainOrderKey]
  )

  useEffect(() => {
    if (hasProvidedTokens) return

    let cancelled = false
    async function loadTokens() {
      setFetchedLoading(true)
      try {
        const cached = await swapTokenCatalogClient.readCached()
        if (!cancelled && cached.length > 0) {
          setFetchedTokens(cached)
          setFetchedLoading(false)
        }
        const refreshed = await swapTokenCatalogClient.refresh()
        if (!cancelled) setFetchedTokens(refreshed)
      } catch {
        // Keep the last usable cached catalog.
      } finally {
        if (!cancelled) setFetchedLoading(false)
      }
    }
    void loadTokens()
    return () => {
      cancelled = true
    }
  }, [hasProvidedTokens])

  const networkOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const token of tokens) {
      if (!options.has(token.blockchain)) {
        options.set(token.blockchain, formatChainName(token.blockchain))
      }
    }
    const base = [...options].map(([id, label]) => ({ id, label }))
    const orderedIds = orderNetworkIdsByRecency(
      base.map(option => option.id),
      recentChainIds
    )
    return orderedIds.map(id => base.find(option => option.id === id)!)
  }, [tokens, recentChainIds])
  const effectiveBlockchain =
    selectedBlockchain === 'all' || networkOptions.some(option => option.id === selectedBlockchain)
      ? selectedBlockchain
      : 'all'
  const selectorNetworks = [
    ...networkOptions.map(option => ({ ...option, iconChain: option.id })),
    ...unavailableNetworks
      .filter(option => !networkOptions.some(available => available.id === option.id))
      .map(option => ({ ...option, disabledReason: 'Unavailable' })),
    ...deferredChainChoices(__ENABLED_CHAIN_FEATURE_FLAGS__).map(option => ({
      id: `coming-soon:${option.family}`,
      label: option.label,
      iconChain: option.iconAlias,
      disabledReason: 'Coming soon'
    }))
  ]
  const filterKey = `${effectiveBlockchain}:${search}`
  const filteredTokens = useMemo(() => {
    const startedAt = performance.now()
    const available = new Set(tokens.map(token => `${token.blockchain}:${token.assetId}`))
    const previous =
      stableCatalogOrder && !search && previousRows.current?.filter === filterKey
        ? new Map(previousRows.current.keys.map((key, index) => [key, index]))
        : undefined
    const ranked = [
      ...sortTokensByBalanceValue(
        (search.trim() ? tokens : (defaultTokens ?? tokens)).filter(token => {
          if (!available.has(`${token.blockchain}:${token.assetId}`)) return false
          if (token.assetId === excludeAssetId) return false
          if (effectiveBlockchain !== 'all' && token.blockchain !== effectiveBlockchain)
            return false
          return matchesSwapTokenSearch(token, search)
        }),
        balances,
        previous,
        !search.trim() && defaultTokens
          ? new Map(
              defaultTokens.map((token, index) => [`${token.blockchain}:${token.assetId}`, index])
            )
          : undefined
      )
    ].sort((left, right) => compareSwapTokenSearchRelevance(left, right, search))
    logDebugTiming(
      selectionTraceId,
      `filter-sort input=${tokens.length} output=${ranked.length} queryLength=${search.length}`,
      startedAt
    )
    return ranked
  }, [
    tokens,
    defaultTokens,
    excludeAssetId,
    effectiveBlockchain,
    search,
    balances,
    selectionTraceId,
    stableCatalogOrder,
    filterKey
  ])
  useEffect(() => {
    previousRows.current = {
      filter: filterKey,
      keys: filteredTokens.map(token => `${token.blockchain}:${token.assetId}`)
    }
  }, [filterKey, filteredTokens])
  const visibleLimit = renderWindow.filter === filterKey ? renderWindow.count : MAX_RENDERED_TOKENS
  const visibleTokens = filteredTokens.slice(0, visibleLimit)

  const selectorItems = visibleTokens.map(token => {
    const balance = balances?.get(token.assetId)
    const symbol = formatSymbol(token.symbol)
    const chainName = formatChainName(token.blockchain)
    return {
      key: token.blockchain + ':' + token.assetId,
      symbol,
      icon: <TokenIcon token={token} size={32} />,
      subtitle: chainName,
      ariaLabel:
        symbol +
        ' on ' +
        chainName +
        (balance === undefined ? '' : ', balance ' + balance + ' ' + symbol),
      balance:
        balance === undefined ? undefined : (
          <TokenBalanceDisplay
            amount={balance}
            symbol={symbol}
            priceUsd={token.price}
            approximateFiat
          />
        )
    }
  })
  const discoveryChain = RHEA_SWAP_CHAIN_CATALOG.find(
    chain => chain.walletFamily === 'evm' && chain.blockchain === effectiveBlockchain
  )
  return (
    <TokenSelectorView
      search={search}
      onSearchChange={setSearch}
      networks={selectorNetworks}
      selectedNetwork={effectiveBlockchain}
      onNetworkChange={selectBlockchain}
      items={selectorItems}
      selectedKey={
        selectedToken ? selectedToken.blockchain + ':' + selectedToken.assetId : undefined
      }
      onSelect={key => {
        const selected = visibleTokens.find(token => token.blockchain + ':' + token.assetId === key)
        if (selected) onSelect(selected)
      }}
      lowBalanceKeys={
        balances
          ? new Set(
              visibleTokens
                .filter(token => balances.get(token.assetId) === '0')
                .map(token => token.blockchain + ':' + token.assetId)
            )
          : undefined
      }
      loading={
        loading ||
        (filteredTokens.length === 0 &&
          (catalogLoading || (!search.trim() && defaultCatalogLoading)))
      }
      emptyMessage={emptyMessage}
      fullHeight={fullHeight || networkFilterStyle === 'icons'}
      discovery={
        onDiscoveredToken && currentWalletId && currentAccountId
          ? {
              scopeKey: `${currentNetwork}:${currentWalletId}:${currentAccountId}`,
              chainId: discoveryChain ? `eip155:${discoveryChain.apiChainId}` : null,
              onAdded: onDiscoveredToken
            }
          : undefined
      }
      status={
        catalogLoading && search.trim().length > 0 ? (
          <p role="status" className="mt-2 text-xs text-muted">
            Searching more networks...
          </p>
        ) : undefined
      }
      onScroll={event => {
        const list = event.currentTarget
        if (
          visibleLimit < filteredTokens.length &&
          list.scrollHeight - list.scrollTop - list.clientHeight < 200
        ) {
          setRenderWindow({ filter: filterKey, count: visibleLimit + MAX_RENDERED_TOKENS })
        }
      }}
    />
  )
}
