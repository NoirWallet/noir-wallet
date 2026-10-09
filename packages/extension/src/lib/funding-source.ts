import type { FundingSource, KeySource } from '@/types'

export const KEYSTONE_TRANSPARENT_UNAVAILABLE = 'Transparent funding is not supported by Keystone.'

export function getFundingSourceUnavailableReason(
  keySource: KeySource | undefined,
  fundingSource: FundingSource
): string | undefined {
  if (fundingSource !== 'transparent') return undefined
  if (keySource === 'keystone') return KEYSTONE_TRANSPARENT_UNAVAILABLE
  return undefined
}
