import { test } from 'node:test'
import { expect } from '@playwright/test'

import {
  createAssetRegistry,
  createEvmBitcoinChainRegistry,
  getBundledEvmAssetDefinitions,
  parseChainId
} from '../../../src/core/chains/registry/index.ts'
import {
  parseTransactionEventId,
  parseTransactionId,
  parseTransactionSegmentId
} from '../../../src/core/transactions/domain/index.ts'
import { ActivityCoordinator } from '../../../src/infrastructure/activity/index.ts'
import { parseActivityReadModel } from '../../../src/core/activity/index.ts'
import { parseConfidentialHistoryPage } from '../../../src/core/services/near-intents/confidential-history.ts'
import { filterActivityItems } from '../../../src/popup/services/activity-list-model.ts'
import { createEvmTransferGraph } from '../../../src/infrastructure/chains/evm/index.ts'
import { ConfidentialFundingApiError } from '../../../src/infrastructure/near-intents/confidential-funding-api.ts'
import { InMemoryTransactionRepository } from '../../../src/infrastructure/persistence/repositories/index.ts'

const chains = createEvmBitcoinChainRegistry('mainnet')
const assets = createAssetRegistry(chains, getBundledEvmAssetDefinitions('mainnet'))
const scope = { keyDomainId: 'wallet:activity', accountId: 'account:activity' }
const pointer = {
  schemaVersion: 2,
  generationId: 'metadata:generation:activity',
  sourceFingerprint: 'a'.repeat(64),
  committedAt: 1_000
}
const snapshot = {
  manifest: {
    schemaVersion: 2,
    generationId: pointer.generationId,
    status: 'verified',
    sourceFingerprint: pointer.sourceFingerprint,
    createdAt: 1_000,
    verifiedAt: 1_000,
    entityCounts: { keyDomains: 1, accounts: 1, chainAccounts: 0, addresses: 0 },
    activeAccount: scope
  },
  keyDomains: [],
  accounts: [],
  chainAccounts: [],
  addresses: []
}

function storage(overrides = {}) {
  return {
    getActivePointer: async () => pointer,
    getSnapshot: async () => snapshot,
    ...overrides
  }
}

function zcashTransaction(overrides = {}) {
  return {
    id: 'zcash-v1:activity',
    txHash: 'abc123',
    status: 'success',
    type: 'receive',
    amount: '0.5',
    to: 'u1recipient',
    from: '',
    fromType: 'shielded',
    fee: '0',
    timestamp: 1_200,
    network: 'mainnet',
    ...overrides
  }
}

async function repositoryWithEvmTransfer(transactionHash) {
  const repository = new InMemoryTransactionRepository()
  const graph = createEvmTransferGraph({
    prepared: {
      kind: 'native-transfer',
      chainId: parseChainId('eip155:1').id,
      addressIndex: 0,
      from: `0x${'1'.repeat(40)}`,
      assetId: 'eip155:1/slip44:60',
      recipient: `0x${'2'.repeat(40)}`,
      amountRaw: '1000000000000000000',
      observedBlockNumber: '100',
      transaction: {
        type: 'eip1559',
        chainId: '1',
        nonce: '1',
        maxFeePerGas: '5000000000',
        maxPriorityFeePerGas: '1000000000',
        gasLimit: '21000',
        to: `0x${'2'.repeat(40)}`,
        value: '1000000000000000000',
        input: '0x',
        accessList: []
      },
      createdAt: 1_100
    },
    scope,
    transactionId: parseTransactionId('transaction:evm:activity'),
    segmentId: parseTransactionSegmentId('segment:evm:activity'),
    assets
  })
  await repository.create(graph)
  if (transactionHash) {
    const result = await repository.applySegmentEvent({
      scope,
      transactionId: graph.root.id,
      segmentId: graph.segments[0].id,
      event: {
        id: parseTransactionEventId('event:evm:activity-broadcast'),
        status: 'broadcast',
        cause: 'progress',
        observedAt: 1_150,
        evidence: { transactionHash }
      },
      expectedRootRevision: 0,
      expectedSegmentRevision: 0
    })
    expect(result.status).toBe('applied')
  }
  return repository
}

