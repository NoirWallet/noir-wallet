import { expect, test } from '@playwright/test'
import { encodeFunctionData, parseAbi } from 'viem'
import {
  decodeAaveSupplyCall,
  identifyAaveSupplyMethod
} from '../src/core/activity/aave-v3-ethereum.ts'
import {
  createAssetRegistry,
  createEvmBitcoinChainRegistry,
  getBundledEvmAssetDefinitions,
  parseChainId
} from '../src/core/chains/registry/index.ts'
import {
  buildActivityReadModel,
  mapTransactionGraphToActivityItem
} from '../src/core/activity/index.ts'
import {
  parseTransactionId,
  parseTransactionSegmentId
} from '../src/core/transactions/domain/index.ts'
import {
  buildEvmContractCall,
  createEvmTransferGraph
} from '../src/infrastructure/chains/evm/index.ts'
import { createEvmBlockscoutHistoryClient } from '../src/infrastructure/chains/evm/evm-blockscout-history-client.ts'
import {
  getActivityDetailTitle,
  getActivityRowTextPresentation,
  getAaveSupplyPresentation
} from '../src/popup/components/transaction/multichain-activity-presentation.ts'

const CHAIN_ID = parseChainId('eip155:1').id
const POOL = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2'
const GATEWAY = '0xd01607c3c5ecaba394d8be377a08590149325722'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const ADDRESS = '0x1111111111111111111111111111111111111111'
const assets = createAssetRegistry(
  createEvmBitcoinChainRegistry('mainnet'),
  getBundledEvmAssetDefinitions('mainnet')
)
const account = {
  id: 'chain-account:aave-test',
  scope: { keyDomainId: 'key-domain:aave-test', accountId: 'account:aave-test', chainId: CHAIN_ID },
  derivation: { scheme: 'bip44', path: "m/44'/60'/0'/0/0" },
  identity: { kind: 'account-identifier', value: ADDRESS },
  createdAt: 1
}
const gatewayAbi = parseAbi([
  'function depositETH(address pool, address onBehalfOf, uint16 referralCode) payable'
])
const poolAbi = parseAbi([
  'function supplyWithPermit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode, uint256 deadline, uint8 permitV, bytes32 permitR, bytes32 permitS)'
])

const ethCall = encodeFunctionData({
  abi: gatewayAbi,
  functionName: 'depositETH',
  args: [POOL, ADDRESS, 0]
})
const usdcCall = encodeFunctionData({
  abi: poolAbi,
  functionName: 'supplyWithPermit',
  args: [
    USDC,
    2_500_000n,
    ADDRESS,
    0,
    2_000_000_000n,
    27,
    `0x${'1'.repeat(64)}`,
    `0x${'2'.repeat(64)}`
  ]
})

async function makeGraph(recipient, calldata, valueRaw, id) {
  const prepared = await buildEvmContractCall({
    chainId: CHAIN_ID,
    chainAccount: account,
    assets,
    intent: { chainId: CHAIN_ID, contractAddress: recipient, valueRaw, calldata },
    rpc: {
      assertExpectedChain: async () => {},
      getNativeBalance: async () => '1000000000000000000',
      getPendingNonce: async () => '1',
      simulateCall: async () => '0x',
      estimateGas: async () => '100000',
      getMaximumPriorityFeePerGas: async () => '1000000000',
      getLatestBlockFee: async () => ({ blockNumber: '100', baseFeePerGas: '2000000000' })
    },
    now: () => 1000
  })
  return createEvmTransferGraph({
    prepared,
    scope: account.scope,
    transactionId: parseTransactionId(`transaction:aave:${id}`),
    segmentId: parseTransactionSegmentId(`segment:aave:${id}`),
    chainAccountId: account.id,
    assets
  })
}

