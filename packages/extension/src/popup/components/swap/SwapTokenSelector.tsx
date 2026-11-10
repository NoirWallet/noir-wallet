import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RheaSwapToken } from '@/core/services/rhea-swap'
import type { PortfolioReadModel } from '@/core/portfolio'
import { TokenSelector, type TokenSelectorProps } from '../tokens/TokenSelector'
import { ListSkeleton } from '../ui/skeleton'
import { usePortfolioUpdates } from '@/popup/hooks/usePortfolioUpdates'
import { isPortfolioModelForScope, readCachedPortfolio } from '@/popup/services/portfolio-cache'
import type { AdditionalReceiveTargetsView } from '@/popup/services/receive-targets-client'
import { receiveTargetsClient } from '@/popup/services/receive-targets-client'
import { buildWalletSwapSourceBalances } from '@/popup/services/swap-page-model'
import { resolveNearConfidentialZecHolding } from '@/popup/services/near-confidential-holdings'
import { TokenIcon } from '../tokens/TokenIcon'
import { formatTokenQuantity } from '@/lib/number-format'
import type { Network } from '@/types'
import type { UserEvmAssetRecord } from '@/core/chains/user-assets'
import { userEvmAssetsClient } from '@/popup/services/user-evm-assets-client'
import {
  loadCuratedSwapTokens,
  readCachedCuratedSwapTokens,
  selectDefaultSwapTokens,
  type CuratedSwapTokenRow
} from '@/popup/services/swap-curated-catalog'

interface SwapBalanceScope {
  readonly scopeKey: string
  readonly walletId: string
  readonly accountId: string
  readonly initialPortfolio: PortfolioReadModel | null
  readonly receiveTargets: AdditionalReceiveTargetsView | null
  readonly zcashAvailable: string
  readonly evmExecutionMode: 'main' | 'private'
  readonly network: Network
}

interface SwapTokenSelectorProps extends Omit<
  TokenSelectorProps,
  'tokens' | 'onSelect' | 'balances'
> {
  readonly initialTokens: readonly RheaSwapToken[]
  readonly loadTokens: (
    onTokens: (tokens: readonly RheaSwapToken[]) => void,
    isCancelled: () => boolean
  ) => Promise<readonly RheaSwapToken[]>
  readonly onSelect: (token: RheaSwapToken, portfolio: PortfolioReadModel | null) => void
  readonly balanceScope?: SwapBalanceScope
  readonly confidentialZecToken?: RheaSwapToken
  readonly onSelectConfidentialZec?: (assetId: string) => void
}

