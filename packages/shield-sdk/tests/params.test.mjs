import assert from 'node:assert/strict'
import { test } from 'node:test'
import { prepareReceive, prepareTransfer } from '../src/layers/near-confidential.ts'
import { ShieldError } from '../src/types.ts'

test('receive keeps the layer and normalizes the source chain', () => {
  const request = prepareReceive({
    layer: 'near-confidential',
    source: { chainId: 56, assetId: 'eip155:56/slip44:714', symbol: 'BNB' },
    amount: '0.10'
  })
  assert.equal(request.layer, 'near-confidential')
  assert.deepEqual(request.source, {
    chainId: 'eip155:56',
    assetId: 'eip155:56/slip44:714',
    symbol: 'BNB'
  })
  assert.equal(request.amount, '0.10')
})

test('transfer accepts a public address or a confidential account id', () => {
  const pub = prepareTransfer({
    layer: 'near-confidential',
    token: { chainId: '0x38', assetId: 'eip155:56/slip44:714' },
    amount: '1',
    destination: {
      kind: 'public',
      chainId: 'eip155:1',
      assetId: 'eip155:1/slip44:60',
      address: '0x1111111111111111111111111111111111111111'
    }
  })
  assert.equal(pub.destination.kind, 'public')
  assert.equal(pub.destination.chainId, 'eip155:1')
  assert.equal(pub.token.chainId, 'eip155:56')

  const internal = prepareTransfer({
    layer: 'near-confidential',
    token: { chainId: 1, symbol: 'ETH' },
    amount: '0.01',
    destination: { kind: 'confidential', accountId: 'recipient.account' }
  })
  assert.deepEqual(internal.destination, {
    kind: 'confidential',
    accountId: 'recipient.account'
  })
  assert.equal('peaAddress' in internal, false)
  assert.equal('peaAddress' in internal.destination, false)
})

test('rejects another layer, peaAddress, and a missing asset', () => {
  assert.throws(
    () =>
      prepareReceive({
        layer: 'privacy-pools',
        source: { chainId: 1, assetId: 'eip155:1/slip44:60' },
        amount: '1'
      }),
    ShieldError
  )
  assert.throws(
    () =>
      prepareTransfer({
        layer: 'near-confidential',
        token: { chainId: 1, assetId: 'eip155:1/slip44:60' },
        amount: '1',
        destination: { kind: 'confidential', accountId: 'id', peaAddress: '0xabc' }
      }),
    ShieldError
  )
  assert.throws(
    () =>
      prepareReceive({
        layer: 'near-confidential',
        source: { chainId: 1 },
        amount: '1'
      }),
    /asset ID or a unique symbol/
  )
})
