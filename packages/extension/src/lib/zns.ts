import { ZNS } from 'zcashname-sdk'
import type { Network } from '@/types'

const ZNS_ENDPOINTS: Record<Network, string> = {
  mainnet: 'https://main.zcashnames.com',
  testnet: 'https://light.zcash.me/zns-testnet'
}

let instance: ZNS | null = null
let activeNetwork: Network | null = null

const ZNS_SUFFIX_PATTERN = /\.(?:zcash|zec)$/i
const BARE_ZNS_NAME_PATTERN = /^[a-z0-9]{1,62}$/i
const TRANSPARENT_ADDRESS_PATTERN = /^(?:t[123]|tm)[a-km-zA-HJ-NP-Z1-9]{33}$/

export function getZnsClient(network: Network): ZNS {
  if (!instance || activeNetwork !== network) {
    instance = new ZNS({ url: ZNS_ENDPOINTS[network] })
    activeNetwork = network
  }
  return instance
}

/** Returns true for bare ZNS names and names ending in `.zec` or `.zcash`. */
export function isZnsName(input: string): boolean {
  const value = input.trim()
  if (!value) return false
  if (ZNS_SUFFIX_PATTERN.test(value)) return true

  // Transparent addresses are short enough to otherwise look like bare ZNS names.
  if (TRANSPARENT_ADDRESS_PATTERN.test(value)) return false

  return BARE_ZNS_NAME_PATTERN.test(value)
}

/** Strip a supported ZNS suffix and normalize to lowercase. */
export function normalizeZnsName(input: string): string {
  return input.trim().toLowerCase().replace(ZNS_SUFFIX_PATTERN, '')
}
