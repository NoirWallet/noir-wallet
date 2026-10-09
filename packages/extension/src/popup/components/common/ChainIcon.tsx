import { formatChainIconUrl } from '@/lib/chain-icon'
import { formatChainName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useState } from 'react'

interface ChainIconProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  chain: string
  showTooltip?: boolean
}

export function ChainIcon({
  chain,
  className,
  showTooltip = true,
  alt,
  crossOrigin,
  onLoad,
  onError,
  ...props
}: ChainIconProps) {
  const chainName = formatChainName(chain)
  const iconUrl = formatChainIconUrl(chain)
  const [loadedIconUrl, setLoadedIconUrl] = useState<string | null>(null)
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null)
  const isLoaded = loadedIconUrl === iconUrl
  const hasFailed = failedIconUrl === iconUrl

  return (
    <img
      src={hasFailed ? undefined : iconUrl}
      alt={alt || chainName}
      crossOrigin={crossOrigin}
      className={cn(
        'bg-card object-cover',
        !isLoaded && !hasFailed && 'animate-pulse',
        hasFailed && 'text-transparent opacity-60',
        className
      )}
      title={showTooltip ? chainName : undefined}
      onLoad={event => {
        setLoadedIconUrl(iconUrl)
        onLoad?.(event)
      }}
      onError={event => {
        setFailedIconUrl(iconUrl)
        onError?.(event)
      }}
      {...props}
    />
  )
}
