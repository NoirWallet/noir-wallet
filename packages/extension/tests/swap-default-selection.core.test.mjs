import assert from 'node:assert/strict'
import { it } from 'node:test'
import { buildInitialSwapCatalogPlan } from '../src/popup/services/swap-catalog-loading.ts'
import {
  getSavedSwapDestinationAssetId,
  resolveSwapTokenSelection,
  shouldWaitForSwapDestination
} from '../src/popup/services/swap-token-selection.ts'

const zec = {
  assetId: 'nep141:zec.omft.near',
  blockchain: 'zec',
  symbol: 'ZEC',
  rheaChainId: 'zcash',
  tokenListChainId: 900010,
  rheaAddress: 'zec',
  icon: null
}
const wnear = { assetId: 'nep141:wrap.near', blockchain: 'near', symbol: 'wNEAR' }
const eth = { assetId: 'nep141:eth.omft.near', blockchain: 'eth', symbol: 'ETH' }

it('repairs a saved ZEC to ZEC default as the destination catalog arrives', () => {
  const savedSelection = { tokenInId: zec.assetId, tokenOutId: zec.assetId }
  const destinationAssetId = getSavedSwapDestinationAssetId(savedSelection)
  assert.equal(destinationAssetId, undefined)
  assert.deepEqual(
    buildInitialSwapCatalogPlan({
      sourceAssetId: savedSelection.tokenInId,
      destinationAssetId
    }),
    { sourceChainIds: [900010], destinationChainIds: [900001] }
  )

  const input = {
    tokens: [zec],
    sourceTokens: [zec],
    crossChainDestinationTokens: [],
    walletSourceTokens: [zec],
    savedSelection
  }
  assert.deepEqual(resolveSwapTokenSelection(input), { tokenIn: zec, tokenOut: null })
  assert.equal(
    shouldWaitForSwapDestination({
      loading: true,
      savedDestinationAssetId: savedSelection.tokenOutId,
      resolvedDestinationAssetId: null
    }),
    true
  )

  const resolved = resolveSwapTokenSelection({
    ...input,
    tokens: [zec, wnear],
    crossChainDestinationTokens: [wnear]
  })
  assert.deepEqual(resolved, { tokenIn: zec, tokenOut: wnear })
  assert.equal(
    shouldWaitForSwapDestination({
      loading: false,
      savedDestinationAssetId: savedSelection.tokenOutId,
      resolvedDestinationAssetId: resolved.tokenOut.assetId
    }),
    false
  )
})

it('does not persist an interim destination while the preferred catalog is loading', () => {
  const input = {
    tokens: [zec, eth],
    sourceTokens: [zec],
    crossChainDestinationTokens: [eth],
    walletSourceTokens: [zec]
  }
  const interim = resolveSwapTokenSelection(input)
  assert.deepEqual(interim, { tokenIn: zec, tokenOut: eth })
  assert.equal(
    shouldWaitForSwapDestination({
      loading: true,
      resolvedDestinationAssetId: interim.tokenOut.assetId
    }),
    true
  )
  assert.deepEqual(
    resolveSwapTokenSelection({
      ...input,
      tokens: [zec, eth, wnear],
      crossChainDestinationTokens: [eth, wnear]
    }),
    { tokenIn: zec, tokenOut: wnear }
  )
})

it('treats source and destination ZEC entries with different icons as the same asset', () => {
  const destinationZec = { ...zec, icon: 'https://example.com/zec.png' }
  assert.equal(zec.assetId, destinationZec.assetId)
  assert.equal(
    getSavedSwapDestinationAssetId({ tokenInId: zec.assetId, tokenOutId: destinationZec.assetId }),
    undefined
  )
  assert.deepEqual(
    resolveSwapTokenSelection({
      tokens: [zec, destinationZec],
      sourceTokens: [zec],
      crossChainDestinationTokens: [destinationZec],
      walletSourceTokens: [zec],
      savedSelection: { tokenInId: zec.assetId, tokenOutId: destinationZec.assetId }
    }),
    { tokenIn: zec, tokenOut: null }
  )
})

it('keeps distinct same-chain assets selectable', () => {
  const usdc = { assetId: 'nep141:eth-usdc.omft.near', blockchain: 'eth', symbol: 'USDC' }
  assert.equal(
    getSavedSwapDestinationAssetId({ tokenInId: eth.assetId, tokenOutId: usdc.assetId }),
    usdc.assetId
  )
  assert.deepEqual(
    resolveSwapTokenSelection({
      tokens: [eth, usdc],
      sourceTokens: [eth, usdc],
      crossChainDestinationTokens: [],
      walletSourceTokens: [eth, usdc],
      savedSelection: { tokenInId: eth.assetId, tokenOutId: usdc.assetId }
    }),
    { tokenIn: eth, tokenOut: usdc }
  )
})
