import type { Network } from '@/types'
import { getTransparentAddressPath, getZip32AccountPath } from '@/lib/zcash-derivation'
import { cn } from '@/lib/utils'

interface AccountDerivationPathsProps {
  network: Network
  accountIndex: number
  transparentAddressIndex?: number
  className?: string
}

export function AccountDerivationPaths({
  network,
  accountIndex,
  transparentAddressIndex,
  className
}: AccountDerivationPathsProps) {
  return (
    <div className={cn('space-y-1.5 text-xs', className)}>
      <p className="text-muted">
        Account path{' '}
        <span className="font-mono text-foreground">
          {getZip32AccountPath(network, accountIndex)}
        </span>
      </p>
      {transparentAddressIndex !== undefined && (
        <p className="text-muted">
          Primary transparent address{' '}
          <span className="font-mono text-foreground">
            {getTransparentAddressPath(network, accountIndex, transparentAddressIndex)}
          </span>
        </p>
      )}
    </div>
  )
}
