import { Icon } from '@iconify/react'

import type { DAppExecutionMode, DAppExecutionModeState } from '@/core/dapp/dapp-execution-mode'
import type { DAppPrivateExecutionSupportSummary } from '@/core/dapp/dapp-manager'
import { formatPrice } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  ExecutionAccountOptionRow,
  PrivateExecutionModeIconButton
} from '@/popup/components/account/ExecutionAccountSelector'
import { dappExecutionScopeLabel } from '@/popup/services/dapp-execution-mode-presentation'
import { Skeleton } from '@/popup/components/ui/skeleton'

interface DAppExecutionModeButtonProps {
  readonly state: DAppExecutionModeState | null
  readonly loading: boolean
  readonly updating: boolean
  readonly onClick: () => void
}

export function DAppExecutionModeButton({
  state,
  loading,
  updating,
  onClick
}: DAppExecutionModeButtonProps) {
  const privateMode = state?.mode === 'private'
  const modeLabel = privateMode ? 'Confidential' : 'Public'

  return (
    <PrivateExecutionModeIconButton
      mode={privateMode ? 'private' : 'main'}
      ariaLabel={`dApp address: ${modeLabel}`}
      title={`dApp address: ${modeLabel}`}
      busy={loading || updating}
      disabled={updating || (!state && !loading)}
      onClick={onClick}
    />
  )
}

interface DAppExecutionModeCardProps {
  readonly connectionSummary: DAppPrivateExecutionSupportSummary
  readonly state: DAppExecutionModeState | null
  readonly loading: boolean
  readonly connectionsLoading: boolean
  readonly updating: boolean
  readonly error: string | null
  readonly mainTotalUsd?: string
  readonly privateTotalUsd?: string
  readonly mainAddress?: string
  readonly privateAddress?: string
  readonly balancesLoading?: boolean
  readonly balancesHidden?: boolean
  readonly onSelectMode: (mode: DAppExecutionMode) => void
}

export function DAppExecutionModeCard({
  connectionSummary,
  state,
  loading,
  connectionsLoading,
  updating,
  error,
  mainTotalUsd,
  privateTotalUsd,
  mainAddress,
  privateAddress,
  balancesLoading = false,
  balancesHidden = false,
  onSelectMode
}: DAppExecutionModeCardProps) {
  const unavailableReason = state?.privateAvailable
    ? undefined
    : 'Confidential is not available for this wallet.'
  const scopeLabel = dappExecutionScopeLabel(connectionSummary)

  return (
    <section
      data-testid="dapp-execution-mode-card"
      aria-label="Connected dApp account mode"
      className="pb-1"
    >
      <div
        role="radiogroup"
        aria-label="Address shared with connected dApps"
        aria-busy={loading || updating}
        className="space-y-2"
      >
        {(['main', 'private'] as const).map(mode => {
          const selected = state?.mode === mode
          const disabled =
            loading || updating || !state || (mode === 'private' && !state.privateAvailable)
          const label = mode === 'main' ? 'Public account' : 'Confidential account'
          const totalUsd =
            mode === 'main' ? mainTotalUsd : state?.privateAvailable ? privateTotalUsd : undefined
          return (
            <div key={mode} title={mode === 'private' ? unavailableReason : undefined}>
              <ExecutionAccountOptionRow
                mode={mode}
                selected={selected}
                label={label}
                address={mode === 'main' ? mainAddress : privateAddress}
                unavailableLabel={
                  disabled && mode === 'private' ? 'Not available' : 'Address unavailable'
                }
                ariaLabel={
                  mode === 'main'
                    ? 'Use Public address for dApps'
                    : 'Use Confidential address for dApps'
                }
                disabled={disabled}
                locked={mode === 'private' && !state?.privateAvailable}
                onClick={() => onSelectMode(mode)}
                detail={
                  totalUsd !== undefined ? (
                    balancesLoading ? (
                      <Skeleton className="h-3 w-12 shrink-0" />
                    ) : (
                      <span
                        data-testid={`${mode}-address-total`}
                        className="max-w-[30%] shrink-0 truncate text-right font-mono text-[11px] leading-4 text-muted"
                        title={
                          balancesHidden ? undefined : formatPrice(totalUsd, { showSign: true })
                        }
                      >
                        {balancesHidden
                          ? '••••'
                          : formatPrice(totalUsd, { showSign: true, useUnit: true })}
                      </span>
                    )
                  ) : (
                    <span className="shrink-0 text-[11px] leading-4 text-muted">-</span>
                  )
                }
              />
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
        <Icon
          icon="lucide:info"
          width={14}
          height={14}
          className={cn('mt-px shrink-0', error ? 'text-danger' : 'text-muted')}
        />
        <p className={cn('min-w-0 text-[11px] leading-4', error ? 'text-danger' : 'text-muted')}>
          {loading
            ? 'Loading account…'
            : error || (connectionsLoading ? 'Loading connected dApps…' : scopeLabel)}
        </p>
      </div>
    </section>
  )
}
