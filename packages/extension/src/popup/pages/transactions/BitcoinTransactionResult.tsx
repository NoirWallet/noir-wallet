import type { PortfolioAssetView, PortfolioChainView } from '@/core/portfolio'
import { DEFAULT_NETWORK } from '@/lib/runtime-network'
import {
  bitcoinWalletClient,
  type BitcoinTransferSubmission
} from '@/popup/services/bitcoin-wallet-client'
import { OnchainTransactionResult, type OnchainResultOutcome } from './OnchainTransactionResult'
import { resolveChainExplorerTarget } from '@/popup/services/chain-explorer'
import type { TransactionId } from '@/core/transactions/domain'

interface BitcoinTransactionResultProps {
  readonly asset: PortfolioAssetView
  readonly chain: PortfolioChainView
  readonly submission: BitcoinTransferSubmission
  readonly onDone: (outcome: OnchainResultOutcome) => void
  readonly onViewActivity: (transactionId: TransactionId) => void
}

export function BitcoinTransactionResult({
  asset,
  chain,
  submission,
  onDone,
  onViewActivity
}: BitcoinTransactionResultProps) {
  const explorer = resolveChainExplorerTarget(chain.chain.id, DEFAULT_NETWORK)
  return (
    <OnchainTransactionResult
      asset={asset}
      chain={chain}
      submission={submission}
      client={bitcoinWalletClient}
      explorerBaseUrl={explorer?.baseUrl ?? ''}
      explorerTransactionPath={explorer?.transactionPath}
      feeDecimals={8}
      feeSymbol="BTC"
      feeLabel="Network fee"
      totalLabel="Total"
      showTotal
      onDone={onDone}
      onViewActivity={onViewActivity}
    />
  )
}