function rpcActivity(transactionHash, overrides = {}) {
  return {
    id: `rpc:evm:${transactionHash}:native`,
    source: 'rpc',
    scope,
    kind: 'transfer',
    status: 'final',
    snapshot: {
      schemaVersion: 1,
      direction: 'outgoing',
      primaryAmount: { assetId: 'eip155:1/slip44:60', amountRaw: '42' },
      sender: { chainId: 'eip155:1', address: `0x${'3'.repeat(40)}` },
      recipient: { chainId: 'eip155:1', address: `0x${'1'.repeat(40)}` }
    },
    segments: [
      {
        id: `rpc:evm:${transactionHash}:origin`,
        role: 'origin',
        target: { kind: 'onchain', chainId: 'eip155:1' },
        status: 'final',
        evidence: { transactionHash, blockHash: `0x${'b'.repeat(64)}`, blockHeight: 100 }
      }
    ],
    completeness: 'complete',
    createdAt: 1_300,
    updatedAt: 1_300,
    ...overrides
  }
}

const confidentialOptions = { protocolProvider: 'Confidential Intents' }

function historyRow(overrides = {}) {
  return {
    depositAddress: 'shared-deposit.near',
    depositMemo: 'first',
    status: 'SUCCESS',
    depositType: 'ORIGIN_CHAIN',
    recipientType: 'CONFIDENTIAL_INTENTS',
    refundType: 'ORIGIN_CHAIN',
    createdAt: '2026-11-20T14:30:00.000000Z',
    destinationAsset: 'nep141:usdc',
    amountOutFormatted: '1.002001',
    ...overrides
  }
}

function historyCoordinator({
  getHistory,
  readSession = async requestedScope => ({ accessToken: requestedScope.accountId }),
  canRead = async () => true,
  repository = new InMemoryTransactionRepository(),
  readStorage = storage(),
  fundingPlans = new Map()
}) {
  const assetId = 'eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  return new ActivityCoordinator({
    storageRepository: readStorage,
    transactionRepository: repository,
    loadZcashTransactions: async () => {
      throw new Error('Confidential view must not load Zcash history')
    },
    confidentialHistory: {
      network: 'mainnet',
      canRead,
      api: { getHistory },
      readSession,
      fundingStore: {
        getPlansForTransactions: async ids =>
          new Map([...fundingPlans].filter(([id]) => ids.includes(id))),
        listExternalDeposits: async () => []
      },
      assetCatalog: {
        assets: new Map([[assetId, { metadata: { decimals: 6 } }]]),
        assetMappings: [{ assetId, protocolAssetId: 'nep141:usdc' }],
        evmNetworks: [],
        getProtocolTokens: () => []
      }
    }
  })
}

