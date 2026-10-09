import { type SwapToken } from '@/core/services/intents-api'
import zecIcon from '@/images/zec.svg'
import { cn } from '@/lib/utils'
import { ChainIcon } from '../common/ChainIcon'
import { Icon } from '@iconify/react'

interface TokenIconProps {
  token?: SwapToken
  symbol?: string
  icon?: string
  blockchain?: string
  size?: number | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showBadge?: boolean
  badgeType?: 'send' | 'receive'
}

const sizeMap = {
  sm: 24,
  md: 32,
  lg: 40,
  xl: 64
}

export function TokenIcon({
  token,
  symbol: symbolProp,
  icon: iconProp,
  blockchain: blockchainProp,
  size = 32,
  className,
  showBadge,
  badgeType
}: TokenIconProps) {
  const symbol = token?.symbol || symbolProp || ''
  const iconUrl = token?.icon || iconProp || (symbol === 'ZEC' ? zecIcon : undefined)
  const blockchain = token?.blockchain || blockchainProp

  const pixelSize = typeof size === 'string' ? sizeMap[size] : size

  return (
    <div
      className={cn('relative inline-block', className)}
      style={{ width: pixelSize, height: pixelSize }}
    >
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={symbol}
          className="w-full h-full rounded-full object-cover"
          crossOrigin="anonymous"
        />
      ) : (
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
          <span className={cn('font-bold', pixelSize < 32 ? 'text-[10px]' : 'text-sm')}>
            {symbol.charAt(0)}
          </span>
        </div>
      )}

      {/* Chain badge for SwapToken context */}
      {blockchain && (
        <ChainIcon
          chain={blockchain}
          className="absolute -bottom-0.5 -right-0.5 w-[45%] h-[45%] rounded-full border border-black bg-white"
        />
      )}

      {/* Status/Direction badge for Transaction context */}
      {showBadge && badgeType && (
        <div
          className={cn(
            'absolute -bottom-0.5 -right-0.5 rounded-full bg-primary flex items-center justify-center text-black font-bold z-10 border border-[#141416]',
            pixelSize <= 24
              ? 'w-3 h-3 text-[8px]'
              : pixelSize <= 32
                ? 'w-4 h-4 text-[10px]'
                : 'w-6 h-6 text-xs'
          )}
        >
          <Icon
            icon={badgeType === 'receive' ? 'radix-icons:arrow-bottom-left' : 'lucide:send'}
            className="size-4"
          />
        </div>
      )}
    </div>
  )
}
