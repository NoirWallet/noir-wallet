import type { PortfolioAssetView, PortfolioChainView } from '@/core/portfolio'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import { evmWalletClient, type EvmTransferSubmission } from '@/popup/services/evm-wallet-client'
import { resolveChainExplorerTarget } from '@/popup/services/chain-explorer'
import { OnchainTransactionResult, type OnchainResultOutcome } from './OnchainTransactionResult'
import type { TransactionId } from '@/core/transactions/domain'

interface EvmTransactionResultProps {
  readonly asset: PortfolioAssetView
  readonly chain: PortfolioChainView
  readonly submission: EvmTransferSubmission
  readonly onDone: (outcome: OnchainResultOutcome) => void
  readonly onViewActivity: (transactionId: TransactionId) => void
}

export function EvmTransactionResult({
  asset,
  chain,
  submission,
  onDone,
  onViewActivity
}: EvmTransactionResultProps) {
  const explorer = resolveChainExplorerTarget(chain.chain.id, DEFAULT_NETWORK)
  return (
    <OnchainTransactionResult
      asset={asset}
      chain={chain}
      submission={submission}
      client={evmWalletClient}
      explorerBaseUrl={explorer?.baseUrl ?? ''}
      explorerTransactionPath={explorer?.transactionPath}
      feeDecimals={18}
      feeSymbol={
        chain.assets.find(entry => entry.asset.kind === 'native')?.metadata.symbol ?? 'ETH'
      }
      feeLabel="Network fee"
      totalLabel="Maximum total"
      showTotal={asset.asset.kind === 'native'}
      onDone={onDone}
      onViewActivity={onViewActivity}
    />
  )
}
