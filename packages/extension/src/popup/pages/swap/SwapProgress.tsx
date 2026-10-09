import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { buildAccountKey } from '@/store/account-data-store'
import { useWalletStore } from '@/store/wallet-store'
import { fetchSwapTokens } from '@/core/services/intents-api'
import { useIntentsProgress } from '../../hooks/useIntentsProgress'
import {
  getIntentsExplorerUrl,
  isIntentsProgressAutoHidden,
  needsZcashDestinationConfirmations,
  shouldAutoRefreshIntentsProgress,
  shouldRefreshIntentsProgressOnOpen,
  type IntentsProgressEntry
} from '@/lib/intents-progress'
import { getIntentsStatusCopy, type TransactionStatusTone } from '@/lib/transaction-status-copy'
import { formatNumber } from '@/lib/format'
import dayjs from '@/lib/dayjs'
import { toast } from '@/store/toast-store'
import { PageHeader } from '../../components/common/PageHeader'
import { TokenIcon } from '../../components/tokens/TokenIcon'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '../../components/ui/dropdown-menu'

const PAGE_POLL_INTERVAL_MS = 15_000

type StatusFilter = IntentsProgressEntry['status'] | 'ALL'

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'PENDING_DEPOSIT', label: 'Waiting for deposit' },
  { value: 'KNOWN_DEPOSIT_TX', label: 'Deposit confirming' },
  { value: 'INCOMPLETE_DEPOSIT', label: 'Deposit amount too low' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'FAILED', label: 'Failed' }
]

function statusToneClasses(tone: TransactionStatusTone): { badge: string; dot: string } {
  if (tone === 'error') {
    return { badge: 'bg-red-500/10 text-red-400', dot: 'bg-red-400' }
  }
  if (tone === 'success') {
    return { badge: 'bg-primary/10 text-primary', dot: 'bg-primary' }
  }
  return { badge: 'bg-yellow-400/10 text-yellow-300', dot: 'bg-yellow-300' }
}

function formatChainName(chain?: string): string | undefined {
  if (!chain) return undefined

  const names: Record<string, string> = {
    arb: 'Arbitrum',
    arbo: 'Arbitrum',
    base: 'Base',
    btc: 'Bitcoin',
    eth: 'Ethereum',
    near: 'NEAR',
    sol: 'Solana',
    zec: 'Zcash'
  }
  return names[chain.toLowerCase()] || chain.toUpperCase()
}

function AssetAmount({
  label,
  amount,
  symbol,
  icon,
  chain,
  align = 'left'
}: {
  label: string
  amount: string
  symbol: string
  icon?: string
  chain?: string
  align?: 'left' | 'right'
}) {
  const chainName = formatChainName(chain)

  return (
    <div className={cn('min-w-0', align === 'right' && 'text-right')}>
      <p className="mb-1.5 text-[9px] font-medium uppercase text-muted/80">{label}</p>
      <div className={cn('flex min-w-0 items-center gap-2.5', align === 'right' && 'justify-end')}>
        {align === 'left' && <TokenIcon symbol={symbol} icon={icon} blockchain={chain} size={32} />}
        <div className="min-w-0">
          <p
            className="truncate text-[17px] font-semibold leading-5 text-foreground"
            title={`${amount} ${symbol}`}
          >
            {formatNumber(amount)}
          </p>
          <p className="mt-0.5 truncate text-[10px] leading-3 text-muted">
            {symbol}
            {chainName && chainName.toLowerCase() !== symbol.toLowerCase()
              ? ` on ${chainName}`
              : ''}
          </p>
        </div>
        {align === 'right' && (
          <TokenIcon symbol={symbol} icon={icon} blockchain={chain} size={32} />
        )}
      </div>
    </div>
  )
}

