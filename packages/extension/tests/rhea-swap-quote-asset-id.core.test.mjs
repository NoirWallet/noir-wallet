import assert from 'node:assert/strict'
import { it } from 'node:test'
import { serializeQuoteRequest } from '@rhea-finance/cross-chain-aggregation-dex'
import {
  parseRheaSwapQuoteRequest,
  toRheaSwapToken,
  toSdkQuoteRequest
} from '../src/core/services/rhea-swap/rhea-swap-model.ts'
import { parseRheaSwapToken } from '../src/core/services/rhea-swap/rhea-swap-runtime.ts'
import {
  filterSelectableSwapDestinationTokens,
  filterSwapDestinationTokens
} from '../src/popup/services/swap-page-model.ts'
import {
  getRheaSwapErrorMessage,
  RheaSwapClientError
} from '../src/popup/services/rhea-swap-client.ts'

it('quotes an EVM ERC-20 by its on-chain contract while retaining the catalog asset ID', () => {
  const assetId = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
  const contractAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  const token = toRheaSwapToken({
    chain: '8453',
    address: assetId,
    assetId,
    symbol: 'USDC',
    decimals: 6,
    isNative: false,
    tokenListChainId: 8453,
    blockchain: 'base',
    contractAddress,
    coinType: null,
    name: 'USD Coin',
    logoURI: null,
    price: '1',
    priceUpdatedAt: null,
    sources: ['nearintents'],
    raw: { address: contractAddress, assetId }
  })
  assert.equal(token.rheaAddress, contractAddress)
  assert.equal(token.contractAddress, contractAddress)
  assert.deepEqual(token.sources, ['nearintents'])

  const request = toSdkQuoteRequest(
    parseRheaSwapQuoteRequest({
      fromChain: '1',
      toChain: token.rheaChainId,
      tokenIn: { chain: '1', address: 'nep141:eth.omft.near', isNative: true },
      tokenOut: {
        chain: token.rheaChainId,
        address: token.rheaAddress,
        isNative: token.isNative
      },
      amountIn: '10000000000000000',
      slippageBps: 50,
      sender: `0x${'1'.repeat(40)}`,
      recipient: `0x${'2'.repeat(40)}`,
      confidentiality: 'basic'
    })
  )
  const serialized = serializeQuoteRequest(request)
  assert.equal(serialized.tokenOut, contractAddress)
  assert.notEqual(serialized.tokenOut, assetId)
})

it('keeps Main destinations while limiting Private to declared NearIntents sources', () => {
  const near = { assetId: 'near', sources: ['nearIntents'] }
  const preSwap = { assetId: 'pre', sources: ['preswap-nearintents'] }
  const ordinary = { assetId: 'ordinary', sources: ['lifi', 'okx'] }
  const unknown = { assetId: 'unknown' }
  const catalog = [near, preSwap, ordinary, unknown]
  assert.equal(filterSwapDestinationTokens(catalog, undefined), catalog)
  assert.deepEqual(filterSwapDestinationTokens(catalog, 'basic'), [near, preSwap])
})

it('applies the Private route limit before cross-chain Send destination grouping', () => {
  const sourceToken = { rheaChainId: '1', isNative: true, sources: ['lifi'] }
  const near = { rheaChainId: '8453', isNative: true, sources: ['nearintents'] }
  const ordinary = { rheaChainId: '8453', isNative: true, sources: ['lifi'] }
  const options = {
    tokens: [near, ordinary],
    sourceToken,
    crossChainSendRequested: true,
    capabilities: { evm: true, solana: false }
  }
  assert.deepEqual(
    filterSelectableSwapDestinationTokens({ ...options, confidentiality: undefined }),
    [near, ordinary]
  )
  assert.deepEqual(
    filterSelectableSwapDestinationTokens({ ...options, confidentiality: 'basic' }),
    [near]
  )
})

it('treats a legacy token without route sources as unknown in Private', () => {
  const token = toRheaSwapToken({
    chain: '8453',
    address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    assetId: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    symbol: 'USDC',
    decimals: 6,
    isNative: false,
    tokenListChainId: 8453,
    blockchain: 'base',
    contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    coinType: null,
    name: null,
    logoURI: null,
    price: null,
    priceUpdatedAt: null,
    sources: ['nearintents'],
    raw: {}
  })
  const { sources: _sources, ...legacy } = token
  const parsed = parseRheaSwapToken(legacy)
  assert.deepEqual(parsed.sources, [])
  assert.deepEqual(filterSwapDestinationTokens([parsed], 'basic'), [])
  assert.deepEqual(filterSwapDestinationTokens([parsed], undefined), [parsed])
})

it('gives a usable destination error without exposing backend route details', () => {
  const error = new RheaSwapClientError(
    'Cross-chain quote failed: nearintents: unsupported destination token 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359 on chain137'
  )
  assert.equal(
    getRheaSwapErrorMessage(error),
    'This destination is unavailable for this swap. Choose another asset.'
  )
})

it('uses a valid EVM quote address when the catalog omits contract metadata', () => {
  const assetId = 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near'
  const contractAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  const token = toRheaSwapToken({
    chain: '1',
    address: contractAddress,
    assetId,
    symbol: 'USDC',
    decimals: 6,
    isNative: false,
    tokenListChainId: 1,
    blockchain: 'eth',
    contractAddress: null,
    coinType: null,
    name: null,
    logoURI: null,
    price: null,
    priceUpdatedAt: null,
    sources: ['nearintents'],
    raw: { assetId }
  })
  assert.equal(token.rheaAddress, contractAddress)
  assert.equal(token.contractAddress, null)
})

it('excludes an EVM catalog row without an executable contract or quote address', () => {
  const assetId = 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near'
  assert.throws(
    () =>
      toRheaSwapToken({
        chain: '1',
        address: assetId,
        assetId,
        symbol: 'USDC',
        decimals: 6,
        isNative: false,
        tokenListChainId: 1,
        blockchain: 'eth',
        contractAddress: null,
        coinType: null,
        name: null,
        logoURI: null,
        price: null,
        priceUpdatedAt: null,
        sources: ['nearintents'],
        raw: { assetId }
      }),
    /quote token address is invalid/
  )
})
