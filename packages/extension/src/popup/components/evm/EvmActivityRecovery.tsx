import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@iconify/react'
import type { ActivityItem, ActivityScope } from '@/core/activity'
import { resolveEvmNetworkCatalog } from '@/core/chains/evm-runtime-config'
import { resolveChainIconAlias } from '@/lib/chain-icon'
import { formatBaseUnitAmount } from '@/lib/number-format'
import { useEvmActivityRecovery } from '@/popup/hooks/useEvmActivityRecovery'
import type { AccountNetworkView } from '@/popup/services/account-networks-client'
import { isSelectableChainFamily } from '@/popup/services/chain-selection-availability'
import type { EvmActivityRecoveryTarget } from '@/popup/services/evm-activity-recovery'
import { useSettingsStore } from '@/store/settings-store'
import type { Network } from '@/types'
import { ChainIcon } from '../common/ChainIcon'
import { ChainSelector } from '../common/ChainSelector'
import { InlineError } from '../common/InlineError'
import {
  TransactionActionReview,
  TransactionActionRow,
  TransactionActionRows
} from '../transaction/TransactionActionReview'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../ui/dialog'

interface RecoveryNetwork {
  readonly chainId: string
  readonly name: string
  readonly icon: string
  readonly address: string
  readonly currency: { readonly symbol: string; readonly decimals: number }
}

