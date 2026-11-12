import { Icon } from '@iconify/react'
import type { MultisigThreshold } from '@/core/multisig/types'
import { Pill } from './Pill'

interface MultisigBadgeProps {
  threshold: MultisigThreshold
}

/** Shield badge marking a multisig account, labelled with its threshold such as `2/3`. */
export function MultisigBadge({ threshold }: MultisigBadgeProps) {
  // '2-of-3' -> '2/3'
  const label = threshold.replace('-of-', '/')

  return (
    <Pill tone="primary">
      <Icon icon="lucide:shield" width={12} height={12} aria-hidden="true" />
      <span className="sr-only">Multisig </span>
      {label}
    </Pill>
  )
}
