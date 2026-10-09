import { expect, test } from '@playwright/test'

import { RheaSwapEvmSignatureCoordinator } from '../src/background/rhea-swap-evm-signature.ts'
import { InMemoryTransactionRepository } from '../src/infrastructure/persistence/repositories/in-memory-transaction-repository.ts'

const sender = '0x1111111111111111111111111111111111111111'
const privateSender = '0x2222222222222222222222222222222222222222'
const fingerprint = 'a'.repeat(64)

function binding(signingAddress = sender) {
  return {
    schemaVersion: 1,
    provider: 'rhea-cross-chain-dex',
    kind: 'swap',
    quoteHandle: 'rhea-quote:signature-one',
    executionId: 'execution-one',
    router: 'one-inch',
    sourceTarget: signingAddress,
    sender: signingAddress,
    originAmountRaw: '1000',
    expiresAt: 5_000,
    isCrossChain: true,
    origin: {
      chainId: 'eip155:1',
      assetId: 'eip155:1/slip44:60',
      protocolChainId: '1',
      protocolAssetId: 'native'
    },
    destination: {
      chainId: 'zcash:mainnet',
      assetId: 'zcash:mainnet/slip44:133',
      protocolChainId: 'zcash',
      protocolAssetId: 'nep141:zec.omft.near',
      recipient: 'u1destination',
      expectedAmountRaw: '900',
      minimumAmountRaw: '850'
    }
  }
}

function activeContext() {
  return {
    generationId: 'generation-one',
    keyDomainSource: { kind: 'mnemonic' },
    chainAccount: {
      id: 'chain-account-one',
      scope: {
        keyDomainId: 'wallet:one',
        accountId: 'account:one',
        chainId: 'eip155:1'
      },
      derivation: { scheme: 'bip44', path: "m/44'/60'/0'/0/0" },
      identity: { kind: 'account-identifier', value: sender }
    }
  }
}

function createPendingStore() {
  const values = new Map()
  return {
    values,
    async get(handle) {
      return values.get(handle) ?? null
    },
    async list() {
      return [...values.values()]
    },
    async put(value) {
      values.set(value.quoteHandle, value)
    },
    async delete(handle) {
      values.delete(handle)
    }
  }
}

function createHarness(overrides = {}) {
  let now = 1_000
  const calls = []
  const preparedPayloads = []
  const pending = createPendingStore()
  const repository = new InMemoryTransactionRepository()
  const plan = {
    quoteHandle: binding().quoteHandle,
    executionId: binding().executionId,
    chainId: 1,
    sender: overrides.sender ?? sender,
    signingScheme: 'eip712',
    typedDataJson: '{"domain":{},"message":{}}',
    approval: null
  }
  const submission = {
    quoteHandle: binding().quoteHandle,
    executionId: binding().executionId,
    router: 'one-inch',
    sourceHash: 'order-one',
    orderId: 'order-one',
    statusChainId: '1',
    reportStatus: 'pending'
  }
  const service = {
    async readEvmSignaturePlan() {
      calls.push('read-plan')
      return plan
    },
    async submitSignedOrder() {
      calls.push('submit-order')
      return submission
    },
    async reportSubmission() {
      calls.push('report')
      return submission
    },
    async discard() {
      calls.push('discard')
    },
    ...overrides.service
  }
  const signer = {
    async deriveGlobalPea() {
      calls.push('derive-pea')
      return { address: overrides.peaAddress ?? sender }
    },
    async prepare(_keyDomainId, payload) {
      calls.push('prepare-signature')
      preparedPayloads.push(payload)
      return {
        commandId: 'command-one',
        chainId: 'eip155:1',
        operation: 'message',
        summary: { schema: 'evm.typed-data.v1' },
        payloadFingerprint: { algorithm: 'sha256', digestHex: fingerprint },
        execution: { kind: 'internal' },
        expiresAt: 5_000
      }
    },
    async confirm() {
      calls.push('confirm-signature')
      return {
        kind: 'signature',
        signature: { encoding: 'hex', value: `0x${'ab'.repeat(65)}` },
        publicKey: 'public-key',
        address: overrides.signingAddress ?? sender
      }
    },
    async cancel() {
      calls.push('cancel-signature')
    },
    ...overrides.signer
  }
  let scheduleCount = 0
  const coordinator = new RheaSwapEvmSignatureCoordinator({
    service,
    signer,
    pending,
    repository,
    loadContext: async () => activeContext(),
    scheduleMonitoring: async () => {
      scheduleCount += 1
      calls.push('schedule')
      if (overrides.scheduleMonitoring) await overrides.scheduleMonitoring(scheduleCount)
    },
    now: () => now,
    createId: () => 'stable-one'
  })
  return {
    coordinator,
    calls,
    preparedPayloads,
    pending,
    repository,
    setNow(value) {
      now = value
    }
  }
}