function EvmRecoveryQueue({
  target,
  network,
  networkControl,
  onItemClick
}: {
  readonly target: EvmActivityRecoveryTarget
  readonly network: RecoveryNetwork
  readonly networkControl: ReactNode
  readonly onItemClick: (item: ActivityItem) => void
}) {
  const { queue, review, busy, error, outcome, check, retry, prepare, back, approve } =
    useEvmActivityRecovery(target)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reviewing = review !== null
  const wasReviewing = useRef(false)
  useLayoutEffect(() => {
    if (wasReviewing.current !== reviewing) titleRef.current?.focus()
    wasReviewing.current = reviewing
  }, [reviewing])

  const canRetry = queue?.recovery?.action === 'retry-broadcast'
  const canReview = queue?.recovery?.action === 'fill-gap'
  const primaryAction = canRetry ? 'retry' : canReview ? 'prepare' : 'check'
  const status =
    outcome ??
    (busy === 'approve' ? 'Submitting recovery…' : null) ??
    (queue?.recovery === null && !queue.unavailable && queue.pending.length === 0
      ? 'No nonce recovery needed.'
      : null)

  return (
    <>
      <DialogTitle
        ref={titleRef}
        tabIndex={-1}
        className="shrink-0 px-4 pt-5 pb-4 pr-14 leading-6 outline-none"
      >
        {review ? 'Review recovery' : 'Recover transaction'}
      </DialogTitle>
      {review ? (
        <div className="flex min-h-0 flex-col px-4 pb-5">
          <TransactionActionReview
            notice="This sends a zero-amount transaction to your own address and requires a network fee."
            onBack={back}
            confirmLabel="Confirm recovery"
            onConfirm={() => void approve()}
          >
            <TransactionActionRows>
              <TransactionActionRow label="Network">{network.name}</TransactionActionRow>
              <TransactionActionRow label="Nonce">{review.nonce}</TransactionActionRow>
              <TransactionActionRow label="Maximum network fee">
                {formatBaseUnitAmount(review.maximumFeeWei, network.currency.decimals)}{' '}
                {network.currency.symbol}
              </TransactionActionRow>
            </TransactionActionRows>
          </TransactionActionReview>
        </div>
      ) : (
        <>
          <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4">
            {networkControl}
            {error && <InlineError message={<span>{error}</span>} />}
            {queue?.unavailable && (
              <InlineError
                message="Unable to verify the transaction queue."
                tone="warning"
                role="alert"
              />
            )}
            {status && (
              <p role="status" className="text-sm text-muted">
                {status}
              </p>
            )}
            {queue?.pending.length ? (
              <div className="divide-y divide-border overflow-hidden rounded-lg bg-wallet-surface">
                {queue.pending.map(item => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    className="h-12 w-full justify-start gap-2 rounded-none px-3 text-left focus-visible:ring-inset"
                    disabled={busy !== null}
                    onClick={() => onItemClick(item)}
                  >
                    <Icon icon="lucide:history" className="size-4 text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">View pending transaction</span>
                    <span className="text-xs tabular-nums text-muted">
                      Nonce {item.snapshot?.evm?.nonce}
                    </span>
                    <Icon
                      icon="lucide:chevron-right"
                      className="size-3.5 text-muted"
                      aria-hidden="true"
                    />
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 px-4 pb-5">
            <Button
              type="button"
              size="wallet"
              className="w-full"
              disabled={busy !== null}
              isLoading={busy === primaryAction}
              onClick={() => void (canRetry ? retry() : canReview ? prepare() : check())}
            >
              {canRetry
                ? 'Retry broadcast'
                : canReview
                  ? 'Review recovery'
                  : 'Check transaction queue'}
            </Button>
            {primaryAction !== 'check' && (
              <Button
                type="button"
                size="sm"
                variant="link"
                className="text-muted hover:text-foreground"
                disabled={busy !== null}
                isLoading={busy === 'check'}
                onClick={() => void check()}
              >
                Check again
              </Button>
            )}
          </div>
        </>
      )}
    </>
  )
}

export function EvmActivityRecovery({
  scope,
  network,
  executionMode,
  accountNetworks,
  onItemClick
}: {
  readonly scope: ActivityScope
  readonly network: Network
  readonly executionMode: 'main' | 'private'
  readonly accountNetworks: readonly AccountNetworkView[]
  readonly onItemClick: (item: ActivityItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [networkPickerOpen, setNetworkPickerOpen] = useState(false)
  const [chainId, setChainId] = useState('')
  const networkButtonRef = useRef<HTMLButtonElement>(null)
  const endpointSettings = useSettingsStore(state => state.chainEndpointSettings)
  if (!isSelectableChainFamily('evm', __ENABLED_CHAIN_FEATURE_FLAGS__)) return null
  const catalog = resolveEvmNetworkCatalog(network, endpointSettings)
  const networks = accountNetworks.flatMap((entry): RecoveryNetwork[] => {
    const { transaction } = entry.chain.capabilities
    if (
      entry.chain.family !== 'evm' ||
      transaction.status !== 'available' ||
      !transaction.actions.includes('native-transfer') ||
      !transaction.actions.includes('token-transfer')
    ) {
      return []
    }
    const config = catalog.find(candidate => candidate.chainId === entry.chain.id)
    const address =
      executionMode === 'private'
        ? entry.privateExecutionAddress
        : entry.addresses.find(candidate => candidate.preferredForReceive)?.value
    return config && address
      ? [
          {
            chainId: entry.chain.id,
            name: entry.chain.displayName,
            icon: resolveChainIconAlias('evm', entry.chain.displayName, entry.chain.id),
            address,
            currency: config.nativeCurrency
          }
        ]
      : []
  })
  const selected = networks.find(entry => entry.chainId === chainId)
  if (networks.length === 0) return null

  const updateOpen = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setChainId('')
      setNetworkPickerOpen(false)
    }
  }

  const networkControl = (
    <Button
      ref={networkButtonRef}
      type="button"
      variant="ghost"
      aria-haspopup="dialog"
      aria-expanded={networkPickerOpen}
      className="h-12 w-full justify-between rounded-lg bg-wallet-surface px-3"
      onClick={() => setNetworkPickerOpen(true)}
    >
      <span className="text-muted">Network</span>
      <span className="flex min-w-0 items-center gap-2">
        {selected && (
          <span className="flex shrink-0" aria-hidden="true">
            <ChainIcon chain={selected.icon} width={20} height={20} showTooltip={false} />
          </span>
        )}
        <span className="truncate">{selected?.name ?? 'Select network'}</span>
        <Icon icon="lucide:chevron-down" className="size-4 text-muted" aria-hidden="true" />
      </span>
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={updateOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="rounded-lg text-[13px] text-wallet-secondary hover:bg-wallet-selected"
        >
          <Icon icon="lucide:history" className="size-4" aria-hidden="true" />
          Recover transaction
        </Button>
      </DialogTrigger>
      <DialogContent position="bottom" scroll="body" className="gap-0 p-0">
        <DialogDescription className="sr-only">
          Check the transaction queue on a network.
        </DialogDescription>
        {selected ? (
          <EvmRecoveryQueue
            key={JSON.stringify([selected.chainId, selected.address])}
            target={{
              scope,
              chainId: selected.chainId,
              address: selected.address,
              executionMode
            }}
            network={selected}
            networkControl={networkControl}
            onItemClick={item => {
              updateOpen(false)
              onItemClick(item)
            }}
          />
        ) : (
          <>
            <DialogTitle className="px-4 pt-5 pb-4 pr-14 leading-6">
              Recover transaction
            </DialogTitle>
            <div className="space-y-4 px-4 pb-5">
              {networkControl}
              <Button
                type="button"
                size="wallet"
                className="w-full disabled:bg-wallet-surface disabled:text-muted disabled:opacity-100"
                disabled
              >
                Check transaction queue
              </Button>
            </div>
          </>
        )}
        <ChainSelector
          open={open && networkPickerOpen}
          onOpenChange={setNetworkPickerOpen}
          onCloseAutoFocus={event => {
            if (!networkButtonRef.current) return
            event.preventDefault()
            networkButtonRef.current.focus()
          }}
          options={networks.map(entry => ({
            id: entry.chainId,
            name: entry.name,
            icon: entry.icon
          }))}
          selectedId={selected?.chainId}
          onSelect={setChainId}
        />
      </DialogContent>
    </Dialog>
  )
}
