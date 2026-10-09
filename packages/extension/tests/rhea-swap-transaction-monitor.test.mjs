import { expect, test } from '@playwright/test'

import { RheaSwapTransactionMonitor } from '../src/background/rhea-swap-transaction-monitor.ts'
import {
  createRheaSwapSignedBatchGraph,
  parseTransactionEventId,
  parseTransactionId,
  parseTransactionSegmentId
} from '../src/core/transactions/domain/index.ts'
import { InMemoryTransactionRepository } from '../src/infrastructure/persistence/repositories/in-memory-transaction-repository.ts'
import { assertPersistableTransactionGraph } from '../src/infrastructure/persistence/repositories/transaction-repository-support.ts'

const scope = { keyDomainId: 'wallet:near', accountId: 'account:near' }
const sourceHashes = ['1'.repeat(32), `${'1'.repeat(31)}2`]
const destinationHash = `0x${'ab'.repeat(32)}`

function graph() {
  return createRheaSwapSignedBatchGraph({
    transactionId: parseTransactionId('tx:rhea-near:monitor'),
    scope,
    binding: {
      schemaVersion: 1,
      provider: 'rhea-cross-chain-dex',
      kind: 'swap',
      quoteHandle: 'rhea-quote:monitor',
      executionId: 'execution-monitor',
      router: 'near-intents',
      sourceTarget: 'router.near',
      sender: 'alice.near',
      originAmountRaw: '1000',
      expiresAt: 5_000,
      isCrossChain: true,
      origin: {
        chainId: 'near:mainnet',
        assetId: 'near:mainnet/slip44:397',
        protocolChainId: 'near',
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
    },
    sourceHashes,
    segmentIds: {
      origins: [
        parseTransactionSegmentId('segment:rhea-near:origin:0:monitor'),
        parseTransactionSegmentId('segment:rhea-near:origin:1:monitor')
      ],
      relay: parseTransactionSegmentId('segment:rhea-near:relay:monitor'),
      destination: parseTransactionSegmentId('segment:rhea-near:destination:monitor'),
      refund: parseTransactionSegmentId('segment:rhea-near:refund:monitor')
    },
    now: 1_000
  })
}

async function broadcast(repository, current, segmentIndex, observedAt) {
  const segment = current.segments.filter(candidate => candidate.role === 'origin')[segmentIndex]
  const result = await repository.applySegmentEvent({
    scope,
    transactionId: current.root.id,
    segmentId: segment.id,
    event: {
      id: parseTransactionEventId(`event:rhea-near:broadcast:${segmentIndex}`),
      status: 'broadcast',
      cause: 'progress',
      observedAt,
      evidence: { transactionHash: sourceHashes[segmentIndex], requiredConfirmations: 1 }
    },
    expectedRootRevision: current.root.revision,
    expectedSegmentRevision: segment.revision
  })
  expect(result.status).toBe('applied')
  return result.graph
}

test('waits for every NEAR origin before reporting the final batch hash', async () => {
  const calls = []
  const service = {
    async recordTransactionSubmission(_handle, sourceHash) {
      calls.push(`record:${sourceHash}`)
    },
    async reportSubmission() {
      calls.push('report')
    },
    async getOrderStatus() {
      calls.push('status')
      return { status: 'pending' }
    },
    async discard() {
      calls.push('discard')
    }
  }
  const repository = new InMemoryTransactionRepository()
  const initial = graph()
  expect(() => assertPersistableTransactionGraph(initial)).not.toThrow()
  await repository.create(initial)
  const firstBroadcast = await broadcast(repository, initial, 0, 1_001)
  const monitor = new RheaSwapTransactionMonitor(service)
  monitor.repository = repository

  await expect(monitor.checkGraph(firstBroadcast)).resolves.toBe(false)
  expect(calls).toEqual([])

  const fullBroadcast = await broadcast(repository, firstBroadcast, 1, 1_002)
  await expect(monitor.checkGraph(fullBroadcast)).resolves.toBe(false)
  expect(calls).toEqual([`record:${sourceHashes[1]}`, 'report', 'status'])
})

test('refreshes both affected chains as soon as a RHEA order completes', async () => {
  const refreshes = []
  const notifications = []
  const service = {
    async recordTransactionSubmission() {},
    async reportSubmission() {},
    async getOrderStatus() {
      return { status: 'completed', destinationHash }
    },
    async discard() {}
  }
  const repository = new InMemoryTransactionRepository()
  const initial = graph()
  await repository.create(initial)
  const firstBroadcast = await broadcast(repository, initial, 0, 1_001)
  const fullBroadcast = await broadcast(repository, firstBroadcast, 1, 1_002)
  const monitor = new RheaSwapTransactionMonitor(service, {
    refreshPortfolio: async request => refreshes.push(request),
    notifyStatus: (quoteHandle, status) => notifications.push({ quoteHandle, status })
  })
  monitor.repository = repository

  await expect(monitor.checkGraph(fullBroadcast)).resolves.toBe(true)
  const completed = await repository.get(scope, fullBroadcast.root.id)
  expect(completed.segments.find(segment => segment.role === 'destination').evidence).toMatchObject(
    {
      transactionHash: destinationHash
    }
  )
  expect(refreshes).toEqual([
    {
      scope,
      chainIds: ['near:mainnet', 'zcash:mainnet']
    }
  ])
  expect(notifications).toEqual([
    {
      quoteHandle: 'rhea-quote:monitor',
      status: {
        status: 'SUCCESS',
        originAsset: 'near:mainnet/slip44:397',
        destinationAsset: 'zcash:mainnet/slip44:133'
      }
    }
  ])
})

test('persists a destination hash while the RHEA order is still processing', async () => {
  const service = {
    async recordTransactionSubmission() {},
    async reportSubmission() {},
    async getOrderStatus() {
      return { status: 'processing', destinationHash }
    },
    async discard() {
      throw new Error('A processing order must remain monitored')
    }
  }
  const repository = new InMemoryTransactionRepository()
  const initial = graph()
  await repository.create(initial)
  const firstBroadcast = await broadcast(repository, initial, 0, 1_001)
  const fullBroadcast = await broadcast(repository, firstBroadcast, 1, 1_002)
  const monitor = new RheaSwapTransactionMonitor(service, { notifyStatus: () => {} })
  monitor.repository = repository

  await expect(monitor.checkGraph(fullBroadcast)).resolves.toBe(false)
  const processing = await repository.get(scope, fullBroadcast.root.id)
  expect(processing.segments.find(segment => segment.role === 'destination')).toMatchObject({
    status: 'broadcast',
    evidence: { transactionHash: destinationHash }
  })
  expect(processing.root.status).not.toBe('final')

  await expect(monitor.checkGraph(processing)).resolves.toBe(false)
  const repeated = await repository.get(scope, fullBroadcast.root.id)
  expect(repeated.segments.find(segment => segment.role === 'destination').revision).toBe(
    processing.segments.find(segment => segment.role === 'destination').revision
  )
})

test('still reads cross-chain completion when submission reporting fails', async () => {
  const calls = []
  const service = {
    async recordTransactionSubmission() {
      calls.push('record')
    },
    async reportSubmission() {
      calls.push('report')
      throw new Error('report unavailable')
    },
    async getOrderStatus() {
      calls.push('status')
      return { status: 'completed' }
    },
    async discard() {
      calls.push('discard')
    }
  }
  const repository = new InMemoryTransactionRepository()
  const initial = graph()
  await repository.create(initial)
  const firstBroadcast = await broadcast(repository, initial, 0, 1_001)
  const fullBroadcast = await broadcast(repository, firstBroadcast, 1, 1_002)
  const monitor = new RheaSwapTransactionMonitor(service, { notifyStatus: () => {} })
  monitor.repository = repository

  await expect(monitor.checkGraph(fullBroadcast)).resolves.toBe(true)
  expect(calls).toEqual(['record', 'report', 'status', 'discard'])
})