test('recognizes only verified Ethereum Aave Supply calls and decodes their assets', () => {
  expect(
    decodeAaveSupplyCall({
      chainId: CHAIN_ID,
      recipient: GATEWAY,
      calldata: ethCall,
      valueRaw: '500000000000000'
    })
  ).toMatchObject({
    method: 'depositETH',
    assetId: 'eip155:1/slip44:60',
    amountRaw: '500000000000000'
  })
  expect(
    decodeAaveSupplyCall({ chainId: CHAIN_ID, recipient: POOL, calldata: usdcCall, valueRaw: '0' })
  ).toMatchObject({
    method: 'supplyWithPermit',
    assetId: `eip155:1/erc20:${USDC}`,
    amountRaw: '2500000'
  })
  expect(
    decodeAaveSupplyCall({
      chainId: 'eip155:42161',
      recipient: POOL,
      calldata: usdcCall,
      valueRaw: '0'
    })
  ).toBeNull()
  expect(
    decodeAaveSupplyCall({
      chainId: CHAIN_ID,
      recipient: ADDRESS,
      calldata: usdcCall,
      valueRaw: '0'
    })
  ).toBeNull()
  expect(
    decodeAaveSupplyCall({
      chainId: CHAIN_ID,
      recipient: GATEWAY,
      calldata: ethCall,
      valueRaw: '0'
    })
  ).toBeNull()
  expect(identifyAaveSupplyMethod(CHAIN_ID, POOL, '0xa9059cbb')).toBeNull()
})

test('persists Aave Supply amounts and presents ETH and USDC by asset', async () => {
  const eth = mapTransactionGraphToActivityItem(
    await makeGraph(GATEWAY, ethCall, '500000000000000', 'eth')
  )
  const usdc = mapTransactionGraphToActivityItem(await makeGraph(POOL, usdcCall, '0', 'usdc'))
  const unrelated = mapTransactionGraphToActivityItem(
    await makeGraph(ADDRESS, usdcCall, '0', 'unrelated')
  )
  expect(eth).toMatchObject({
    kind: 'supply',
    snapshot: {
      direction: 'outgoing',
      primaryAmount: { assetId: 'eip155:1/slip44:60', amountRaw: '500000000000000' }
    }
  })
  expect(usdc).toMatchObject({
    kind: 'supply',
    snapshot: {
      direction: 'outgoing',
      primaryAmount: { assetId: `eip155:1/erc20:${USDC}`, amountRaw: '2500000' }
    }
  })
  expect(getActivityRowTextPresentation(eth, 'ETH', undefined, 'Ethereum')).toEqual({
    title: 'Supplied ETH',
    subtitle: 'Aave V3 · Ethereum'
  })
  expect(getActivityRowTextPresentation(usdc, 'USDC', undefined, 'Ethereum')).toEqual({
    title: 'Supplied USDC',
    subtitle: 'Aave V3 · Ethereum'
  })
  expect(getActivityDetailTitle(usdc)).toBe('Supply to Aave')
  expect(getAaveSupplyPresentation(usdc)).toEqual({
    protocol: 'Aave V3',
    methodLabel: 'Supply with permit'
  })
  expect(unrelated.kind).toBe('contract-call')
  expect(getAaveSupplyPresentation(unrelated)).toBeNull()
})

