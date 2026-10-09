import { formatChainIconUrl, formatChainName } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ChainIconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  chain: string
  showTooltip?: boolean
}

export function ChainIcon({ chain, className, showTooltip = true, alt, ...props }: ChainIconProps) {
  const chainName = formatChainName(chain)

  return (
    <img
      src={formatChainIconUrl(chain)}
      alt={alt || chainName}
      className={cn('object-cover', className)}
      crossOrigin="anonymous"
      title={showTooltip ? chainName : undefined}
      {...props}
    />
  )
}