test.describe('Confidential activity history', () => {
  test('restores read-only Shield records and preserves distinct memos without a local ledger', async () => {
    const coordinator = historyCoordinator({
      getHistory: async () =>
        parseConfidentialHistoryPage({
          items: [
            historyRow(),
            historyRow({ depositMemo: 'second', destinationAsset: undefined }),
            historyRow({ depositMemo: 'public', recipientType: 'DESTINATION_CHAIN' })
          ]
        })
    })
    const before = await coordinator.readActive({
      ...confidentialOptions,
      includeSupplemental: false
    })
    expect(before.items).toEqual([])
    const model = parseActivityReadModel(await coordinator.readActive(confidentialOptions))
    const rows = filterActivityItems({
      items: model.items,
      selectedChainIds: [],
      domain: 'shield',
      shieldProvider: 'near-confidential',
      confidentialIntentsOnly: true
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      source: 'confidential-history',
      status: 'final',
      kind: 'shield',
      snapshot: { primaryAmount: { amountRaw: '1002001' } }
    })
    expect(rows[1].snapshot.primaryAmount).toBeUndefined()
  })

  test('prefers a known local funding order and leaves local Activity available without an invite', async () => {
    const repository = await repositoryWithEvmTransfer()
    const localGraphs = await repository.list({ scope, limit: 1 })
    const readRepository = { list: async () => localGraphs }
    let denied = false
    const rejectedTokens = []
    const coordinator = historyCoordinator({
      repository: readRepository,
      readSession: async (_scope, _isCurrent, rejectedToken) => {
        if (rejectedToken !== undefined) rejectedTokens.push(rejectedToken)
        return { accessToken: 'session-token' }
      },
      getHistory: async () => {
        if (denied) throw new ConfidentialFundingApiError('Invite required', 403, false)
        return parseConfidentialHistoryPage({
          items: [historyRow(), historyRow({ depositMemo: 'second' })]
        })
      },
      fundingPlans: new Map([
        [
          localGraphs[0].root.id,
          {
            ...scope,
            network: 'mainnet',
            depositQuote: {
              quote: { depositAddress: 'shared-deposit.near', depositMemo: 'first' }
            },
            withdraws: []
          }
        ]
      ])
    })
    const model = await coordinator.readActive(confidentialOptions)
    expect(model.items.map(item => item.source)).toEqual(['confidential-history', 'wallet-v2'])
    expect(model.items[0].id).toContain('second')
    denied = true
    const fallback = await coordinator.readActive(confidentialOptions)
    expect(fallback.items.map(item => item.source)).toEqual(['wallet-v2'])
    expect(fallback.confidentialHistoryUnavailable).toBeUndefined()
    expect(rejectedTokens).toEqual([])
  })

  test('retries a 401 exactly once with the renewed account session', async () => {
    for (const renewedSessionAccepted of [true, false]) {
      const rejectedTokens = []
      const historyTokens = []
      const coordinator = historyCoordinator({
        readSession: async (_scope, _isCurrent, rejectedToken) => {
          if (rejectedToken !== undefined) rejectedTokens.push(rejectedToken)
          return { accessToken: rejectedToken ? 'renewed-token' : 'expired-token' }
        },
        getHistory: async token => {
          historyTokens.push(token)
          if (token === 'expired-token' || !renewedSessionAccepted) {
            throw new ConfidentialFundingApiError('Unauthorized', 401, false)
          }
          return parseConfidentialHistoryPage({ items: [historyRow()] })
        }
      })
      const model = await coordinator.readActive(confidentialOptions)
      expect(model.items).toHaveLength(renewedSessionAccepted ? 1 : 0)
      expect(model.confidentialHistoryUnavailable).toBeUndefined()
      expect(rejectedTokens).toEqual(['expired-token'])
      expect(historyTokens).toEqual(['expired-token', 'renewed-token'])
    }
  })

  test('retries the same older cursor after failure and keeps cached rows visible', async () => {
    const cursors = []
    const coordinator = historyCoordinator({
      getHistory: async (_token, cursor) => {
        cursors.push(cursor)
        if (cursors.length === 2) throw new Error('Temporary failure')
        return parseConfidentialHistoryPage(
          cursor
            ? { items: [historyRow({ depositMemo: 'older' })] }
            : {
                items: Array.from({ length: 100 }, (_, index) =>
                  historyRow({ depositMemo: String(index) })
                ),
                prevCursor: 'older-page'
              }
        )
      }
    })
    const first = await coordinator.readActive(confidentialOptions)
    expect(first.hasMore).toBe(true)
    const older = { ...confidentialOptions, historyPageCount: 2 }
    await expect(coordinator.readActive(older)).rejects.toThrow(
      'Could not load older Confidential activity'
    )
    expect(
      await coordinator.readActive({ ...confidentialOptions, includeSupplemental: false })
    ).toEqual(first)
    const next = await coordinator.readActive(older)
    expect(next.items).toHaveLength(101)
    expect(next.hasMore).toBeUndefined()
    expect(cursors).toEqual([undefined, 'older-page', 'older-page'])
  })

  test('keeps history after a failed refresh and updates it on retry from the latest page', async () => {
    const cursors = []
    const coordinator = historyCoordinator({
      getHistory: async (_token, cursor) => {
        cursors.push(cursor)
        if (cursors.length === 2) throw new Error('Temporary failure')
        return parseConfidentialHistoryPage({
          items: [historyRow({ status: cursors.length === 1 ? 'PROCESSING' : 'SUCCESS' })]
        })
      }
    })
    const initial = await coordinator.readActive(confidentialOptions)
    expect(initial.items[0].status).toBe('confirming')
    const failed = await coordinator.readActive(confidentialOptions)
    expect(failed).toEqual({ ...initial, confidentialHistoryUnavailable: true })
    const retried = await coordinator.readActive(confidentialOptions)
    expect(retried.items[0].status).toBe('final')
    expect(retried.confidentialHistoryUnavailable).toBeUndefined()
    expect(cursors).toEqual([undefined, undefined, undefined])
  })

  test('drops a late history response after account switch', async () => {
    let activeAccount = scope
    const started = Promise.withResolvers()
    const response = Promise.withResolvers()
    const coordinator = historyCoordinator({
      readStorage: storage({
        getSnapshot: async () => ({
          ...snapshot,
          manifest: { ...snapshot.manifest, activeAccount }
        })
      }),
      getHistory: async token => {
        if (token !== scope.accountId) return { entries: [] }
        started.resolve()
        return response.promise
      }
    })
    const old = coordinator.readActive(confidentialOptions)
    await started.promise
    activeAccount = { ...scope, accountId: 'account:other' }
    coordinator.clearConfidentialHistory()
    await expect(coordinator.readActive(confidentialOptions)).resolves.toMatchObject({
      scope: activeAccount,
      items: []
    })
    response.resolve(parseConfidentialHistoryPage({ items: [historyRow()] }))
    await expect(old).resolves.toBeNull()
  })

  test('discards a late session renewal without retrying history for the old account', async () => {
    let activeAccount = scope
    const renewing = Promise.withResolvers()
    const renewal = Promise.withResolvers()
    const historyTokens = []
    const coordinator = historyCoordinator({
      readStorage: storage({
        getSnapshot: async () => ({
          ...snapshot,
          manifest: { ...snapshot.manifest, activeAccount }
        })
      }),
      readSession: async (requestedScope, _isCurrent, rejectedToken) => {
        if (rejectedToken !== undefined) {
          renewing.resolve()
          return renewal.promise
        }
        return { accessToken: requestedScope.accountId }
      },
      getHistory: async token => {
        historyTokens.push(token)
        if (token === scope.accountId) {
          throw new ConfidentialFundingApiError('Unauthorized', 401, false)
        }
        return { entries: [] }
      }
    })
    const old = coordinator.readActive(confidentialOptions)
    await renewing.promise
    activeAccount = { ...scope, accountId: 'account:other' }
    coordinator.clearConfidentialHistory()
    await expect(coordinator.readActive(confidentialOptions)).resolves.toMatchObject({
      scope: activeAccount,
      items: []
    })
    renewal.resolve({ accessToken: 'renewed-token' })
    await expect(old).resolves.toBeNull()
    expect(historyTokens).toEqual([scope.accountId, activeAccount.accountId])
  })
})

