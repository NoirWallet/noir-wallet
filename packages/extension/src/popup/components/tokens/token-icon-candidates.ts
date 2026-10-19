import { formatNativeTokenIconUrl, formatTrustWalletTokenIconUrl } from '@/config/icons'
import { parseAssetId } from '@/core/chains/registry'
import type { SwapToken } from '@/core/services/intents-api'
import { MARKET_ASSETS } from '@/config/asset-market-assets'
import { findBundledWalletMarketAssetId } from './token-display-policy'

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

function parseIconAsset(
  assetId: string | undefined
): Readonly<{ namespace: string; reference: string; chainFamily: string }> | undefined {
  if (!assetId) return undefined
  try {
    const parsed = parseAssetId(assetId)
    return Object.freeze({
      namespace: parsed.namespace,
      reference: decodeURIComponent(parsed.reference),
      chainFamily: parsed.chainId.slice(0, parsed.chainId.indexOf(':'))
    })
  } catch {
    return undefined
  }
}

export function getTokenIconCandidates({
  token,
  icon,
  assetId,
  blockchain,
  nativeChain,
  bundledIcon
}: TokenIconCandidateInput): readonly string[] {
  // Keep native ETH identical across catalogs and L2s; the badge identifies its chain.
  if (assetId && findBundledWalletMarketAssetId(assetId) === MARKET_ASSETS.eth) {
    return Object.freeze(
      [formatNativeTokenIconUrl('eth')].filter((candidate): candidate is string => !!candidate)
    )
  }
  const parsedAsset = parseIconAsset(assetId)
  const assetBlockchain = blockchain ?? parsedAsset?.chainFamily
  const nativeBlockchain = token && token.contractAddress == null ? token.blockchain : undefined
  const nativeAssetBlockchain = parsedAsset?.namespace === 'slip44' ? assetBlockchain : undefined
  const assetTokenIcon =
    parsedAsset && parsedAsset.namespace !== 'slip44' && assetBlockchain
      ? formatTrustWalletTokenIconUrl(assetBlockchain, parsedAsset.reference)
      : undefined
  const trustWalletTokenIcon =
    token?.contractAddress != null
      ? formatTrustWalletTokenIconUrl(token.blockchain, token.contractAddress)
      : undefined
  const providerIcon = isPublicIpfsIconUrl(token?.icon ?? undefined) ? undefined : token?.icon
  const metadataIcon = isCoinGeckoIconUrl(icon) || isPublicIpfsIconUrl(icon) ? undefined : icon
  const coinGeckoIcon = isCoinGeckoIconUrl(icon) ? icon : token?.coingeckoIcon
  const candidates = [
    bundledIcon,
    providerIcon,
    metadataIcon,
    coinGeckoIcon,
    trustWalletTokenIcon,
    assetTokenIcon,
    nativeChain ? formatNativeTokenIconUrl(nativeChain) : undefined,
    nativeBlockchain ? formatNativeTokenIconUrl(nativeBlockchain) : undefined,
    nativeAssetBlockchain ? formatNativeTokenIconUrl(nativeAssetBlockchain) : undefined
  ]

  return Object.freeze(
    candidates.filter(
      (candidate, index): candidate is string =>
        typeof candidate === 'string' &&
        candidate.length > 0 &&
        candidates.indexOf(candidate) === index
    )
  )
}
