const PENDING_ZCASH_TX_KEY = 'pending_zcash_transactions'

export async function hasPendingZcashTxForWallet(walletId: string): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(PENDING_ZCASH_TX_KEY)
    const txs: { accountKey: string }[] = result[PENDING_ZCASH_TX_KEY] || []
    return txs.some(tx => tx.accountKey.split(':')[1] === walletId)
  } catch {
    return false
  }
}