export function SwapProgress() {
  const currentNetwork = useWalletStore(state => state.currentNetwork)
  const currentWalletId = useWalletStore(state => state.currentWalletId)
  const currentAccountId = useWalletStore(state => state.currentAccountId)
  const accountKey =
    currentWalletId && currentAccountId
      ? buildAccountKey(currentNetwork, currentWalletId, currentAccountId)
      : undefined
  const progress = useIntentsProgress(accountKey)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [tokenIcons, setTokenIcons] = useState<Map<string, string>>(() => new Map())
  const progressRef = useRef<IntentsProgressEntry[]>([])
  const pollInFlightAccountsRef = useRef(new Set<string>())
  const initialPollAccountRef = useRef<string | undefined>(undefined)

  const swapProgress = useMemo(
    () => progress.filter(entry => entry.kind === 'swap').sort((a, b) => b.createdAt - a.createdAt),
    [progress]
  )
  const visibleProgress = swapProgress.filter(entry => !isIntentsProgressAutoHidden(entry))
  const filteredProgress =
    statusFilter === 'ALL'
      ? visibleProgress
      : visibleProgress.filter(entry => entry.status === statusFilter)

  useEffect(() => {
    progressRef.current = swapProgress
  }, [swapProgress])

  useEffect(() => {
    let cancelled = false
    void fetchSwapTokens().then(tokens => {
      if (cancelled) return
      const icons = new Map<string, string>()
      for (const token of tokens) {
        if (token.icon) icons.set(token.assetId, token.icon)
      }
      setTokenIcons(icons)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const pollProgress = useCallback(
    async (refreshOnOpen = false) => {
      if (!accountKey || pollInFlightAccountsRef.current.has(accountKey)) return

      const refreshable = progressRef.current.filter(entry =>
        refreshOnOpen
          ? shouldRefreshIntentsProgressOnOpen(entry)
          : shouldAutoRefreshIntentsProgress(entry) && !isIntentsProgressAutoHidden(entry)
      )
      if (refreshable.length === 0) return

      pollInFlightAccountsRef.current.add(accountKey)
      try {
        await Promise.allSettled(
          refreshable.map(entry =>
            chrome.runtime.sendMessage({
              type: 'REFRESH_INTENTS_PROGRESS',
              accountKey,
              depositAddress: entry.depositAddress
            })
          )
        )
      } finally {
        pollInFlightAccountsRef.current.delete(accountKey)
      }
    },
    [accountKey]
  )

  useEffect(() => {
    if (!accountKey) return
    const interval = window.setInterval(() => void pollProgress(), PAGE_POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [accountKey, pollProgress])

  useEffect(() => {
    if (!accountKey || swapProgress.length === 0 || initialPollAccountRef.current === accountKey) {
      return
    }
    initialPollAccountRef.current = accountKey
    void pollProgress(true)
  }, [accountKey, pollProgress, swapProgress.length])

  const openDetails = (depositAddress: string) => {
    chrome.tabs.create({ url: getIntentsExplorerUrl(depositAddress) }).catch(() => {
      toast.error('Could not open transaction details')
    })
  }

  return (
    <div className="page-container">
      <PageHeader
        title="Swap progress"
        showBack
        rightContent={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Filter swaps: ${STATUS_FILTERS.find(item => item.value === statusFilter)?.label}`}
                title="Filter swaps"
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-content3',
                  statusFilter === 'ALL' ? 'text-muted-foreground' : 'bg-primary/10 text-primary'
                )}
              >
                <Icon icon="lucide:list-filter" className="size-[18px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuRadioGroup
                value={statusFilter}
                onValueChange={value => setStatusFilter(value as StatusFilter)}
              >
                {STATUS_FILTERS.map(filter => {
                  const count =
                    filter.value === 'ALL'
                      ? visibleProgress.length
                      : visibleProgress.filter(entry => entry.status === filter.value).length
                  return (
                    <DropdownMenuRadioItem key={filter.value} value={filter.value}>
                      <span className="min-w-0 flex-1 truncate">{filter.label}</span>
                      <span className="text-xs tabular-nums text-muted">{count}</span>
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredProgress.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <Icon icon="lucide:route" className="mb-3 size-10 text-muted/60" />
              <p className="text-sm font-medium text-foreground">
                {visibleProgress.length === 0
                  ? 'No swap progress yet'
                  : 'No swaps with this status'}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {visibleProgress.length === 0
                  ? 'A swap appears here as soon as its deposit address is created.'
                  : 'Choose another status to see more swaps.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 p-3">
              {filteredProgress.map(entry => {
                const statusCopy = getIntentsStatusCopy(entry.status, {
                  actionName: 'Swap',
                  hasDestinationTxHash: !!entry.destinationChainTxHashes?.length,
                  waitsForZcashConfirmations: needsZcashDestinationConfirmations(entry),
                  destinationConfirmations: entry.destinationConfirmations,
                  requiredConfirmations: entry.destinationRequiredConfirmations
                })
                const quoteExpired =
                  entry.status === 'PENDING_DEPOSIT' &&
                  !!entry.quoteExpiresAt &&
                  entry.quoteExpiresAt <= Date.now()
                const toneClasses = statusToneClasses(statusCopy.tone)

                return (
                  <div
                    key={entry.depositAddress}
                    role="link"
                    tabIndex={0}
                    data-analytics-outbound="intents_explorer"
                    data-analytics-domain="explorer.near-intents.org"
                    data-deposit-address={entry.depositAddress}
                    aria-label={`Open ${entry.tokenInSymbol} to ${entry.tokenOutSymbol} swap details`}
                    onClick={() => openDetails(entry.depositAddress)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openDetails(entry.depositAddress)
                      }
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg border border-white/[0.075] bg-white/[0.025] p-3.5 transition-colors',
                      'hover:border-white/15 hover:bg-white/[0.05] focus-visible:border-primary/50 focus-visible:outline-none'
                    )}
                  >
                    <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
                      <div
                        className={cn(
                          'flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                          toneClasses.badge
                        )}
                      >
                        <span className={cn('size-1.5 shrink-0 rounded-full', toneClasses.dot)} />
                        <span className="truncate">{statusCopy.compactLabel}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted">
                        {dayjs(entry.createdAt).fromNow()}
                      </span>
                    </div>

                    <div className="grid grid-cols-[minmax(0,1fr)_30px_minmax(0,1fr)] items-end gap-2">
                      <AssetAmount
                        label="From"
                        amount={entry.amountIn}
                        symbol={entry.tokenInSymbol}
                        icon={
                          entry.tokenInIcon ||
                          (entry.originAsset ? tokenIcons.get(entry.originAsset) : undefined)
                        }
                        chain={entry.originChain}
                      />
                      <span
                        aria-hidden="true"
                        className="mb-1 flex size-7 items-center justify-center justify-self-center rounded-full border border-white/[0.08] bg-background text-sm text-muted"
                      >
                        &rarr;
                      </span>
                      <AssetAmount
                        label="To"
                        amount={entry.actualAmountOut || entry.amountOut}
                        symbol={entry.tokenOutSymbol}
                        icon={
                          entry.tokenOutIcon ||
                          (entry.destinationAsset
                            ? tokenIcons.get(entry.destinationAsset)
                            : undefined)
                        }
                        chain={entry.destinationChain}
                        align="right"
                      />
                    </div>

                    {quoteExpired && (
                      <p className="mt-3 flex items-center gap-1.5 text-[10px] text-yellow-300">
                        <Icon icon="lucide:clock-alert" className="size-3.5" />
                        Quote expired
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
