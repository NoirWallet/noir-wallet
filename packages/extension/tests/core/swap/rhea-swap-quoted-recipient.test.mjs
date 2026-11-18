import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
  parseRheaSwapQuoteRequest,
  toSdkQuoteRequest
} from '../../../src/core/services/rhea-swap/rhea-swap-model.ts'
import {
  MemoryRheaSwapQuoteSessionStore,
  RheaSwapService
} from '../../../src/core/services/rhea-swap/rhea-swap-service.ts'
import { parseRheaSwapQuoteView } from '../../../src/core/services/rhea-swap/rhea-swap-runtime.ts'
import { createRheaSwapBinding } from '../../../src/popup/services/quote-deposit-transfer-client.ts'

it('returns the requested recipient with the quote and binds transfer activity to it', async () => {
  const request = parseRheaSwapQuoteRequest({
    fromChain: '1',
    toChain: 'near',
    tokenIn: { chain: '1', address: 'native' },
    tokenOut: { chain: 'near', address: 'wrap.near' },
    amountIn: '1000',
    slippageBps: 50,
    sender: '0x1111111111111111111111111111111111111111',
    recipient: 'alice.near'
  })
  const sdkRequest = toSdkQuoteRequest(request, 'wallet-swap')
  assert.equal(sdkRequest.quoteWaitingTimeMs, 6_000)
  assert.equal(sdkRequest.sameChainTimeoutMs, 1_500)
  assert.equal(sdkRequest.crossChainTimeoutMs, 6_000)
  const fastRequest = toSdkQuoteRequest(
    parseRheaSwapQuoteRequest({ ...request, quoteMode: 'fast' }),
    'wallet-swap'
  )
  assert.equal(fastRequest.quoteWaitingTimeMs, 1_500)
  assert.equal(fastRequest.sameChainTimeoutMs, 500)
  assert.equal(fastRequest.crossChainTimeoutMs, 1_500)
  assert.equal('quoteMode' in fastRequest, false)
  assert.throws(() => parseRheaSwapQuoteRequest({ ...request, quoteMode: 'turbo' }), /quote mode/)
  const sameChainSendRequest = toSdkQuoteRequest(
    {
      ...request,
      toChain: request.fromChain,
      tokenOut: request.tokenIn,
      recipient: request.sender
    },
    'public-private-send'
  )
  assert.equal(sameChainSendRequest.quoteWaitingTimeMs, 6_000)
  assert.equal(sameChainSendRequest.sameChainTimeoutMs, 1_500)
  const service = new RheaSwapService(
    {
      async quote(quoteRequest) {
        assert.equal(quoteRequest.quoteWaitingTimeMs, 4_000)
        assert.equal(quoteRequest.crossChainTimeoutMs, 4_000)
        assert.equal(quoteRequest.sameChainTimeoutMs, 1_500)
        return {
          fromChain: request.fromChain,
          toChain: request.toChain,
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          amountIn: request.amountIn,
          estimatedOut: '900',
          minAmountOut: '850',
          route: { router: 'nearintents' },
          alternatives: [],
          receivedAt: 1_000,
          expiresAt: 5_000,
          buildContext: { request: quoteRequest },
          raw: {}
        }
      }
    },
    new MemoryRheaSwapQuoteSessionStore(),
    { now: () => 2_000 }
  )
  const quote = parseRheaSwapQuoteView(
    await service.quote(request, undefined, {
      walletId: 'wallet-1',
      accountId: 'account-1',
      purpose: 'public-cross-chain-send'
    })
  )
  assert.equal(quote.recipient, 'alice.near')
  assert.throws(() => parseRheaSwapQuoteView({ ...quote, recipient: undefined }), /recipient/)

  const source = {
    family: 'evm',
    refundAddress: request.sender,
    chain: { chain: { id: 'eip155:1' } },
    asset: { asset: { id: 'eip155:1/slip44:60' } }
  }
  const binding = createRheaSwapBinding({
    source,
    destinationAssetId: 'near:mainnet/slip44:397',
    destinationChainId: 'near:mainnet',
    tokenIn: { rheaChainId: '1', assetId: 'nep141:eth.omft.near' },
    tokenOut: { rheaChainId: 'near', assetId: 'nep141:wrap.near', symbol: 'wNEAR', decimals: 24 },
    quote,
    review: {
      ...quote,
      executionId: 'execution-1',
      router: 'nearintents',
      amountIn: '1000',
      isCrossChain: true,
      execution: { kind: 'evm-signature', target: '0x2222222222222222222222222222222222222222' }
    }
  })
  assert.equal(binding.destination.recipient, 'alice.near')
})
