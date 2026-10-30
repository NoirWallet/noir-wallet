import { ZcashAPI, type ZcashConnectResult, type TransactionHistoryEntry } from '@noir-wallet/sdk'
import {
  type ZcashProvider,
  type ZcashBalanceResult,
  type MaxTransferParams,
  type MaxTransferEstimate
} from '@noir-wallet/sdk/chains/zcash'

declare const provider: ZcashProvider
const api = new ZcashAPI(provider)
const connected: Promise<ZcashConnectResult> = api.connect()
const balance: Promise<ZcashBalanceResult> = api.getBalance('wallet:account')
const history: Promise<TransactionHistoryEntry[]> = api.getTransactionHistory()
const estimate: Promise<MaxTransferEstimate> = api.getMaxTransfer({
  to: 't-address',
  fundingSource: 'transparent'
} satisfies MaxTransferParams)
void [connected, balance, history, estimate]
