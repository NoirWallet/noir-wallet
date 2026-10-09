import type { SwapToken } from '@/core/services/intents-api'
import { formatChainName, formatSymbol } from '@/lib/format'
import { cn } from '@/lib/utils'
import { TokenIcon } from './TokenIcon'

interface TokenIdentityProps {
  token: SwapToken
  iconSize?: number
  className?: string
}

export function TokenIdentity({ token, iconSize = 32, className }: TokenIdentityProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <TokenIcon token={token} size={iconSize} className="shrink-0" />
      <div className="min-w-0 text-left leading-tight">
        <p className="truncate text-sm font-semibold">{formatSymbol(token.symbol)}</p>
        <p className="truncate text-[11px] text-muted">{formatChainName(token.blockchain)}</p>
      </div>
    </div>
  )
}
