import { NoirShieldSDK } from '@noir-wallet/shield-sdk'

const sdk = new NoirShieldSDK()

export async function transferToConfidentialAccountExample() {
  await sdk.connect()
  const transfer = await sdk.shield.transfer({
    layer: 'near-confidential',
    token: { chainId: 56, assetId: 'eip155:56/slip44:714' },
    amount: '0.05',
    destination: {
      kind: 'confidential',
      accountId: '0x2222222222222222222222222222222222222222',
      chainId: 1,
      assetId: 'eip155:1/slip44:60'
    }
  })
  return transfer.wait()
}
