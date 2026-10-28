import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInitialProductChainRegistry } from '../src/core/chains/registry/index.ts'
import { createAccountNetworksClient } from '../src/popup/services/account-networks-client.ts'

test('account catalogs retain wallet creation time and accept legacy entries without it', async () => {
  const account = {
    walletId: 'wallet:catalog-order',
    walletDisplayName: 'Wallet 1',
    walletSource: { kind: 'software' },
    accountId: 'account:catalog-order:0',
    accountDisplayName: 'Account 1',
    accountIndex: 0,
    active: true,
    networks: []
  }
  const read = entry =>
    createAccountNetworksClient(
      async () => ({
        result: {
          generationId: 'storage-v2:generation:catalog-order',
          accounts: [entry]
        }
      }),
      createInitialProductChainRegistry('testnet')
    ).getCatalog()

  assert.equal((await read({ ...account, walletCreatedAt: 123 })).accounts[0].walletCreatedAt, 123)
  assert.equal(Object.hasOwn((await read(account)).accounts[0], 'walletCreatedAt'), false)
  for (const walletCreatedAt of [-1, 1.5, '123', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(read({ ...account, walletCreatedAt }), { code: 'invalid-response' })
  }
})
