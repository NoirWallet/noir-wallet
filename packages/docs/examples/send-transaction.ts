import { getNoirWallet } from '@noir-wallet/sdk'

const wallet = getNoirWallet()
if (!wallet) {
  throw new Error('Install Noir Wallet to continue')
}

const txid = await wallet.zcash.sendTransaction({
  to: 'u1...',
  amount: '0.25',
  fundingSource: 'shielded'
})

console.log(txid)