export function SwapTokenSelector({
  initialTokens,
  loadTokens,
  onSelect,
  balanceScope,
  confidentialZecToken,
  onSelectConfidentialZec,
  ...props
}: SwapTokenSelectorProps) {
  const [tokens, setTokens] = useState(initialTokens)
  const [loading, setLoading] = useState(true)
  const chainIdsKey = [...new Set(tokens.map(token => token.tokenListChainId))]
    .sort((a, b) => a - b)
    .join(',')
  const chainIds = useMemo(
    () => (chainIdsKey ? chainIdsKey.split(',').map(Number) : []),
    [chainIdsKey]
  )
  const [curatedRows, setCuratedRows] = useState<readonly CuratedSwapTokenRow[]>(() =>
    readCachedCuratedSwapTokens(chainIds)
  )
  const [curatedLoading, setCuratedLoading] = useState(true)
  const [customAssets, setCustomAssets] = useState<readonly UserEvmAssetRecord[]>([])
  useEffect(() => {
    let cancelled = false
    setCuratedRows(readCachedCuratedSwapTokens(chainIds))
    setCuratedLoading(true)
    void loadCuratedSwapTokens(chainIds, rows => {
      if (!cancelled) setCuratedRows(rows)
    })
      .then(rows => {
        if (!cancelled) setCuratedRows(rows)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCuratedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chainIds])
  useEffect(() => {
    let cancelled = false
    setCustomAssets([])
    void userEvmAssetsClient
      .list()
      .then(assets => {
        if (!cancelled) setCustomAssets(assets)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [balanceScope?.scopeKey])
  const [portfolioSnapshot, setPortfolioSnapshot] = useState(() => ({
    scope: balanceScope?.scopeKey,
    value: balanceScope?.initialPortfolio ?? null
  }))
  const [receiveTargetsSnapshot, setReceiveTargetsSnapshot] = useState(() => ({
    scope: balanceScope?.scopeKey,
    value: balanceScope?.receiveTargets ?? null
  }))
  const portfolio =
    portfolioSnapshot.scope === balanceScope?.scopeKey
      ? portfolioSnapshot.value
      : (balanceScope?.initialPortfolio ?? null)
  const receiveTargets =
    receiveTargetsSnapshot.scope === balanceScope?.scopeKey
      ? receiveTargetsSnapshot.value
      : (balanceScope?.receiveTargets ?? null)
  const walletId = balanceScope?.walletId ?? null
  const accountId = balanceScope?.accountId ?? null
  const scopedPortfolio = isPortfolioModelForScope(portfolio, walletId, accountId)
    ? portfolio
    : null
  const scopedReceiveTargets =
    receiveTargets?.keyDomainId === walletId && receiveTargets.accountId === accountId
      ? receiveTargets
      : null
  const confidentialZec =
    onSelectConfidentialZec && balanceScope
      ? resolveNearConfidentialZecHolding({
          model: scopedPortfolio,
          network: balanceScope.network,
          walletId,
          accountId
        })
      : null
  const zecToken = confidentialZec
    ? (tokens.find(token => token.assetId === confidentialZec.protocolAssetId) ??
      (confidentialZecToken?.assetId === confidentialZec.protocolAssetId
        ? confidentialZecToken
        : undefined))
    : undefined
  const portfolioReadSequence = useRef(0)
  const readLatestPortfolio = useCallback(async () => {
    if (!walletId || !accountId) return
    const sequence = ++portfolioReadSequence.current
    const latest = await readCachedPortfolio({ walletId, accountId })
    if (sequence === portfolioReadSequence.current && latest)
      setPortfolioSnapshot({ scope: balanceScope?.scopeKey, value: latest })
  }, [walletId, accountId, balanceScope?.scopeKey])
  useEffect(() => {
    void readLatestPortfolio().catch(() => {})
    return () => {
      portfolioReadSequence.current += 1
    }
  }, [readLatestPortfolio])
  usePortfolioUpdates(walletId, accountId, readLatestPortfolio)
  useEffect(() => {
    if (!walletId || !accountId || scopedReceiveTargets) return
    let cancelled = false
    void receiveTargetsClient
      .getAdditionalTargets({ keyDomainId: walletId, accountId })
      .then(targets => {
        if (!cancelled) setReceiveTargetsSnapshot({ scope: balanceScope?.scopeKey, value: targets })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [walletId, accountId, balanceScope?.scopeKey, scopedReceiveTargets])
  const balances = useMemo(
    () =>
      balanceScope
        ? buildWalletSwapSourceBalances({
            tokens,
            portfolio: scopedPortfolio,
            receiveTargets: scopedReceiveTargets,
            zcashAvailable: balanceScope.zcashAvailable,
            evmExecutionMode: balanceScope.evmExecutionMode
          })
        : undefined,
    [tokens, scopedPortfolio, scopedReceiveTargets, balanceScope]
  )
  const defaultTokens = useMemo(
    () => selectDefaultSwapTokens(tokens, curatedRows, { balances, customAssets }),
    [tokens, curatedRows, balances, customAssets]
  )
  useEffect(() => {
    let cancelled = false
    void loadTokens(
      next => startTransition(() => setTokens(next)),
      () => cancelled
    )
      .then(next => {
        if (!cancelled) startTransition(() => setTokens(next))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadTokens])
  if (loading && tokens.length === 0) return <ListSkeleton rows={5} label="Loading tokens" />
  return (
    <div className="flex h-full min-h-0 flex-col">
      {confidentialZec && zecToken && /^[1-9]\d*$/.test(confidentialZec.availableRaw) && (
        <button
          type="button"
          onClick={() => onSelectConfidentialZec?.(confidentialZec.assetId)}
          className="flex min-w-0 shrink-0 items-center gap-3 border-b border-white/10 px-3 py-3 text-left hover:bg-card"
        >
          <TokenIcon token={zecToken} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">ZEC</span>
            <span className="block text-xs text-muted">NEAR Confidential</span>
          </span>
          <span className="shrink-0 text-sm tabular-nums">
            {formatTokenQuantity(confidentialZec.amount)}
          </span>
        </button>
      )}
      <TokenSelector
        {...props}
        networkFilterStyle="icons"
        stableCatalogOrder
        tokens={tokens}
        defaultTokens={defaultTokens}
        defaultCatalogLoading={curatedLoading}
        balances={balances}
        catalogLoading={loading}
        onSelect={token => {
          const selected = tokens.find(
            candidate =>
              candidate.assetId === token.assetId && candidate.blockchain === token.blockchain
          )
          if (selected) onSelect(selected, scopedPortfolio)
        }}
      />
    </div>
  )
}
