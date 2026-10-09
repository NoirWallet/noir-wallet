import { expect, test } from '@playwright/test'

import { BackgroundSolanaDAppHandler } from '../src/background/solana-dapp-handler.ts'

const chainId = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const address = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'
const transaction = 'AQ=='

function harness({ approved = true, hardware = false } = {}) {
  const calls = []
  const active = {
    context: {
      chainAccount: {
        id: 'chain-account:solana:test',
        scope: { keyDomainId: 'key-domain:solana:test', accountId: 'account:test', chainId },
        identity: { kind: 'account-identifier', value: address }
      },
      accountIndex: 0,
      keyDomainSource: hardware
        ? { kind: 'hardware', device: 'keystone' }
        : { kind: 'software', mnemonicWordCount: 24 }
    },
    reference: { walletId: 'key-domain:solana:test', accountId: 'account:test' },
    address
  }
  const native = {
    async request(request) {
      calls.push(['native', request])
      return 'native-result'
    },
    async notifyAccountsChanged() {}
  }
  const signer = {
    async prepare(keyDomainId, payload) {
      calls.push(['prepare', keyDomainId, payload])
      const message = payload.kind === 'solana-message'
      return {
        commandId: 'signing-command:solana:dapp',
        chainId,
        operation: message ? 'message' : 'transaction',
        summary: message
          ? { schema: 'solana.message.v1', fields: { signer: address } }
          : {
              schema: 'solana.transaction.v1',
              review: { level: 'standard', issues: [] },
              fields: { requiredSigners: [address] }
            },
        payloadFingerprint: { algorithm: 'sha256', digestHex: '11'.repeat(32) },
        execution: { kind: 'internal' },
        expiresAt: Date.now() + 60_000
      }
    },
    async confirm(keyDomainId, commandId) {
      calls.push(['confirm', keyDomainId, commandId])
      const message = calls.some(call => call[0] === 'prepare' && call[2].kind === 'solana-message')
      return message
        ? {
            kind: 'signature',
            signature: { encoding: 'utf8', value: '1'.repeat(64) },
            publicKey: address,
            address
          }
        : {
            kind: 'signed-payload',
            payload: { encoding: 'base64', value: 'Ag==' },
            transactionId: 'signature'
          }
    },
    async cancel(keyDomainId, commandId) {
      calls.push(['cancel', keyDomainId, commandId])
    }
  }
  const rpc = {
    async broadcastSignedTransaction(value, signal, options) {
      calls.push(['broadcast', value, signal, options])
      return 'broadcast-signature'
    },
    async getSignatureStatus(value) {
      calls.push(['status', value])
      return {
        status: 'finalized',
        contextSlot: 1,
        slot: 1,
        confirmations: null
      }
    }
  }
  const handler = new BackgroundSolanaDAppHandler({
    native,
    network: { chainId, displayName: 'Solana Devnet' },
    signer,
    rpc,
    loadAuthorizedAccount: async () => active,
    requestApproval: async (_origin, action, data) => {
      calls.push(['approval', action, data])
      return { approved, requestId: 'approval:1' }
    },
    runActiveOperation: operation => operation()
  })
  return { handler, calls }
}

test('signs and broadcasts an authorized serialized Solana transaction', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      { method: 'signAndSendTransaction', params: [transaction] },
      'https://dapp.example',
      { pageUrl: 'https://dapp.example/send' }
    )
  ).resolves.toBe('broadcast-signature')
  expect(state.calls.map(call => call[0])).toEqual(['prepare', 'approval', 'confirm', 'broadcast'])
  expect(state.calls[0][2]).toMatchObject({ kind: 'solana-transaction', transaction })
  expect(state.calls[1][2]).toMatchObject({
    faviconPageUrl: 'https://dapp.example/send'
  })
})

test('honors Wallet Standard send options and requested confirmation', async () => {
  const state = harness()
  await expect(
    state.handler.request(
      {
        method: 'signAndSendTransaction',
        params: [
          transaction,
          {
            preflightCommitment: 'processed',
            minContextSlot: 42,
            commitment: 'finalized',
            skipPreflight: true,
            maxRetries: 7
          }
        ]
      },
      'https://dapp.example',
      {}
    )
  ).resolves.toBe('broadcast-signature')
  expect(state.calls.find(call => call[0] === 'broadcast')).toEqual([
    'broadcast',
    'Ag==',
    undefined,
    {
      preflightCommitment: 'processed',
      minContextSlot: 42,
      skipPreflight: true,
      maxRetries: 7
    }
  ])
  expect(state.calls.find(call => call[0] === 'status')).toEqual(['status', 'broadcast-signature'])
})

test('returns signed bytes without broadcasting and cancels rejected requests', async () => {
  const signed = harness()
  await expect(
    signed.handler.request(
      { method: 'signTransaction', params: [transaction] },
      'https://dapp.example',
      {}
    )
  ).resolves.toBe('Ag==')
  expect(signed.calls.some(call => call[0] === 'broadcast')).toBe(false)

  const rejected = harness({ approved: false })
  await expect(
    rejected.handler.request(
      { method: 'signTransaction', params: [transaction] },
      'https://dapp.example',
      {}
    )
  ).rejects.toMatchObject({ code: 4001 })
  expect(rejected.calls.map(call => call[0])).toEqual(['prepare', 'approval', 'cancel'])
})

test('signs Solana transaction batches and messages', async () => {
  const batch = harness()
  await expect(
    batch.handler.request(
      { method: 'signAllTransactions', params: [[transaction, transaction]] },
      'https://dapp.example',
      {}
    )
  ).resolves.toEqual(['Ag==', 'Ag=='])
  expect(batch.calls.filter(call => call[0] === 'prepare')).toHaveLength(2)

  const message = harness()
  await expect(
    message.handler.request(
      { method: 'signMessage', params: ['aGVsbG8='] },
      'https://dapp.example',
      {}
    )
  ).resolves.toEqual({ signature: '1'.repeat(64), publicKey: address, address })
  expect(message.calls.find(call => call[0] === 'approval')[1]).toBe('solanaMessage')
})

test('rejects malformed transactions and hardware signing before preparation', async () => {
  const malformed = harness()
  await expect(
    malformed.handler.request(
      { method: 'signTransaction', params: ['not-base64'] },
      'https://dapp.example',
      {}
    )
  ).rejects.toMatchObject({ code: -32602 })
  await expect(
    malformed.handler.request(
      {
        method: 'signAndSendTransaction',
        params: [transaction, { commitment: 'optimistic' }]
      },
      'https://dapp.example',
      {}
    )
  ).rejects.toMatchObject({ code: -32602 })
  const hardware = harness({ hardware: true })
  await expect(
    hardware.handler.request(
      { method: 'signTransaction', params: [transaction] },
      'https://dapp.example',
      {}
    )
  ).rejects.toMatchObject({ code: 4200 })
  expect(hardware.calls).toEqual([])
})
