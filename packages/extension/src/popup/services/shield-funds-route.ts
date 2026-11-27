import { parseZcashAddress } from '@/core/address-book/address-book'
import { getZcashChainId } from '@/core/chains/registry'
import type { ShieldProvider } from './asset-domains'
import type { ConfidentialFundingReview } from '@/core/services/confidential-funding'
import type { PrepareConfidentialFundingRequest } from './confidential-funding-client'
import { buildExternalShieldWithdrawRequest, buildShieldTransferRequest } from './shield-transfer'
import type { Network } from '@/types'

export interface ShieldFundsOrigin {
  readonly path: string
  readonly network: Network
  readonly walletId: string
  readonly accountId: string
}

export function resolveShieldFundsOrigin(
  origin: Partial<ShieldFundsOrigin> | null | undefined,
  scope: Omit<ShieldFundsOrigin, 'path'>
): string | null {
  return origin?.network === scope.network &&
    origin.walletId === scope.walletId &&
    origin.accountId === scope.accountId &&
    typeof origin.path === 'string' &&
    /^\/(?:asset-detail|shield-provider)\?[^#]+$/.test(origin.path)
    ? origin.path
    : null
}

export function readShieldFundsOrigin(params: URLSearchParams): ShieldFundsOrigin | undefined {
  const path = params.get('resultOrigin')
  const network = params.get('resultNetwork')
  const walletId = params.get('resultWalletId')
  const accountId = params.get('resultAccountId')
  if (!path || !walletId || !accountId || (network !== 'mainnet' && network !== 'testnet')) return
  return { path, network, walletId, accountId }
}

function shieldFundsOriginQuery(origin: ShieldFundsOrigin) {
  return {
    resultOrigin: origin.path,
    resultNetwork: origin.network,
    resultWalletId: origin.walletId,
    resultAccountId: origin.accountId
  }
}

export function shieldFundsResultExitPath(origin: ShieldFundsOrigin): string {
  return `/shield?${new URLSearchParams({ resultExit: '1', ...shieldFundsOriginQuery(origin) })}`
}

export type ShieldFundsDirection = 'shield' | 'unshield'

export interface ShieldFundsFormState {
  readonly reviewing: boolean
  readonly busy: boolean
  readonly fullHeight: boolean
}

export interface ShieldFundsFormProps {
  readonly direction: ShieldFundsDirection
  readonly assetId?: string | null
  readonly provider?: ShieldProvider | null
  readonly onBack?: () => void
  readonly onStateChange?: (state: ShieldFundsFormState) => void
}

export function fixedShieldFundsDomains(direction: ShieldFundsDirection) {
  return direction === 'shield'
    ? ({ from: 'public', to: 'shield' } as const)
    : ({ from: 'shield', to: 'public' } as const)
}

export function selectShieldFundsAsset(input: {
  readonly direction?: ShieldFundsDirection
  readonly selectedAssetId: string | null
  readonly preferredProvider: ShieldProvider | null
  readonly defaultAssetId: string | null
  readonly zcashAssetId: string
  readonly nativeAvailable: boolean
  readonly nativeFunded: boolean
  readonly confidentialZecFunded: boolean
}): { assetId: string | null; provider: ShieldProvider | null } {
  if (!input.direction) return { assetId: null, provider: null }
  const fundedNative = input.nativeAvailable && input.nativeFunded
  const defaultZec =
    input.nativeAvailable || input.confidentialZecFunded ? input.zcashAssetId : null
  const assetId =
    input.selectedAssetId ??
    (fundedNative ? input.zcashAssetId : (input.defaultAssetId ?? defaultZec))
  if (!assetId) return { assetId: null, provider: null }
  if (assetId !== input.zcashAssetId) return { assetId, provider: 'near-confidential' }
  const nativePreferred =
    input.nativeAvailable &&
    (input.direction === 'shield' || fundedNative || !input.confidentialZecFunded)
  return {
    assetId,
    provider: input.preferredProvider ?? (nativePreferred ? 'zcash-shield' : 'near-confidential')
  }
}

export function shieldFundsPath(
  direction: ShieldFundsDirection,
  assetId: string,
  provider: ShieldProvider,
  origin?: ShieldFundsOrigin
): string {
  return `/${direction}?${new URLSearchParams({
    assetId,
    provider,
    ...(origin ? shieldFundsOriginQuery(origin) : {})
  })}`
}

export function buildFixedShieldFundsRequest(
  input: Omit<
    Parameters<typeof buildShieldTransferRequest>[0],
    'from' | 'to' | 'method' | 'destination'
  > & {
    readonly direction: ShieldFundsDirection
    readonly ownTransparentAddress?: string
    readonly accountDomain?: 'public' | 'private'
  }
) {
  const { direction, ownTransparentAddress, accountDomain = 'public', ...transfer } = input
  if (direction === 'unshield' && transfer.chain.chain.id === getZcashChainId(transfer.network)) {
    if (
      accountDomain !== 'public' ||
      !ownTransparentAddress ||
      !parseZcashAddress(ownTransparentAddress, transfer.network).scheme.startsWith(
        'zcash-transparent-'
      )
    )
      throw new Error('Unshield requires a transparent address from this account')
    const holding = { asset: transfer.asset, chain: transfer.chain, managed: transfer.managed }
    return Object.freeze({
      ...buildExternalShieldWithdrawRequest({
        ...transfer,
        source: holding,
        destination: holding,
        recipient: ownTransparentAddress
      }),
      purpose: 'move' as const,
      ...(transfer.dedupKey ? { dedupKey: transfer.dedupKey } : {})
    })
  }
  return buildShieldTransferRequest({
    ...transfer,
    ...(direction === 'shield'
      ? { from: accountDomain, to: 'shield' }
      : { from: 'shield', to: accountDomain }),
    destination: undefined,
    method: 'directly'
  })
}

export function matchesFixedShieldFundsRecipient(
  review: ConfidentialFundingReview,
  request: PrepareConfidentialFundingRequest,
  ownAccountAddress: string
) {
  if (!ownAccountAddress) return false
  if (request.purpose === 'move') {
    return (
      review.purpose === 'move' &&
      review.externalRecipient === ownAccountAddress &&
      review.destinationAddress === ownAccountAddress
    )
  }
  const accountAddress =
    request.operation === 'deposit' ? review.sourceAddress : review.destinationAddress
  return accountAddress.toLowerCase() === ownAccountAddress.toLowerCase()
}
