import type { ChainEndpointSettings } from '@/core/chains/chain-endpoint-settings'
import { resolveEvmNetworkCatalog } from '@/core/chains/evm-runtime-config'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { Eip1193ProviderError, type ParsedEip1193ChainRequest } from '@/core/dapp/eip1193'

export interface EvmDAppNetworkSwitchOptions {
  readonly readSettings: () => Promise<ChainEndpointSettings>
  readonly commitActiveChain: (chainId: string, origin: string) => Promise<void>
  readonly requestApproval: (
    origin: string,
    action: 'evmNetwork',
    data: Readonly<{
      action: 'switch'
      chainId: `eip155:${number}`
      chainName: string
      iconChain: string
    }>
  ) => Promise<{ readonly approved: boolean }>
}

export async function handleEvmDAppNetworkSwitch(
  requested: ParsedEip1193ChainRequest,
  origin: string,
  action: 'switch' | 'add',
  options: EvmDAppNetworkSwitchOptions
): Promise<void> {
  const requestedChainId = `eip155:${requested.numericChainId}` as const
  const current = await options.readSettings()
  const configuredNetwork = resolveEvmNetworkCatalog(DEFAULT_NETWORK, current).find(
    network => network.chainId === requestedChainId
  )
  if (action === 'add') {
    if (configuredNetwork) return
    throw new Eip1193ProviderError(
      4200,
      'Adding custom EVM networks is not supported in this release.'
    )
  }
  if (!configuredNetwork) {
    throw new Eip1193ProviderError(4902, 'The requested EVM chain is not configured.')
  }

  const decision = await options.requestApproval(origin, 'evmNetwork', {
    action: 'switch',
    chainId: requestedChainId,
    chainName: configuredNetwork.displayName,
    iconChain: configuredNetwork.iconChain
  })
  if (!decision.approved) {
    throw new Eip1193ProviderError(4001, 'User rejected the network request.')
  }

  await options.commitActiveChain(requestedChainId, origin)
}