test('recovers an existing USDC Supply amount from matching on-chain history', async () => {
  const legacyEth = structuredClone(
    await makeGraph(GATEWAY, ethCall, '500000000000000', 'legacy-eth')
  )
  legacyEth.root.kind = 'contract-call'
  legacyEth.root.intent.direction = 'contract'
  expect(mapTransactionGraphToActivityItem(legacyEth)).toMatchObject({
    kind: 'supply',
    snapshot: {
      direction: 'outgoing',
      primaryAmount: { assetId: `${CHAIN_ID}/slip44:60`, amountRaw: '500000000000000' }
    }
  })

  const graph = structuredClone(await makeGraph(POOL, usdcCall, '0', 'legacy-usdc'))
  graph.root.kind = 'contract-call'
  graph.root.intent.direction = 'contract'
  delete graph.root.intent.primaryAmount
  graph.segments[0].evidence = {
    transactionHash: `0x${'A'.repeat(64)}`
  }

  const legacyItem = mapTransactionGraphToActivityItem(graph)
  expect(legacyItem).toMatchObject({ kind: 'supply', snapshot: { direction: 'outgoing' } })
  expect(legacyItem.snapshot).not.toHaveProperty('primaryAmount')
  expect(getActivityRowTextPresentation(legacyItem, undefined, undefined, 'Ethereum')).toEqual({
    title: 'Supplied to Aave',
    subtitle: 'Aave V3 · Ethereum'
  })

  const history = createEvmBlockscoutHistoryClient(
    {
      chainId: CHAIN_ID,
      apiUrl: 'https://eth.blockscout.example/api/',
      nativeAssetId: `${CHAIN_ID}/slip44:60`,
      trackedErc20Assets: [{ assetId: `${CHAIN_ID}/erc20:${USDC}`, contract: USDC, decimals: 6 }],
      readFinalizedBlockNumber: async () => '100'
    },
    async request => {
      const normal = {
        blockHash: `0x${'b'.repeat(64)}`,
        blockNumber: '100',
        confirmations: '5',
        from: ADDRESS,
        gasPrice: '1000000000',
        gasUsed: '100000',
        hash: `0x${'a'.repeat(64)}`,
        input: usdcCall,
        isError: '0',
        nonce: '7',
        timeStamp: '1700000000',
        to: POOL,
        txreceipt_status: '1',
        value: '0'
      }
      const token = {
        blockHash: normal.blockHash,
        blockNumber: normal.blockNumber,
        confirmations: normal.confirmations,
        contractAddress: USDC,
        from: ADDRESS,
        hash: normal.hash,
        nonce: normal.nonce,
        timeStamp: normal.timeStamp,
        to: POOL,
        tokenDecimal: '6',
        value: '2500000'
      }
      const result = new URL(request).searchParams.get('action') === 'txlist' ? [normal] : [token]
      return new Response(JSON.stringify({ status: '1', message: 'OK', result }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }
  )
  const rpcItems = await history.readAddressActivity({ scope: graph.root.scope, address: ADDRESS })
  expect(rpcItems).toHaveLength(1)
  expect(rpcItems[0]).toMatchObject({
    kind: 'supply',
    snapshot: {
      direction: 'outgoing',
      primaryAmount: { assetId: `${CHAIN_ID}/erc20:${USDC}`, amountRaw: '2500000' },
      recipient: { address: POOL }
    }
  })

  const model = buildActivityReadModel({
    scope: graph.root.scope,
    localGraphs: [graph],
    supplementalItems: rpcItems
  })
  expect(model.items).toHaveLength(1)
  expect(model.items[0]).toMatchObject({
    id: graph.root.id,
    source: 'wallet-v2',
    kind: 'supply',
    status: 'final',
    snapshot: {
      primaryAmount: { assetId: `${CHAIN_ID}/erc20:${USDC}`, amountRaw: '2500000' }
    }
  })

  const cachedTokenTransfer = {
    ...rpcItems[0],
    kind: 'transfer',
    snapshot: {
      ...rpcItems[0].snapshot,
      recipient: { chainId: CHAIN_ID, address: '0x2222222222222222222222222222222222222222' }
    }
  }
  const cachedModel = buildActivityReadModel({
    scope: graph.root.scope,
    localGraphs: [graph],
    supplementalItems: [cachedTokenTransfer]
  })
  expect(cachedModel.items[0].snapshot.primaryAmount).toEqual({
    assetId: `${CHAIN_ID}/erc20:${USDC}`,
    amountRaw: '2500000'
  })

  const wrongSenderModel = buildActivityReadModel({
    scope: graph.root.scope,
    localGraphs: [graph],
    supplementalItems: [
      {
        ...cachedTokenTransfer,
        snapshot: {
          ...cachedTokenTransfer.snapshot,
          sender: { chainId: CHAIN_ID, address: '0x3333333333333333333333333333333333333333' }
        }
      }
    ]
  })
  expect(wrongSenderModel.items[0].snapshot).not.toHaveProperty('primaryAmount')
})
