import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleShieldDAppRequest } from '../../../src/background/shield-dapp-handler.ts'
import { ShieldProviderError } from '../../../src/core/dapp/shield-provider.ts'

const scope = {
  network: 'mainnet',
  keyDomainId: 'wallet:one',
  accountId: 'account:one'
}
const operationId = 'd065c72d-9db6-411d-ab1b-f5e977b5c55a'

test('refresh status reads the stored Shield operation for the active account', async () => {
  let queried = null
  const result = await handleShieldDAppRequest({
    method: 'shield_getTransactionStatus',
    params: { layer: 'near-confidential', operationId },
    coordinator: {
      readShieldDappStatus: async input => {
        queried = input
        return {
          id: input.operationId,
          layer: 'near-confidential',
          action: 'receive',
          status: 'processing',
          providerStatus: 'PROCESSING'
        }
      }
    },
    scope
  })

  assert.deepEqual(queried, { scope, operationId })
  assert.deepEqual(result, {
    id: operationId,
    layer: 'near-confidential',
    action: 'receive',
    status: 'processing',
    providerStatus: 'PROCESSING'
  })
})

test('public Shield transfer prepares, asks for approval, and confirms', async () => {
  const calls = []
  const result = await handleShieldDAppRequest({
    method: 'shield_transfer',
    params: {
      layer: 'near-confidential',
      token: { chainId: 'eip155:56', assetId: 'eip155:56/slip44:714' },
      amount: '0.10',
      destination: {
        kind: 'public',
        chainId: 'eip155:1',
        assetId: 'eip155:1/slip44:60',
        address: '0x1111111111111111111111111111111111111111'
      }
    },
    coordinator: {
      prepareShieldDappTransfer: async input => {
        calls.push(['prepare', input])
        return {
          planId: operationId,
          payloadFingerprint: 'a'.repeat(64),
          amount: '0.10',
          symbol: 'BNB',
          chainName: 'BNB Smart Chain',
          assetId: 'eip155:56/slip44:714',
          sourceAddress: '0x2222222222222222222222222222222222222222',
          expectedReceive: '0.05',
          expectedSymbol: 'ETH',
          quoteDifference: '0.001',
          destinationAddress: '0x1111111111111111111111111111111111111111',
          destinationChainName: 'Ethereum',
          destinationSymbol: 'ETH',
          destinationAssetId: 'eip155:1/slip44:60'
        }
      },
      confirm: async (planId, fingerprint) => {
        calls.push(['confirm', planId, fingerprint])
        return {
          planId,
          phase: 'authorized',
          operation: 'withdraw'
        }
      },
      reportStoredShieldDappPlan: plan => ({
        id: plan.planId,
        layer: 'near-confidential',
        action: 'transfer',
        status: 'authorized',
        source: {
          chainId: 'eip155:56',
          assetId: 'eip155:56/slip44:714',
          symbol: 'BNB',
          amount: '0.10'
        },
        destination: {
          chainId: 'eip155:1',
          assetId: 'eip155:1/slip44:60',
          symbol: 'ETH',
          amount: '0.05'
        },
        references: { transactionHashes: ['0xabc'], orderId: 'order-1' }
      }),
      cancel: async planId => {
        calls.push(['cancel', planId])
      }
    },
    scope,
    requestApproval: async (action, summary) => {
      calls.push(['approval', action, summary])
      return true
    }
  })

  assert.equal(calls[0][0], 'prepare')
  assert.equal(calls[0][1].amount, '0.10')
  assert.equal(calls[0][1].destination.address, '0x1111111111111111111111111111111111111111')
  assert.equal(calls[1][0], 'approval')
  assert.equal(calls[1][1], 'shieldTransfer')
  assert.equal(calls[1][2].destinationChainName, 'Ethereum')
  assert.equal(calls[1][2].layer, 'near-confidential')
  assert.equal(calls[1][2].sourceAddress, '0x2222222222222222222222222222222222222222')
  assert.equal(calls[1][2].quoteDifference, '0.001')
  assert.equal(calls[1][2].networkFee, undefined)
  assert.equal(calls[1][2].planId, undefined)
  assert.equal(calls[2][0], 'confirm')
  assert.deepEqual(result, {
    id: operationId,
    layer: 'near-confidential',
    action: 'transfer',
    status: 'authorized',
    source: {
      chainId: 'eip155:56',
      assetId: 'eip155:56/slip44:714',
      symbol: 'BNB',
      amount: '0.10'
    },
    destination: {
      chainId: 'eip155:1',
      assetId: 'eip155:1/slip44:60',
      symbol: 'ETH',
      amount: '0.05'
    },
    references: { transactionHashes: ['0xabc'], orderId: 'order-1' }
  })
})

