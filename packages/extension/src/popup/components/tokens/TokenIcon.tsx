import { type SwapToken } from '@/core/services/intents-api'
import zecIcon from '@/images/zec.svg'
import usdcIcon from '@/images/usdc.svg'
import { cn } from '@/lib/utils'
import { isBundledWalletAsset } from './token-display-policy'
import { getTokenIconCandidates } from './token-icon-candidates'
import {
  clearTokenIconUrlFailure,
  hasTokenIconUrlFailed,
  recordTokenIconUrlFailure
} from './token-icon-failure-cache'
import { ChainIcon } from '../common/ChainIcon'
import { Icon } from '@iconify/react'
import { useState } from 'react'

interface TokenIconProps {
  token?: SwapToken
  assetId?: string
  symbol?: string
  icon?: string
  blockchain?: string
  nativeChain?: string
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

const bundledTokenIcons: Readonly<Record<string, string>> = Object.freeze({
  USDC: usdcIcon,
  ZEC: zecIcon
})

export function TokenIcon({
  token,
  assetId: assetIdProp,
  symbol: symbolProp,
  icon: iconProp,
  blockchain: blockchainProp,
  nativeChain,
  size = 32,
  className,
  showBadge,
  badgeType
}: TokenIconProps) {
  const symbol = token?.symbol || symbolProp || ''
  const assetId = token?.assetId || assetIdProp
  const blockchain = token?.blockchain || blockchainProp
  const bundledIconForSymbol = bundledTokenIcons[symbol.toUpperCase()]
  const nativeToken =
    (token !== undefined && token.contractAddress == null) || nativeChain !== undefined
  const bundledIcon =
    (assetId && isBundledWalletAsset(assetId)) || nativeToken ? bundledIconForSymbol : undefined
  const iconCandidates = getTokenIconCandidates({
    token,
    icon: iconProp,
    assetId,
    blockchain,
    nativeChain,
    bundledIcon
  })
  const [failedIconUrls, setFailedIconUrls] = useState<readonly string[]>([])
  const iconUrl = iconCandidates.find(
    candidate => !failedIconUrls.includes(candidate) && !hasTokenIconUrlFailed(candidate)
  )

  const pixelSize = typeof size === 'string' ? sizeMap[size] : size

  return (
    <div
      data-slot="token-icon"
      className={cn('relative inline-block', className)}
      style={{ width: pixelSize, height: pixelSize }}
    >
      <div className="flex h-full w-full items-center justify-center rounded-full bg-[#34343f] text-white/80">
        <span
          aria-hidden="true"
          className={cn('font-bold', pixelSize < 32 ? 'text-[10px]' : 'text-sm')}
        >
          {symbol.charAt(0)}
        </span>
      </div>
      {iconUrl && (
        <img
          src={iconUrl}
          alt={symbol}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
          onLoad={() => {
            clearTokenIconUrlFailure(iconUrl)
          }}
          onError={() => {
            recordTokenIconUrlFailure(iconUrl)
            setFailedIconUrls(current =>
              current.includes(iconUrl) ? current : [...current, iconUrl]
            )
          }}
        />
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