test('prepares and confirms an account-bound EIP-712 Swap order', async () => {
  const harness = createHarness()
  const review = await harness.coordinator.prepare(binding().quoteHandle, binding())

  expect(review).toMatchObject({
    quoteHandle: binding().quoteHandle,
    chainId: 'eip155:1',
    sender,
    payloadFingerprint: fingerprint
  })

  const result = await harness.coordinator.confirm(binding().quoteHandle, fingerprint)
  expect(result.submission.orderId).toBe('order-one')
  expect(result.graph.root.id).toBe('tx:rhea-order:stable-one')
  expect(result.graph.segments[0]).toMatchObject({
    role: 'origin',
    evidence: { externalReference: 'order-one' }
  })
  expect(harness.calls).toEqual([
    'read-plan',
    'prepare-signature',
    'read-plan',
    'confirm-signature',
    'submit-order',
    'schedule',
    'report'
  ])
  expect(harness.pending.values.size).toBe(0)
})

test('derives and signs an EIP-712 Swap order with the Private Execution Account', async () => {
  const harness = createHarness({
    sender: privateSender,
    peaAddress: privateSender,
    signingAddress: privateSender
  })
  const privateBinding = binding(privateSender)

  const review = await harness.coordinator.prepare(
    privateBinding.quoteHandle,
    privateBinding,
    'private'
  )

  expect(review.sender).toBe(privateSender)
  expect(harness.preparedPayloads).toEqual([
    expect.objectContaining({ kind: 'pea-evm-typed-data', addressIndex: 0 })
  ])
  expect(harness.pending.values.get(privateBinding.quoteHandle)).toMatchObject({
    executionMode: 'private',
    sender: privateSender
  })

  await harness.coordinator.confirm(privateBinding.quoteHandle, fingerprint)
  expect(harness.calls.filter(call => call === 'derive-pea')).toHaveLength(2)
  expect(harness.pending.values.size).toBe(0)
})

test('retains the signed command and reuses the same graph after an interrupted submit path', async () => {
  let submitCount = 0
  const harness = createHarness({
    service: {
      async submitSignedOrder() {
        harness.calls.push('submit-order')
        submitCount += 1
        if (submitCount === 1) throw new Error('network unavailable')
        return {
          quoteHandle: binding().quoteHandle,
          executionId: binding().executionId,
          router: 'one-inch',
          sourceHash: 'order-one',
          orderId: 'order-one',
          statusChainId: '1',
          reportStatus: 'pending'
        }
      }
    }
  })
  await harness.coordinator.prepare(binding().quoteHandle, binding())
  await expect(harness.coordinator.confirm(binding().quoteHandle, fingerprint)).rejects.toThrow(
    'network unavailable'
  )

  harness.setNow(6_000)
  const recovered = await harness.coordinator.confirm(binding().quoteHandle, fingerprint)
  expect(recovered.graph.root.id).toBe('tx:rhea-order:stable-one')
  expect(harness.calls.filter(call => call === 'confirm-signature')).toHaveLength(1)
  expect(harness.calls.filter(call => call === 'read-plan')).toHaveLength(2)
})

test('uses stable graph timestamps when monitor scheduling is retried', async () => {
  const harness = createHarness({
    async scheduleMonitoring(attempt) {
      if (attempt === 1) throw new Error('alarm unavailable')
    }
  })
  await harness.coordinator.prepare(binding().quoteHandle, binding())
  await expect(harness.coordinator.confirm(binding().quoteHandle, fingerprint)).rejects.toThrow(
    'alarm unavailable'
  )

  harness.setNow(2_000)
  const recovered = await harness.coordinator.confirm(binding().quoteHandle, fingerprint)
  expect(recovered.graph.root.createdAt).toBe(1_000)
  expect(harness.calls.filter(call => call === 'confirm-signature')).toHaveLength(1)
})

test('cancels an unsigned command without submitting an order', async () => {
  const harness = createHarness()
  await harness.coordinator.prepare(binding().quoteHandle, binding())
  await harness.coordinator.cancel(binding().quoteHandle)

  expect(harness.calls).toEqual(['read-plan', 'prepare-signature', 'cancel-signature', 'discard'])
  expect(harness.pending.values.size).toBe(0)
})

test('keeps a signed command recoverable when cancellation races with navigation', async () => {
  const harness = createHarness({
    service: {
      async submitSignedOrder() {
        harness.calls.push('submit-order')
        throw new Error('network unavailable')
      }
    }
  })
  await harness.coordinator.prepare(binding().quoteHandle, binding())
  await expect(harness.coordinator.confirm(binding().quoteHandle, fingerprint)).rejects.toThrow(
    'network unavailable'
  )

  await harness.coordinator.cancel(binding().quoteHandle)
  expect(harness.pending.values.size).toBe(1)
  expect(harness.calls).not.toContain('cancel-signature')
  expect(harness.calls).not.toContain('discard')
})
