import { resolveChainIconAlias } from '@/lib/chain-icon'
import { ChainIcon } from '../common/ChainIcon'

interface NetworkOption {
  id: string
  family: string
  displayName: string
}

interface AccountNetworkListProps {
  chains: readonly NetworkOption[]
  selected: readonly string[]
  disabled: boolean
  onAdd: (chainId: string) => void
  onAddAll: () => void
  onRemove?: (chainId: string) => void
  zcashAddress?: string
}

export function AccountNetworkList({
  chains,
  selected,
  disabled,
  onAdd,
  onAddAll,
  onRemove,
  zcashAddress
}: AccountNetworkListProps) {
  const added = chains.filter(chain => selected.includes(chain.id))
  const unadded = chains.filter(chain => !selected.includes(chain.id))
  const renderRow = (chain: NetworkOption, isAdded: boolean) => (
    <div
      key={chain.id}
      className="flex min-h-[71px] items-center gap-3 rounded-lg bg-wallet-surface px-4"
    >
      <ChainIcon
        chain={resolveChainIconAlias(chain.family, chain.displayName, chain.id)}
        showTooltip={false}
        className="size-8 shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium">{chain.displayName}</p>
        {isAdded && chain.family === 'zcash' && zcashAddress && (
          <p className="truncate text-xs text-muted">{zcashAddress}</p>
        )}
      </div>
      {isAdded && !onRemove ? (
        <span className="shrink-0 rounded-md border border-white/20 px-2 py-1 text-sm text-muted">
          Added
        </span>
      ) : (
        <button
          type="button"
          aria-label={isAdded ? `Remove ${chain.displayName}` : `Add ${chain.displayName}`}
          disabled={disabled || (isAdded && selected.length === 1)}
          onClick={() => (isAdded ? onRemove?.(chain.id) : onAdd(chain.id))}
          className={`wallet-interactive min-h-[26px] min-w-[52px] shrink-0 rounded-md px-2 text-sm font-medium ${isAdded ? 'border border-white/20 py-1 text-muted enabled:hover:bg-white/10' : 'bg-[#414152] text-white enabled:hover:bg-white/25'} disabled:cursor-default disabled:opacity-50`}
        >
          {isAdded ? 'Added' : 'Add'}
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      {unadded.length > 0 && (
        <section aria-label="Add networks">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted">Add Networks</h2>
            <button
              type="button"
              disabled={disabled}
              onClick={onAddAll}
              className="wallet-interactive min-h-[26px] rounded-md bg-[#414152] px-2 text-sm font-medium text-white enabled:hover:bg-white/25 disabled:opacity-50"
            >
              Add all
            </button>
          </div>
          <div className="space-y-2">{unadded.map(chain => renderRow(chain, false))}</div>
        </section>
      )}
      {added.length > 0 && (
        <section aria-label="Current networks">
          <h2 className="mb-3 text-sm font-medium text-muted">Currently</h2>
          <div className="space-y-2">{added.map(chain => renderRow(chain, true))}</div>
        </section>
      )}
    </div>
  )
}
