import { Icon } from '@iconify/react'
import { ExecutionAccountBadge } from './ExecutionAccountSelector'

export function AccountDomainBadge({
  domain,
  chainFamily
}: {
  readonly domain: 'public' | 'private' | 'shield'
  readonly chainFamily?: 'zcash' | 'evm'
}) {
  if (domain === 'public' && chainFamily === 'zcash') {
    return (
      <span className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-muted">
        <Icon icon="noir:public-assets" width={11} height={11} />
        Transparent
      </span>
    )
  }
  if (domain !== 'shield') {
    return <ExecutionAccountBadge mode={domain === 'private' ? 'private' : 'main'} />
  }
  return (
    <span className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-success">
      <Icon icon="noir:shield-assets" width={11} height={11} />
      Shield
    </span>
  )
}
