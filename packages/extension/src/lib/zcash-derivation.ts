import type { Network } from '@/types'

export const MAX_ZCASH_ACCOUNT_INDEX = 2 ** 31 - 1

function coinType(network: Network): number {
  return network === 'mainnet' ? 133 : 1
}

export function getZip32AccountPath(network: Network, accountIndex: number): string {
  return `m/32'/${coinType(network)}'/${accountIndex}'`
}

export function getLedgerAccountPath(network: Network, accountIndex: number): string {
  return getZip32AccountPath(network, accountIndex).slice(2)
}

export function getTransparentAddressPath(
  network: Network,
  accountIndex: number,
  addressIndex: number
): string {
  return `m/44'/${coinType(network)}'/${accountIndex}'/0/${addressIndex}`
}
