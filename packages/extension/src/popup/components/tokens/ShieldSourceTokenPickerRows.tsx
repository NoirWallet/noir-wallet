import { useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { formatSymbol } from '@/lib/format'
import { formatBaseUnitDecimalAmount, formatTokenQuantity } from '@/lib/number-format'
import { TokenIcon } from './TokenIcon'
import { partitionShieldSourceTokenRows } from './shield-source-token-groups'
import { TokenSelectionList, type TokenSelectionItem } from './TokenSelectionList'
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
  const toSelectionItem = (item: ShieldSourceTokenPickerItem): TokenSelectionItem => {
    const balance = formatBaseUnitDecimalAmount(item.availableRaw, item.decimals)
    return {
      key: item.key,
      symbol: formatSymbol(item.symbol),
      icon: (
        <TokenIcon
          assetId={item.assetId}
          symbol={formatSymbol(item.symbol)}
          icon={item.iconUrl}
          blockchain={item.badgeBlockchain}
          size={30}
        />
      ),
      subtitle: item.chainName,
      balance: (
        <span className="block truncate text-sm tabular-nums">
          {balancesHidden ? '••••' : formatTokenQuantity(balance)}
        </span>
      ),
      balanceTitle: balancesHidden ? undefined : balance,
      disabledReason: item.disabledReason
    }
  }
  const selectedKey = items.find(item => item.assetId === selectedAssetId)?.key
  const selectKey = (key: string) => {
    const selected = items.find(item => item.key === key)
    if (selected) onSelect(selected.assetId)
  }

  return (
    <div className="space-y-1">
      <TokenSelectionList
        items={funded.map(toSelectionItem)}
        selectedKey={selectedKey}
        onSelect={selectKey}
        variant="source"
        className="space-y-1"
      />
      {lowBalance.length > 0 && (
        <ClientSection
          expanded={lowBalanceExpanded}
          count={lowBalance.length}
          onToggle={() => setLowBalanceExpanded(current => !current)}
        >
          <TokenSelectionList
            items={lowBalance.map(toSelectionItem)}
            selectedKey={selectedKey}
            onSelect={selectKey}
            variant="source"
            className="space-y-1"
          />
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
