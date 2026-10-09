import { getNoirWallet } from '@noir-wallet/sdk'

export async function loadAuthorizedBalances() {
  const wallet = getNoirWallet()
  if (!wallet) return null

  const connection = await wallet.zcash.getAccounts()
  if (!connection) return null

  const result = await wallet.zcash.getBalance()
  const accounts = connection.accounts.map(account => {
    const accountBalance = result.accounts.find(item => item.id === account.id)

    return {
      id: account.id,
      label: account.label,
      balance: accountBalance?.balance,
      synced: accountBalance?.synced ?? false
    }
  })

  return { connection, accounts }
}
