import { expect, test } from '@playwright/test'
import {
  compareSwapTokenSearchRelevance,
  createSwapTokenPreferenceScope,
  matchesSwapTokenSearch,
  resolveSwapTokenSelection
} from '../src/popup/services/swap-token-selection.ts'

function token(assetId, blockchain, symbol, contractAddress) {
  return {
    assetId,
    blockchain,
    ...(contractAddress ? { contractAddress } : {}),
    decimals: symbol === 'BTC' || symbol === 'ZEC' ? 8 : 18,
    price: 1,
    priceUpdatedAt: '2026-08-22T00:00:00.000Z',
    symbol
  }
}

const ZEC = token('nep141:zec.omft.near', 'zec', 'ZEC')
const ETH = token('nep141:eth.omft.near', 'eth', 'ETH')
const ETH_USDC = token(
  'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
  'eth',
  'USDC',
  '0xA0b86991c6218B36c1d19D4a2e9Eb0cE3606eB48'
)
const BTC = token('nep141:btc.omft.near', 'btc', 'BTC')
const WNEAR = token('nep141:wrap.near', 'near', 'wNEAR')
const TOKENS = [ZEC, ETH, ETH_USDC, BTC, WNEAR]

test.describe('account-scoped Swap token selection', () => {
  test('does not select a cross-chain destination from the source catalog while its destination catalog is pending', () => {
    const input = {
      tokens: [ZEC, ETH],
      sourceTokens: [ZEC, ETH],
      crossChainDestinationTokens: [],
      walletSourceTokens: [ZEC, ETH],
      preferredSourceAssetId: ZEC.assetId
    }
    expect(resolveSwapTokenSelection(input)).toEqual({ tokenIn: ZEC, tokenOut: null })
    expect(
      resolveSwapTokenSelection({
        ...input,
        savedSelection: { tokenInId: ZEC.assetId, tokenOutId: ETH.assetId }
      })
    ).toEqual({ tokenIn: ZEC, tokenOut: null })
    expect(resolveSwapTokenSelection({ ...input, crossChainDestinationTokens: [ETH] })).toEqual({
      tokenIn: ZEC,
      tokenOut: ETH
    })
  })
  test('fuzzy-matches symbols but requires a complete contract address', () => {
    expect(matchesSwapTokenSearch(ETH_USDC, 'usd')).toBe(true)
    expect(matchesSwapTokenSearch(ETH_USDC, 'sDc')).toBe(true)
    expect(matchesSwapTokenSearch(ETH_USDC, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(
      true
    )
    expect(matchesSwapTokenSearch(ETH_USDC, '0xa0b86991')).toBe(false)
    expect(matchesSwapTokenSearch(ETH_USDC, 'ethereum')).toBe(false)
    expect(matchesSwapTokenSearch(ETH_USDC, '  USDC  ')).toBe(true)
    expect(matchesSwapTokenSearch(ZEC, '')).toBe(true)
  })

  test('ranks exact symbols and complete contracts before fuzzy symbol matches', () => {
    const fuzzy = token('fuzzy', 'eth', '$AAVETHENA')
    const exact = token('exact', 'eth', 'ETH')
    const contract = token(
      'contract',
      'eth',
      'Wrapped',
      '0x3333333333333333333333333333333333333333'
    )
    expect(compareSwapTokenSearchRelevance(exact, fuzzy, 'ETH')).toBeLessThan(0)
    expect(
      compareSwapTokenSearchRelevance(contract, fuzzy, '0x3333333333333333333333333333333333333333')
    ).toBeLessThan(0)
  })

  test('uses separate persistent scopes for every Wallet Account', () => {
    expect(createSwapTokenPreferenceScope('wallet-a', 'account-1')).toBe('wallet-a:account-1')
    expect(createSwapTokenPreferenceScope('wallet-a', 'account-2')).toBe('wallet-a:account-2')
    expect(createSwapTokenPreferenceScope(null, 'account-1')).toBeNull()
  })

  test('restores an available source for price discovery even when the Wallet does not own it', () => {
    expect(
      resolveSwapTokenSelection({
        tokens: TOKENS,
        walletSourceTokens: [ETH, ETH_USDC],
        savedSelection: { tokenInId: ZEC.assetId, tokenOutId: BTC.assetId },
        preferredSourceAssetId: ETH.assetId
      })
    ).toMatchObject({ tokenIn: ZEC, tokenOut: BTC })
  })

  test('defaults an EVM-only private-key Wallet to its active native asset and same-chain token', () => {
    expect(
      resolveSwapTokenSelection({
        tokens: TOKENS,
        walletSourceTokens: [ETH_USDC, ETH],
        preferredSourceAssetId: ETH.assetId
      })
    ).toMatchObject({ tokenIn: ETH, tokenOut: ETH_USDC })
  })

  test('uses an asset-detail deep link before the saved account selection', () => {
    expect(
      resolveSwapTokenSelection({
        tokens: TOKENS,
        walletSourceTokens: [ZEC, ETH, ETH_USDC],
        savedSelection: { tokenInId: ZEC.assetId, tokenOutId: BTC.assetId },
        requestedSourceAssetId: ETH_USDC.assetId,
        preferredSourceAssetId: ETH.assetId
      })
    ).toMatchObject({ tokenIn: ETH_USDC })
  })

  test('keeps an asset-detail deep link authoritative while wallet balances are loading', () => {
    expect(
      resolveSwapTokenSelection({
        tokens: TOKENS,
        walletSourceTokens: [ZEC],
        savedSelection: { tokenInId: ZEC.assetId, tokenOutId: BTC.assetId },
        requestedSourceAssetId: ETH_USDC.assetId
      })
    ).toMatchObject({ tokenIn: ETH_USDC })
  })

  test('keeps a Bitcoin-only private-key Wallet usable with an external destination', () => {
    expect(
      resolveSwapTokenSelection({
        tokens: TOKENS,
        walletSourceTokens: [BTC],
        preferredSourceAssetId: BTC.assetId
      })
    ).toMatchObject({ tokenIn: BTC, tokenOut: WNEAR })
  })
})
