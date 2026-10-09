import { getNoirWallet } from '@noir-wallet/sdk'

export async function connectNoirWallet() {
  const wallet = getNoirWallet()
  if (!wallet) {
    throw new Error('Install Noir Wallet to continue')
  }

  const connection = await wallet.zcash.connect()

  return {
    wallet,
    primaryShieldedAddress: connection.shielded,
    authorizedAccounts: connection.accounts
  }
}
