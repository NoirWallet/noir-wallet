import type { ChainEndpointSettings } from '@/core/chains/chain-endpoint-settings'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { resolveNearRuntimeNetworkConfig } from '@/core/chains/solana-near-runtime-config'
import { parseNearAccountId } from '@/core/chains/near'
import { dappManager } from '@/core/dapp/dapp-manager'
import { NativeTransferProviderError } from '@/core/dapp/native-transfer-provider'
import { createConfiguredNearRpcClient } from '@/infrastructure/chains/near'
import { NearMultichainSigningClient } from '@/infrastructure/keyring/multichain/near-signing-client'
import { IndexedDbStorageV2Repository } from '@/infrastructure/persistence/repositories'

import { accountContextTransition } from './account-context-transition'
import { credentialSession } from './credential-session'
import { dappHandler } from './dapp-handler'
import { BackgroundNativeTransferDAppHandler } from './native-transfer-dapp-handler'
import { BackgroundNearDAppHandler } from './near-dapp-handler'
import { loadActiveNearTransferContext } from './near-transfer'
import { listDAppChainAccounts } from './dapp-chain-account-catalog'

export function createBackgroundNearDAppHandler(
  endpointSettings?: ChainEndpointSettings
): BackgroundNearDAppHandler {
  const network = resolveNearRuntimeNetworkConfig(DEFAULT_NETWORK, endpointSettings)
  const storageRepository = new IndexedDbStorageV2Repository()
  const native = new BackgroundNativeTransferDAppHandler({
    providerId: 'near',
    familyName: 'NEAR',
    chainId: network.chainId,
    chainName: network.displayName,
    iconChain: 'near',
    connectApprovalAction: 'nearConnect',
    manager: dappManager,
    approval: dappHandler,
    loadActiveContext: () => loadActiveNearTransferContext(storageRepository, network.chainId),
    listAccounts: () =>
      listDAppChainAccounts({
        repository: storageRepository,
        chainId: network.chainId,
        family: 'near',
        resolveAddress: ({ chainAccount }) =>
          chainAccount.identity.kind === 'account-identifier'
            ? parseNearAccountId(chainAccount.identity.value)
            : null
      }),
    hasUnlockSession: () => credentialSession.hasUnlockSession(),
    runActiveOperation: operation => accountContextTransition.runActiveOperation(operation),
    parseAddress: parseNearAccountId
  })
  const rpc = createConfiguredNearRpcClient({ chainId: network.chainId, rpcUrl: network.rpcUrl })
  return new BackgroundNearDAppHandler({
    native,
    network,
    rpc,
    signer: new NearMultichainSigningClient({ credentials: credentialSession }),
    requestApproval: (origin, action, data) =>
      dappHandler.requestExternalApproval(origin, action, data),
    runActiveOperation: operation => accountContextTransition.runActiveOperation(operation),
    loadAuthorizedAccount: async origin => {
      if (!(await credentialSession.hasUnlockSession())) {
        throw new NativeTransferProviderError(4100, 'Unlock Noir Wallet before signing.')
      }
      const context = await loadActiveNearTransferContext(storageRepository, network.chainId)
      if (!context || context.chainAccount.identity.kind !== 'account-identifier') {
        throw new NativeTransferProviderError(4100, 'The active wallet has no NEAR account.')
      }
      const reference = Object.freeze({
        walletId: context.chainAccount.scope.keyDomainId,
        accountId: context.chainAccount.scope.accountId
      })
      const authorization = await dappManager.getChainAuthorization(origin, network.chainId)
      if (
        !authorization?.accounts.some(
          account =>
            account.walletId === reference.walletId && account.accountId === reference.accountId
        )
      ) {
        throw new NativeTransferProviderError(4100, 'This site is not authorized for NEAR.')
      }
      return Object.freeze({
        context,
        reference,
        address: parseNearAccountId(context.chainAccount.identity.value)
      })
    }
  })
}
