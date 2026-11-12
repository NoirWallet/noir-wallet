import { type SwapToken } from '@/core/services/intents-api'
import zecIcon from '@/images/zec.svg'
import usdcIcon from '@/images/usdc.svg'
import ethIcon from '@/images/eth.svg'
import { cn } from '@/lib/utils'
import { formatSymbol } from '@/lib/format'
import { findBundledWalletMarketAssetId, isBundledWalletAsset } from './token-display-policy'
import { MARKET_ASSETS } from '@/config/asset-market-assets'
import { formatConfiguredChainIconUrl } from '@/config/icons'
import { getTokenIconCandidates, isBundledEthIconIdentity } from './token-icon-candidates'
import {
  clearTokenIconUrlFailure,
  hasTokenIconUrlFailed,
  recordTokenIconUrlFailure
} from './token-icon-failure-cache'
import { ChainIcon } from '../common/ChainIcon'
import { Icon } from '@iconify/react'
import { useEffect, useRef, useState } from 'react'
import {
  lookupTokenContractIcon,
  resolveAssetIdContractIconIdentity,
  resolveTokenContractIconIdentity
} from '@/popup/services/token-contract-icon'

interface TokenIconProps {
  token?: SwapToken
  assetId?: string
  symbol?: string
  icon?: string
  blockchain?: string
  nativeChain?: string
  size?: number | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showChainBadge?: boolean
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
  showChainBadge = true,
  showBadge,
  badgeType
}: TokenIconProps) {
  const symbol = formatSymbol(token?.symbol || symbolProp)
  const assetId = token?.assetId || assetIdProp
  const blockchain = token?.blockchain || blockchainProp
  const bundledIconForSymbol = bundledTokenIcons[symbol.toUpperCase()]
  const marketAsset = assetId ? findBundledWalletMarketAssetId(assetId) : null
  const mappedIcon = isBundledEthIconIdentity(assetId, token)
    ? ethIcon
    : marketAsset === MARKET_ASSETS.usdc
      ? usdcIcon
      : marketAsset === MARKET_ASSETS.zec
        ? zecIcon
        : marketAsset === MARKET_ASSETS.bnb
          ? formatConfiguredChainIconUrl('bsc')
          : undefined
  const nativeToken =
    (token !== undefined && token.contractAddress == null) || nativeChain !== undefined
  const bundledIcon =
    mappedIcon ??
    ((assetId && isBundledWalletAsset(assetId)) || nativeToken ? bundledIconForSymbol : undefined)
  const contractIdentity =
    (token ? resolveTokenContractIconIdentity(token) : null) ??
    resolveAssetIdContractIconIdentity(assetId)
  const [contractIcon, setContractIcon] = useState<{
    identity: string
    icon: string
  } | null>(null)
  const iconCandidates = getTokenIconCandidates({
    token,
    icon: iconProp,
    assetId,
    blockchain,
    nativeChain,
    bundledIcon,
    contractIcon: contractIcon?.identity === contractIdentity ? contractIcon.icon : undefined
  })
  const [failedIconUrls, setFailedIconUrls] = useState<readonly string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const iconUrl = iconCandidates.find(
    candidate => !failedIconUrls.includes(candidate) && !hasTokenIconUrlFailed(candidate)
  )

  useEffect(() => {
    const element = containerRef.current
    if (iconUrl || !contractIdentity || !element) return
    let cancelled = false
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      void lookupTokenContractIcon(contractIdentity, () => !cancelled).then(icon => {
        if (!cancelled && icon) setContractIcon({ identity: contractIdentity, icon })
      })
    })
    observer.observe(element)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [contractIdentity, iconUrl])

  const pixelSize = typeof size === 'string' ? sizeMap[size] : size

  return (
    <div
      data-slot="token-icon"
      ref={containerRef}
      className={cn('relative inline-block shrink-0', className)}
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
      {showChainBadge && blockchain && (
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