test.describe('Activity coordinator', () => {
  test('reads the active Account partition and combines Zcash V1 with non-Zcash V2', async () => {
    const loadedScopes = []
    const coordinator = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: await repositoryWithEvmTransfer(),
      loadZcashTransactions: async activeScope => {
        loadedScopes.push(activeScope)
        return [zcashTransaction()]
      }
    })

    await expect(coordinator.readActive()).resolves.toMatchObject({
      scope,
      items: [
        { id: 'zcash-v1:activity', source: 'zcash-v1' },
        { id: 'transaction:evm:activity', source: 'wallet-v2' }
      ]
    })
    expect(loadedScopes).toEqual([scope])
  })

  test('projects confirmed Zcash destination receipts into the matching transfer only', async () => {
    const destinationHash = 'b'.repeat(64)
    const destinationAsset = 'bip122:00040fe8ec8471911baa1db1266ea15d/slip44:133'
    const transfer = zcashTransaction({
      id: 'zcash-v1:private-transfer',
      txHash: 'a'.repeat(64),
      destinationTxHash: destinationHash,
      type: 'swap',
      amount: '0.0017',
      fromType: 'transparent',
      timestamp: 1_100,
      quoteBinding: {
        provider: 'rhea-cross-chain-dex',
        userAction: 'transfer',
        destinationAsset: 'nep141:zec.omft.near',
        expectedAmountOut: '137600',
        recipient: 't1owned'
      }
    })
    const receive = zcashTransaction({
      id: 'zcash-v1:destination-receive',
      txHash: destinationHash,
      type: 'receive',
      status: 'confirming',
      confirmations: 1,
      requiredConfirmations: 10,
      amount: '0.0014466',
      to: 't1owned',
      fromType: 'transparent',
      timestamp: 1_200
    })
    const read = async (receipts, source = transfer) => {
      const coordinator = new ActivityCoordinator({
        storageRepository: storage(),
        transactionRepository: new InMemoryTransactionRepository(),
        loadZcashTransactions: async () => [source, ...receipts]
      })
      return coordinator.readActive()
    }
    const settled = await read([receive])
    const item = settled.items.find(activity => activity.id === transfer.id)
    expect(settled.items.map(activity => activity.id)).toEqual([receive.id, transfer.id])
    expect(item.snapshot.counterAmount).toEqual({ assetId: destinationAsset, amountRaw: '137600' })
    expect(
      item.segments.find(segment => segment.role === 'destination')?.evidence?.settledAmount
    ).toEqual({ assetId: destinationAsset, amountRaw: '144660' })

    for (const mismatched of [
      { ...receive, confirmations: 0, status: 'pending' },
      { ...receive, network: 'testnet' },
      { ...receive, txHash: 'c'.repeat(64) },
      { ...receive, to: 't1other' }
    ]) {
      const result = await read([mismatched])
      expect(
        result.items
          .find(activity => activity.id === transfer.id)
          ?.segments.find(segment => segment.role === 'destination')?.evidence?.settledAmount
      ).toBeUndefined()
    }
    const noRecipient = await read([receive], {
      ...transfer,
      quoteBinding: { ...transfer.quoteBinding, recipient: undefined }
    })
    expect(
      noRecipient.items
        .find(activity => activity.id === transfer.id)
        ?.segments.find(segment => segment.role === 'destination')?.evidence?.settledAmount
    ).toBeUndefined()
    const otherRecipient = { ...receive, id: 'zcash-v1:other-receive', to: 't1other' }
    const sameHash = await read([receive, otherRecipient])
    expect(
      sameHash.items
        .find(activity => activity.id === transfer.id)
        ?.segments.find(segment => segment.role === 'destination')?.evidence?.settledAmount
    ).toEqual({ assetId: destinationAsset, amountRaw: '144660' })
  })

  test('uses the observed transparent credit for Unshield when present and the settled fallback otherwise', async () => {
    const unshield = zcashTransaction({
      id: 'tx_unshield',
      type: 'unshield',
      settledSelfTransferAmount: '0.49',
      confirmations: 4
    })
    const receipt = zcashTransaction({
      id: `rpc_treceive_${unshield.txHash}`,
      type: 'receive',
      fromType: 'transparent',
      amount: '0.49',
      confirmations: 5,
      timestamp: unshield.timestamp - 1
    })
    const read = async transactions =>
      new ActivityCoordinator({
        storageRepository: storage(),
        transactionRepository: new InMemoryTransactionRepository(),
        loadZcashTransactions: async () => transactions
      }).readActive()
    const readCredits = async transactions =>
      (await read(transactions)).items.filter(item => item.kind === 'receive')

    expect(await readCredits([unshield, receipt])).toMatchObject([
      { id: receipt.id, assetDomains: ['public'] }
    ])
    expect(await readCredits([unshield])).toMatchObject([
      { id: `receive:${unshield.id}`, assetDomains: ['public'] }
    ])
  })

  test('returns null without an active generation or Account', async () => {
    const repository = await repositoryWithEvmTransfer()
    const noPointer = new ActivityCoordinator({
      storageRepository: storage({ getActivePointer: async () => null }),
      transactionRepository: repository,
      loadZcashTransactions: async () => []
    })
    await expect(noPointer.readActive()).resolves.toBeNull()

    const noAccount = new ActivityCoordinator({
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          manifest: { ...snapshot.manifest, activeAccount: undefined }
        })
      }),
      transactionRepository: repository,
      loadZcashTransactions: async () => []
    })
    await expect(noAccount.readActive()).resolves.toBeNull()
  })

  test('adds external chain history and keeps the local transaction for a duplicate hash', async () => {
    const localHash = `0x${'a'.repeat(64)}`
    const remoteOnlyHash = `0x${'c'.repeat(64)}`
    const loadedRequests = []
    const coordinator = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: await repositoryWithEvmTransfer(localHash),
      loadZcashTransactions: async () => [],
      loadSupplementalItems: async (activeScope, accountMode, chainIds) => {
        loadedRequests.push({ activeScope, accountMode, chainIds })
        return [
          rpcActivity(localHash, { updatedAt: 9_000 }),
          rpcActivity(remoteOnlyHash, { createdAt: 1_400, updatedAt: 1_400 })
        ]
      }
    })

    const result = await coordinator.readActive({ chainIds: ['eip155:1'] })
    expect(loadedRequests).toEqual([
      { activeScope: scope, accountMode: 'main', chainIds: ['eip155:1'] }
    ])
    expect(result.items).toEqual([
      expect.objectContaining({ id: `rpc:evm:${remoteOnlyHash}:native`, source: 'rpc' }),
      expect.objectContaining({
        id: 'transaction:evm:activity',
        source: 'wallet-v2',
        status: 'final',
        segments: [
          expect.objectContaining({
            status: 'final',
            evidence: expect.objectContaining({ transactionHash: localHash, blockHeight: 100 })
          })
        ]
      })
    ])
    expect(result.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: `rpc:evm:${localHash}:native` })])
    )
  })

  test('returns cached supplemental Activity without waiting for a remote refresh', async () => {
    let supplementalReads = 0
    let cachedSupplementalReads = 0
    const cachedHash = `0x${'d'.repeat(64)}`
    const coordinator = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: await repositoryWithEvmTransfer(),
      loadZcashTransactions: async () => [zcashTransaction()],
      loadSupplementalItems: async () => {
        supplementalReads += 1
        return []
      },
      loadCachedSupplementalItems: async () => {
        cachedSupplementalReads += 1
        return [rpcActivity(cachedHash)]
      }
    })

    const result = await coordinator.readActive({ includeSupplemental: false })
    expect(supplementalReads).toBe(0)
    expect(cachedSupplementalReads).toBe(1)
    expect(result.items).toEqual([
      expect.objectContaining({ id: `rpc:evm:${cachedHash}:native`, source: 'rpc' }),
      expect.objectContaining({ id: 'zcash-v1:activity', source: 'zcash-v1' }),
      expect.objectContaining({ id: 'transaction:evm:activity', source: 'wallet-v2' })
    ])
  })

  test('fails closed when the active pointer and snapshot do not match', async () => {
    const coordinator = new ActivityCoordinator({
      storageRepository: storage({
        getSnapshot: async () => ({
          ...snapshot,
          manifest: { ...snapshot.manifest, sourceFingerprint: 'b'.repeat(64) }
        })
      }),
      transactionRepository: await repositoryWithEvmTransfer(),
      loadZcashTransactions: async () => []
    })

    await expect(coordinator.readActive()).rejects.toThrow(/does not match/)
  })

  test('retains local transactions and cached history when supplemental refresh throws', async () => {
    const cachedHash = `0x${'d'.repeat(64)}`
    const coordinator = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: await repositoryWithEvmTransfer(),
      loadZcashTransactions: async () => [zcashTransaction()],
      loadSupplementalItems: async () => {
        throw new Error('History source unavailable')
      },
      loadCachedSupplementalItems: async () => [rpcActivity(cachedHash)]
    })

    const result = await coordinator.readActive()
    expect(result.items.map(item => item.id)).toEqual([
      `rpc:evm:${cachedHash}:native`,
      'zcash-v1:activity',
      'transaction:evm:activity'
    ])
  })

  test('retains local transactions when refresh, cache, and private address derivation fail', async () => {
    const coordinator = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: await repositoryWithEvmTransfer(),
      loadZcashTransactions: async () => [zcashTransaction()],
      loadSupplementalItems: async () => {
        throw new Error('History source unavailable')
      },
      loadCachedSupplementalItems: async () => {
        throw new Error('History cache unavailable')
      },
      loadPrivateExecutionAddresses: async () => {
        throw new Error('Signer unavailable')
      }
    })

    for (const includeSupplemental of [true, false]) {
      const result = await coordinator.readActive({ includeSupplemental })
      expect(result.items.map(item => item.id)).toEqual([
        'zcash-v1:activity',
        'transaction:evm:activity'
      ])
    }
  })

  test('does not hide authoritative transaction storage or account filtering failures', async () => {
    const coordinator = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: {
        list: async () => {
          throw new Error('Local transaction storage unavailable')
        }
      },
      loadZcashTransactions: async () => []
    })
    await expect(coordinator.readActive()).rejects.toThrow('Local transaction storage unavailable')

    const filtered = new ActivityCoordinator({
      storageRepository: storage(),
      transactionRepository: await repositoryWithEvmTransfer(),
      loadZcashTransactions: async () => [],
      filterLocalGraphs: async () => {
        throw new Error('Account filter unavailable')
      }
    })
    await expect(filtered.readActive()).rejects.toThrow('Account filter unavailable')
  })
})
