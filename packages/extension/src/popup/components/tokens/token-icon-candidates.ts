import type { SwapToken } from '@/core/services/intents-api'

interface TokenIconCandidateInput {
  readonly token?: Pick<SwapToken, 'blockchain' | 'contractAddress' | 'icon' | 'coingeckoIcon'>
  readonly icon?: string
  readonly assetId?: string
  readonly blockchain?: string
  readonly nativeChain?: string
  readonly bundledIcon?: string
}

function isCoinGeckoIconUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    return new URL(value).hostname === 'coin-images.coingecko.com'
  } catch {
    return false
  }
}

function isPublicIpfsIconUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'ipfs:' ||
      url.pathname.toLowerCase().includes('/ipfs/') ||
      url.hostname === 'ipfs.io' ||
      url.hostname.startsWith('ipfs.') ||
      url.hostname.includes('.ipfs.') ||
      url.hostname === 'cloudflare-ipfs.com' ||
      url.hostname === 'dweb.link' ||
      url.hostname === 'gateway.pinata.cloud' ||
      url.hostname === 'nftstorage.link'
    )
  } catch {
    return false
  }
}

function isRetiredIconSource(value: string, depth = 0): boolean {
  if (depth > 3) return true
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (host === 'trustwallet.com' || host.endsWith('.trustwallet.com')) return true
    if (
      ['github.com', 'raw.githubusercontent.com', 'cdn.jsdelivr.net'].includes(host) &&
      /(?:^|\/)trustwallet\/assets(?:@|\/|$)/i.test(url.pathname)
    )
      return true
    // Previously cached history icons can wrap the original URL in our proxy.
    const source = url.searchParams.get('source')
    return source ? isRetiredIconSource(source, depth + 1) : false
  } catch {
    return false
  }
}

export function getTokenIconCandidates({
  token,
  icon,
  bundledIcon
}: TokenIconCandidateInput): readonly string[] {
  const providerIcon = isPublicIpfsIconUrl(token?.icon ?? undefined) ? undefined : token?.icon
  const metadataIcon = isCoinGeckoIconUrl(icon) || isPublicIpfsIconUrl(icon) ? undefined : icon
  const coinGeckoIcon = isCoinGeckoIconUrl(icon) ? icon : token?.coingeckoIcon
  const candidates = [bundledIcon, providerIcon, metadataIcon, coinGeckoIcon]

  return Object.freeze(
    candidates.filter(
      (candidate, index): candidate is string =>
        typeof candidate === 'string' &&
        candidate.length > 0 &&
        !isRetiredIconSource(candidate) &&
        candidates.indexOf(candidate) === index
    )
  )
}
