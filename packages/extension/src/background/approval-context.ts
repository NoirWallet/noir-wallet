import { pendingRequestsManager } from './pending-requests'
import { dappManager } from '@/core/dapp/dapp-manager'
import { accountManager } from '@/core/wallet/account-manager'
import { rehydrateWalletStore, useWalletStore } from '@/store/wallet-store'
import { MARGINAL_FEE_ZATS } from '@/config/fee'
import { getWorkerClient } from '@/core/worker/client'
import { safeBig } from '@/lib/big'

export async function getApprovalContext(requestId: string) {
  await rehydrateWalletStore()
  const request = pendingRequestsManager.get(requestId)
  if (!request) throw new Error('Request not found or expired')
  const store = useWalletStore.getState()
  const authorized =
    request.action === 'connect' ||
    (await dappManager.getAuthorizedAccounts(request.origin)).some(
      account => account.walletId === request.walletId && account.accountId === request.accountId
    )
  if (
    accountManager.isLocked() ||
    store.currentNetwork !== request.network ||
    !store.getAccount(request.walletId, request.accountId) ||
    !authorized ||
    (await dappManager.getAuthorizationRevision(request.origin)) !== request.authorizationRevision
  ) {
    pendingRequestsManager.cancel(requestId)
    throw new Error('Wallet account or site connection changed. Reconnect and try again.')
  }
  return request
}

export async function estimateApprovalFee(requestId: string): Promise<string> {
  const request = await getApprovalContext(requestId)
  await accountManager.getWalletCore(request.walletId, request.accountId)
  await getApprovalContext(requestId)
  const account = useWalletStore.getState().getAccount(request.walletId, request.accountId)
  if (!account) throw new Error('Account is no longer available')
  const client = getWorkerClient(request.walletId)
  const fee =
    request.action === 'shieldFunds'
      ? await client.estimateShieldFee({
          accountIndex: account.derivationIndex,
          marginalFeeZats: MARGINAL_FEE_ZATS.standard
        })
      : request.action === 'sendTransaction'
        ? (
            await client.estimateTransferFee({
              accountIndex: account.derivationIndex,
              to: request.data.to,
              value: safeBig(request.data.amount).times(1e8).toFixed(0),
              memo: request.data.memo,
              marginalFeeZats: MARGINAL_FEE_ZATS.standard,
              fundingSource: request.data.fundingSource ?? 'shielded'
            })
          ).feeZats
        : (() => {
            throw new Error('Request does not support fee estimation')
          })()
  await getApprovalContext(requestId)
  return fee
}
