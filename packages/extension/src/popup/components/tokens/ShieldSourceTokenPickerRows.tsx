import { useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { formatSymbol } from '@/lib/format'
import { formatBaseUnitDecimalAmount, formatTokenQuantity } from '@/lib/number-format'
import { TokenIcon } from './TokenIcon'
import { partitionShieldSourceTokenRows } from './shield-source-token-groups'
import { cn } from '@/lib/utils'

export interface ShieldSourceTokenPickerItem {
  readonly key: string
  readonly assetId: string
  readonly symbol: string
  readonly iconUrl?: string
  readonly chainName?: string
  readonly badgeBlockchain?: string
  readonly availableRaw: string
  readonly decimals: number
  readonly disabledReason?: string
}

export function ShieldSourceTokenPickerRows({
  items,
  balancesHidden,
  selectedAssetId,
  onSelect
}: {
  readonly items: readonly ShieldSourceTokenPickerItem[]
  readonly balancesHidden: boolean
  readonly selectedAssetId?: string
  readonly onSelect: (assetId: string) => void
}) {
  const [lowBalanceExpanded, setLowBalanceExpanded] = useState(true)
  const { funded, lowBalance } = partitionShieldSourceTokenRows(
    items.map(item => Object.freeze({ item, availableRaw: item.availableRaw }))
  )
  const renderRow = (item: ShieldSourceTokenPickerItem) => (
    <button
      key={item.key}
      type="button"
      disabled={Boolean(item.disabledReason)}
      title={item.disabledReason}
      onClick={() => onSelect(item.assetId)}
      aria-pressed={selectedAssetId === item.assetId}
      className={cn(
        'wallet-interactive flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-wallet-selected active:bg-white/15 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
        selectedAssetId === item.assetId && 'bg-wallet-selected'
      )}
    >
      <TokenIcon
        assetId={item.assetId}
        symbol={formatSymbol(item.symbol)}
        icon={item.iconUrl}
        blockchain={item.badgeBlockchain}
        size={30}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{formatSymbol(item.symbol)}</span>
        {item.chainName && (
          <span className="block truncate text-xs text-muted">{item.chainName}</span>
        )}
      </span>
      <span
        className="max-w-[42%] min-w-0 shrink-0 text-right"
        title={
          balancesHidden ? undefined : formatBaseUnitDecimalAmount(item.availableRaw, item.decimals)
        }
      >
        <span className="block truncate text-sm tabular-nums">
          {balancesHidden
            ? '••••'
            : formatTokenQuantity(formatBaseUnitDecimalAmount(item.availableRaw, item.decimals))}
        </span>
      </span>
    </button>
  )

  return (
    <div className="space-y-1">
      {funded.map(renderRow)}
      {lowBalance.length > 0 && (
        <ClientSection
          expanded={lowBalanceExpanded}
          count={lowBalance.length}
          onToggle={() => setLowBalanceExpanded(current => !current)}
        >
          {lowBalance.map(renderRow)}
        </ClientSection>
      )}
    </div>
  )
}

function ClientSection({
  expanded,
  count,
  onToggle,
  children
}: {
  readonly expanded: boolean
  readonly count: number
  readonly onToggle: () => void
  readonly children: ReactNode
}) {
  return (
    <section className="pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="wallet-interactive flex w-full items-center gap-2 px-2 py-2 text-left text-sm text-muted hover:text-foreground"
      >
        <span className="min-w-0 flex-1">Low balance tokens ({count})</span>
        <Icon
          icon="lucide:chevron-up"
          width={16}
          height={16}
          className={cn('shrink-0 transition-transform', !expanded && 'rotate-180')}
        />
      </button>
      {expanded && <div className="space-y-1">{children}</div>}
    </section>
  )
}
