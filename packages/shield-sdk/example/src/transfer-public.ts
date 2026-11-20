import { NoirShieldSDK } from '@noir-wallet/shield-sdk'

const sdk = new NoirShieldSDK()

export async function transferToPublicExample() {
  await sdk.connect()
  const transfer = await sdk.shield.transfer({
    layer: 'near-confidential',
    token: { chainId: 'eip155:56', assetId: 'eip155:56/slip44:714' },
    amount: '0.05',
    destination: {
      kind: 'public',
      chainId: '0x1',
      assetId: 'eip155:1/slip44:60',
      address: '0x1111111111111111111111111111111111111111'
    }
  })
  return transfer.wait({ timeoutMs: 120_000 })
}
