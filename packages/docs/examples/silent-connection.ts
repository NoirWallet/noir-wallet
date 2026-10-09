import { getNoirWallet } from '@noir-wallet/sdk'

export async function getExistingConnection() {
  const wallet = getNoirWallet()
  if (!wallet) return null

  const connection = await wallet.zcash.getAccounts()
  if (!connection) return null

  return {
    primaryAccount: {
      transparent: connection.transparent,
      shielded: connection.shielded
    },
    accounts: connection.accounts
  }
}