test('Shield receive approval shows the source account, quote, and network fee', async () => {
  let summary = null
  await handleShieldDAppRequest({
    method: 'shield_receive',
    params: {
      layer: 'near-confidential',
      source: { chainId: 'eip155:56', assetId: 'eip155:56/slip44:714' },
      amount: '0.10'
    },
    coordinator: {
      prepareShieldDappReceive: async () => ({
        planId: operationId,
        payloadFingerprint: 'b'.repeat(64),
        amount: '0.10',
        symbol: 'BNB',
        chainName: 'BNB Smart Chain',
        assetId: 'eip155:56/slip44:714',
        sourceAddress: '0x2222222222222222222222222222222222222222',
        expectedReceive: '0.099',
        expectedSymbol: 'BNB',
        quoteDifference: '0.001',
        networkFee: '0.0001',
        networkFeeSymbol: 'BNB'
      }),
      confirm: async () => ({ planId: operationId, operation: 'deposit', phase: 'authorized' }),
      reportStoredShieldDappPlan: plan => ({
        id: plan.planId,
        layer: 'near-confidential',
        action: 'receive',
        status: 'authorized'
      }),
      cancel: async () => {
        throw new Error('not called')
      }
    },
    scope,
    requestApproval: async (action, approval) => {
      summary = { action, approval }
      return true
    }
  })

  assert.deepEqual(summary, {
    action: 'shieldReceive',
    approval: {
      layer: 'near-confidential',
      amount: '0.10',
      symbol: 'BNB',
      chainName: 'BNB Smart Chain',
      assetId: 'eip155:56/slip44:714',
      sourceAddress: '0x2222222222222222222222222222222222222222',
      expectedReceive: '0.099',
      expectedSymbol: 'BNB',
      quoteDifference: '0.001',
      networkFee: '0.0001',
      networkFeeSymbol: 'BNB'
    }
  })
})

test('rejected Shield receive cancels the prepared plan and returns 4001', async () => {
  const calls = []
  await assert.rejects(
    handleShieldDAppRequest({
      method: 'shield_receive',
      params: {
        layer: 'near-confidential',
        source: { chainId: 'eip155:56', assetId: 'eip155:56/slip44:714' },
        amount: '0.10'
      },
      coordinator: {
        prepareShieldDappReceive: async () => {
          calls.push('prepare')
          return {
            planId: operationId,
            payloadFingerprint: 'c'.repeat(64),
            amount: '0.10',
            symbol: 'BNB',
            chainName: 'BNB Smart Chain',
            assetId: 'eip155:56/slip44:714',
            sourceAddress: '0x2222222222222222222222222222222222222222',
            expectedReceive: '0.099',
            expectedSymbol: 'BNB'
          }
        },
        cancel: async planId => {
          calls.push(['cancel', planId])
        },
        confirm: async () => {
          throw new Error('not called')
        },
        reportStoredShieldDappPlan: () => {
          throw new Error('not called')
        }
      },
      scope,
      requestApproval: async () => false
    }),
    error => error instanceof ShieldProviderError && error.code === 4001
  )
  assert.deepEqual(calls, ['prepare', ['cancel', operationId]])
})

test('confidential Shield transfer stays unconfirmed by the protocol', async () => {
  await assert.rejects(
    handleShieldDAppRequest({
      method: 'shield_transfer',
      params: {
        layer: 'near-confidential',
        token: { chainId: 'eip155:56', assetId: 'eip155:56/slip44:714' },
        amount: '0.10',
        destination: { kind: 'confidential', accountId: 'someone.near' }
      },
      coordinator: {
        prepareShieldDappTransfer: async () => {
          throw new Error('not called')
        }
      },
      scope,
      requestApproval: async () => true
    }),
    error =>
      error instanceof ShieldProviderError &&
      error.code === 4200 &&
      /not confirmed by the protocol/i.test(error.message)
  )
})

test('status refresh rejects a missing or malformed operation id', async () => {
  const coordinator = { readShieldDappStatus: async () => { throw new Error('not called') } }
  await assert.rejects(
    handleShieldDAppRequest({
      method: 'shield_getTransactionStatus',
      params: { layer: 'near-confidential' },
      coordinator,
      scope
    }),
    error => error instanceof ShieldProviderError && error.code === -32602
  )
  await assert.rejects(
    handleShieldDAppRequest({
      method: 'shield_getTransactionStatus',
      params: { layer: 'near-confidential', operationId: 'not an id' },
      coordinator,
      scope
    }),
    error => error instanceof ShieldProviderError && error.code === -32602
  )
})
