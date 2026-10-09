import Big from '@/lib/big'

const RAW_AMOUNT_PATTERN = /^\d+$/
const ADDITIONAL_GAS_RESERVE_COUNT = 4n

interface PrivateFundingAsset {
  readonly chainId: string | number
  readonly address: string
  readonly decimals: number
  readonly price: number
}

function isValidRawAmount(value: string): boolean {
  return value.length <= 512 && RAW_AMOUNT_PATTERN.test(value)
}

export function calculateSuggestedPrivateGasFundingRaw(
  shortfallRaw: string,
  maximumGasCostRaw: string
): string | null {
  if (!isValidRawAmount(shortfallRaw) || !isValidRawAmount(maximumGasCostRaw)) return null
  if (BigInt(shortfallRaw) <= 0n) return null

  return (BigInt(shortfallRaw) + BigInt(maximumGasCostRaw) * ADDITIONAL_GAS_RESERVE_COUNT).toString()
}

export function calculatePrivateFundingSourceAmount(input: {
  readonly suggestedOutputRaw: string
  readonly source: PrivateFundingAsset
  readonly destination: PrivateFundingAsset
}): string | null {
  const { suggestedOutputRaw, source, destination } = input
  if (
    !isValidRawAmount(suggestedOutputRaw) ||
    BigInt(suggestedOutputRaw) <= 0n ||
    !Number.isSafeInteger(source.decimals) ||
    source.decimals < 0 ||
    source.decimals > 255 ||
    !Number.isSafeInteger(destination.decimals) ||
    destination.decimals < 0 ||
    destination.decimals > 255
  ) {
    return null
  }

  const destinationAmount = new Big(suggestedOutputRaw).div(
    new Big(10).pow(destination.decimals)
  )
  const isSameAsset =
    source.chainId === destination.chainId && source.address === destination.address
  if (isSameAsset) return destinationAmount.toFixed()
  if (
    !Number.isFinite(source.price) ||
    source.price <= 0 ||
    !Number.isFinite(destination.price) ||
    destination.price <= 0
  ) {
    return null
  }

  return destinationAmount
    .mul(destination.price)
    .div(source.price)
    .round(Math.min(source.decimals, 8), Big.roundUp)
    .toFixed()
}
