import { Icon } from '@iconify/react'
import { safeBig } from '@/lib/big'
import { summarizeUnconfirmedTransactions } from '@/lib/unconfirmed-transactions'
import { useAccountDataStore } from '@/store/account-data-store'
import type { FundingSource } from '@/types'

const COPY = {
  untrusted:
    'You have some unconfirmed transactions. If the sender is untrusted, you may incur a loss.',
  incoming: 'Incoming funds are still confirming. A new transaction may fail.',
  outgoing: 'A sent transaction is still confirming. A new transaction may fail.',
  both: 'Transactions are still confirming. A new transaction may fail.',
  generic: 'Some funds are still confirming. A new transaction may fail.'
} as const

export function UnconfirmedTransactionWarning({
  className = '',
  suppressGeneric = false,
  spendRiskOnly = false,
  usesPendingFunds = false,
  fundingSource
}: {
  className?: string
  suppressGeneric?: boolean
  spendRiskOnly?: boolean
  usesPendingFunds?: boolean
  fundingSource?: FundingSource
}) {
  const transactions = useAccountDataStore(state => state.getCurrentTransactions())
  const balance = useAccountDataStore(state => state.getCurrentBalance())
  const pendingBalance = fundingSource ? balance?.pending?.[fundingSource] : balance?.pending?.total
  const summary = summarizeUnconfirmedTransactions(
    transactions,
    safeBig(pendingBalance ?? '0').gt(0),
    fundingSource
  )

  let kind: keyof typeof COPY
  if (spendRiskOnly) {
    if (!summary.hasSpendableUntrustedIncoming && !usesPendingFunds) return null
    kind = summary.hasSpendableUntrustedIncoming ? 'untrusted' : 'generic'
  } else {
    if (summary.kind === 'none' || (suppressGeneric && summary.kind === 'generic')) return null
    kind = summary.kind
  }

  const message =
    spendRiskOnly && kind === 'generic'
      ? 'Some funds are still confirming, so this transaction may fail.'
      : COPY[kind]
  const tone = spendRiskOnly || kind === 'untrusted' ? 'text-warning/90' : 'text-muted'

  return (
    <div className={`flex items-center gap-2 px-1 ${tone} ${className}`} role="status">
      <Icon icon="lucide:clock-3" className="size-3.5 shrink-0" />
      <p className="min-w-0 text-[11px] leading-4">{message}</p>
    </div>
  )
}
