import { BITCOIN_NETWORKS, BUILTIN_EVM_NETWORKS, type EvmNetworkConfig } from '@/config/networks'
import type { ConnectedDApp } from '@/core/dapp/dapp-manager'
import { parseChainId } from '@/core/chains/registry'

export interface DAppPermissionPresentation {
  readonly chainId: string
  readonly label: string
  readonly iconChain: string
  readonly accountCount: number
}

const EVM_NETWORKS_BY_CHAIN_ID: ReadonlyMap<string, EvmNetworkConfig> = new Map(
  [...BUILTIN_EVM_NETWORKS.mainnet, ...BUILTIN_EVM_NETWORKS.testnet].map(network => [
    network.chainId,
    network
  ])
)

const BITCOIN_NETWORKS_BY_CHAIN_ID = new Map(
  Object.values(BITCOIN_NETWORKS).map(network => [network.chainId, network])
)

function hasZcashAuthorization(dapp: ConnectedDApp): boolean {
  return (
    (Array.isArray(dapp.authorizedAccounts) && dapp.authorizedAccounts.length > 0) ||
    (typeof dapp.boundWalletId === 'string' && typeof dapp.boundAccountId === 'string')
  )
}

export function presentDAppPermissions(dapp: ConnectedDApp): readonly DAppPermissionPresentation[] {
  const permissions: DAppPermissionPresentation[] = []

  if (hasZcashAuthorization(dapp)) {
    permissions.push({
      chainId: 'zcash',
      label: 'Zcash',
      iconChain: 'zcash',
      accountCount: dapp.authorizedAccounts?.length ?? 1
    })
  }

  for (const authorization of dapp.chainAuthorizations ?? []) {
    const evm = EVM_NETWORKS_BY_CHAIN_ID.get(authorization.chainId)
    if (evm) {
      permissions.push({
        chainId: authorization.chainId,
        label: evm.displayName,
        iconChain: evm.iconChain,
        accountCount: authorization.accounts.length
      })
      continue
    }

    const bitcoin = BITCOIN_NETWORKS_BY_CHAIN_ID.get(authorization.chainId)
    if (bitcoin) {
      permissions.push({
        chainId: authorization.chainId,
        label: bitcoin.displayName,
        iconChain: 'bitcoin',
        accountCount: authorization.accounts.length
      })
      continue
    }

    const parsed = parseChainId(authorization.chainId)
    permissions.push({
      chainId: authorization.chainId,
      label:
        parsed.namespace === 'eip155'
          ? `EVM ${parsed.reference}`
          : `Bitcoin ${parsed.reference.slice(0, 8)}…`,
      iconChain: parsed.namespace === 'eip155' ? 'evm' : 'bitcoin',
      accountCount: authorization.accounts.length
    })
  }

  return permissions
}
