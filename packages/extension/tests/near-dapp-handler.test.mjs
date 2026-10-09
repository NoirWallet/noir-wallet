import { expect, test } from '@playwright/test'

import { BackgroundNearDAppHandler } from '../src/background/near-dapp-handler.ts'

const chainId = 'near:testnet'
const address = 'alice.testnet'
const publicKey = `ed25519:${'1'.repeat(32)}`

function harness({ approved = true } = {}) {
  const calls = []
  const active = {
    context: {
      chainAccount: {
        id: 'chain-account:near:test',
        scope: { keyDomainId: 'key-domain:near:test', accountId: 'account:test', chainId },
        identity: { kind: 'account-identifier', value: address }
      },
      accountIndex: 0,
      publicKey,
      keyDomainSource: { kind: 'software', mnemonicWordCount: 24 }
    },
    reference: { walletId: 'key-domain:near:test', accountId: 'account:test' },
    address
  }
  const signer = {
    async prepare(keyDomainId, payload) {
      calls.push(['prepare', keyDomainId, payload])
      const message = payload.kind === 'near-nep413-message'
      return {
        commandId: `signing-command:near:${message ? 'message' : 'transaction'}:${calls.length}`,
        chainId,
        operation: message ? 'message' : 'transaction',
        summary: message
          ? {
              schema: 'near.nep413-message.v1',
              fields: { signerId: address }
            }
          : { schema: 'near.transaction.v1', fields: { signerId: address } },
        payloadFingerprint: { algorithm: 'sha256', digestHex: '11'.repeat(32) },
        execution: { kind: 'internal' },
        expiresAt: Date.now() + 60_000
      }
    },
    async confirm(keyDomainId, commandId) {
      calls.push(['confirm', keyDomainId, commandId])
      return commandId.includes(':message:')
        ? {
            kind: 'signature',
            signature: { encoding: 'base64', value: 'AA==' },
            publicKey: 'ed25519:key',
            address
          }
        : {
            kind: 'signed-payload',
            payload: { encoding: 'base64', value: 'Ag==' },
            transactionId: 'hash'
          }
    },
    async cancel(keyDomainId, commandId) {
      calls.push(['cancel', keyDomainId, commandId])
    }
  }
  const handler = new BackgroundNearDAppHandler({
    native: {
      async request(request) {
        calls.push(['native', request])
        return 'native-result'
      },
      async notifyAccountsChanged() {}
    },
    network: { chainId, displayName: 'NEAR Testnet' },
    loadAuthorizedAccount: async () => active,
    requestApproval: async (_origin, action, data) => {
      calls.push(['approval', action, data])
      return { approved, requestId: 'approval:1' }
    },
    runActiveOperation: operation => operation(),
    signer,
    rpc: {
      async assertExpectedChain() {
        calls.push(['attest'])
      },
      async getAccessKey() {
        calls.push(['accessKey', ...arguments])
        return {
          nonce: '7',
          blockHash: '11111111111111111111111111111111',
          permission: { kind: 'full-access' }
        }
      },
      async broadcastSignedTransactionAndWait(transaction) {
        calls.push(['broadcast', transaction])
        return { transaction: { hash: 'hash' }, status: { SuccessValue: '' } }
      }
    }
  })
  return { handler, calls }
}

test('signs an OKX-compatible NEAR function-call transaction without broadcasting it', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      {
        method: 'signTransaction',
        params: [
          {
            receiverId: 'contract.testnet',
            actions: [{ methodName: 'ping', args: { value: '1' }, gas: '1', deposit: '0' }]
          }
        ]
      },
      'https://dapp.example',
      { pageUrl: 'https://dapp.example/sign' }
    )
  ).resolves.toBe('Ag==')
  const payload = state.calls.find(call => call[0] === 'prepare')[2]
  expect(state.calls.find(call => call[0] === 'approval')[2]).toMatchObject({
    faviconPageUrl: 'https://dapp.example/sign'
  })
  expect(payload.transaction).toMatchObject({ nonce: '8', receiverId: 'contract.testnet' })
  expect(state.calls.find(call => call[0] === 'accessKey')).toEqual([
    'accessKey',
    address,
    publicKey
  ])
  expect(payload.transaction.actions[0]).toMatchObject({
    type: 'functionCall',
    methodName: 'ping',
    gas: '1',
    depositYocto: '0'
  })
  expect(state.calls.some(call => call[0] === 'broadcast')).toBe(false)
})

test('signs a Wallet Selector transfer action without exposing a fixed transfer RPC', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      {
        method: 'signTransaction',
        params: [
          {
            receiverId: 'recipient.testnet',
            actions: [{ type: 'Transfer', params: { deposit: '1' } }]
          }
        ]
      },
      'https://dapp.example',
      {}
    )
  ).resolves.toBe('Ag==')
  const payload = state.calls.find(call => call[0] === 'prepare')[2]
  expect(payload.transaction.actions).toEqual([{ type: 'transfer', depositYocto: '1' }])
})

test('signs and broadcasts a Near Connect transaction after approval', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      {
        method: 'signAndSendTransaction',
        params: [
          {
            signerId: address,
            receiverId: 'contract.testnet',
            actions: [
              {
                enum: 'functionCall',
                functionCall: {
                  methodName: 'stake',
                  args: [123, 125],
                  gas: '300000000000000',
                  deposit: '0'
                }
              }
            ]
          }
        ]
      },
      'https://x.rhea.finance',
      {}
    )
  ).resolves.toEqual({ transaction: { hash: 'hash' }, status: { SuccessValue: '' } })
  expect(state.calls.filter(call => call[0] === 'broadcast')).toEqual([['broadcast', 'Ag==']])
  expect(state.calls.find(call => call[0] === 'prepare')[2].transaction.actions[0]).toMatchObject({
    args: 'e30=',
    gas: '300000000000000',
    depositYocto: '0'
  })
})

test('allocates consecutive nonces for a NEAR transaction batch', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      {
        method: 'requestSignTransactions',
        params: [
          {
            transactions: [
              {
                receiverId: 'one.testnet',
                actions: [{ methodName: 'one', args: {}, gas: '1', deposit: '0' }]
              },
              {
                receiverId: 'two.testnet',
                actions: [{ methodName: 'two', args: {}, gas: '2', deposit: '0' }]
              }
            ]
          }
        ]
      },
      'https://dapp.example',
      {}
    )
  ).resolves.toEqual({ txs: [{ signedTx: 'Ag==' }, { signedTx: 'Ag==' }] })
  expect(
    state.calls.filter(call => call[0] === 'prepare').map(call => call[2].transaction.nonce)
  ).toEqual(['8', '9'])
})

test('signs a NEP-413 message through the message approval path', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      {
        method: 'signMessage',
        params: [
          {
            message: 'hello',
            recipient: 'dapp.testnet',
            nonce: Array(32).fill(1),
            callbackUrl: null,
            state: 'state'
          }
        ]
      },
      'https://dapp.example',
      {}
    )
  ).resolves.toEqual({
    accountId: address,
    publicKey: 'ed25519:key',
    signature: 'AA==',
    state: 'state'
  })
  expect(state.calls.find(call => call[0] === 'approval')[1]).toBe('nearMessage')
})
