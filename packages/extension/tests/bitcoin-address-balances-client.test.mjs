import { expect, test } from '@playwright/test'

import {
  BitcoinAddressBalancesClientError,
  createBitcoinAddressBalancesClient
} from '../src/popup/services/bitcoin-address-balances-client.ts'

const chainId = 'bip122:000000000019d6689c085ae165831e93'
const walletId = 'key-domain:wallet'
const accountId = 'account:wallet:0'

function response(overrides = {}) {
  return {
    result: {
      walletId,
      accountId,
      accountIndex: 0,
      chainId,
      updatedAt: 123,
      activeAddressType: 'p2wpkh',
      confirmedRaw: '23910',
      availableRaw: '23910',
      pendingRaw: '0',
      addresses: [
        {
          value: 'bc1q8acm2s0lr05jdlt4e6m0sc303pu0hzn86wfewl',
          addressType: 'p2wpkh',
          addressScheme: 'bitcoin-p2wpkh',
          change: false,
          addressIndex: 0,
          derivationPath: "m/84'/0'/0'/0/0",
          used: true,
          confirmedRaw: '23910',
          availableRaw: '23910',
          pendingRaw: '0',
          utxoCount: 4
        }
      ],
      ...overrides
    }
  }
}

test('parses an account-scoped active Bitcoin address balance catalog', async () => {
  const messages = []
  const client = createBitcoinAddressBalancesClient(async message => {
    messages.push(message)
    return response()
  })

  const catalog = await client.getActiveCatalog()

  expect(messages).toEqual([{ type: 'GET_BITCOIN_ADDRESS_BALANCES' }])
  expect(catalog).toMatchObject({
    walletId,
    accountId,
    accountIndex: 0,
    chainId,
    activeAddressType: 'p2wpkh',
    confirmedRaw: '23910',
    availableRaw: '23910'
  })
  expect(catalog.addresses).toHaveLength(1)
  expect(catalog.addresses[0]).toMatchObject({ addressIndex: 0, confirmedRaw: '23910' })
})

test('persists a scoped active Bitcoin address type through Background', async () => {
  const messages = []
  const client = createBitcoinAddressBalancesClient(async message => {
    messages.push(message)
    return response({
      activeAddressType: 'p2tr',
      confirmedRaw: '0',
      availableRaw: '0',
      pendingRaw: '0',
      addresses: []
    })
  })

  await expect(
    client.setActiveAddressType({ walletId, accountId, addressType: 'p2tr' })
  ).resolves.toMatchObject({ activeAddressType: 'p2tr' })
  expect(messages).toEqual([
    {
      type: 'SET_ACTIVE_BITCOIN_ADDRESS_TYPE',
      walletId,
      accountId,
      addressType: 'p2tr'
    }
  ])
})

test('rejects mismatched totals, paths, duplicate addresses, and unexpected fields', async () => {
  const invalid = [
    response({ confirmedRaw: '23911' }),
    response({
      addresses: [
        {
          ...response().result.addresses[0],
          derivationPath: "m/84'/0'/0'/1/0"
        }
      ],
      confirmedRaw: '23910'
    }),
    response({ addresses: [response().result.addresses[0], response().result.addresses[0]] }),
    { result: { ...response().result, secret: 'unexpected' } }
  ]

  for (const value of invalid) {
    const client = createBitcoinAddressBalancesClient(async () => value)
    await expect(client.getActiveCatalog()).rejects.toMatchObject({
      name: 'BitcoinAddressBalancesClientError',
      code: 'invalid-response'
    })
  }
})

test('distinguishes an unavailable background response', async () => {
  const client = createBitcoinAddressBalancesClient(async () => ({
    error: 'Bitcoin address balances unavailable'
  }))
  await expect(client.getActiveCatalog()).rejects.toBeInstanceOf(BitcoinAddressBalancesClientError)
  await expect(client.getActiveCatalog()).rejects.toMatchObject({ code: 'unavailable' })
})
