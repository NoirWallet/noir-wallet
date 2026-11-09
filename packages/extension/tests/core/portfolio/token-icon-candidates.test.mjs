import { test } from 'node:test'
import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { getTokenIconCandidates } from '../../../src/popup/components/tokens/token-icon-candidates.ts'
import {
  clearTokenIconUrlFailure,
  hasTokenIconUrlFailed,
  recordTokenIconUrlFailure
} from '../../../src/popup/components/tokens/token-icon-failure-cache.ts'

test('leaves native assets without metadata images to the local placeholder', () => {
  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'btc',
        contractAddress: null,
        icon: null
      }
    })
  ).toEqual([])

  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'avax',
        contractAddress: null,
        icon: null
      }
    })
  ).toEqual([])

  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'btc',
        icon: null
      }
    })
  ).toEqual([])
})

test('keeps provider and supplied CoinGecko metadata in order', () => {
  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'btc',
        contractAddress: null,
        icon: 'https://tokens.example/btc.png'
      }
    })
  ).toEqual(['https://tokens.example/btc.png'])

  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'eth',
        contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        icon: null,
        coingeckoIcon:
          'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694'
      }
    })
  ).toEqual(['https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694'])
})

test('does not derive contract image URLs and accepts supplied CoinGecko metadata', () => {
  const retiredUrl = 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png'
  for (const icon of [
    retiredUrl,
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
    `https://history.example/token-icon?source=${encodeURIComponent(retiredUrl)}`
  ]) {
    expect(getTokenIconCandidates({ icon, token: { icon, blockchain: 'eth' } })).toEqual([])
  }
  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'sol',
        contractAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        icon: null
      }
    })
  ).toEqual([])

  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'fogo',
        contractAddress: 'token-address',
        icon: null,
        coingeckoIcon:
          'https://coin-images.coingecko.com/coins/images/54725/large/fogo.png?1749218789'
      }
    })
  ).toEqual(['https://coin-images.coingecko.com/coins/images/54725/large/fogo.png?1749218789'])
})

test('does not infer image URLs from canonical wallet asset IDs', () => {
  expect(
    getTokenIconCandidates({
      assetId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/slip44:501',
      blockchain: 'solana'
    })
  ).toEqual([])

  expect(
    getTokenIconCandidates({
      assetId: 'near:mainnet/slip44:397',
      blockchain: 'near'
    })
  ).toEqual([])

  expect(
    getTokenIconCandidates({
      assetId:
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      blockchain: 'sol'
    })
  ).toEqual([])

  expect(
    getTokenIconCandidates({
      assetId: 'near:mainnet/nep141:token%5Fcontract.near',
      blockchain: 'near'
    })
  ).toEqual([])
})

test('uses a cached CoinGecko metadata icon without deriving another image URL', () => {
  expect(
    getTokenIconCandidates({
      assetId:
        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      blockchain: 'sol',
      icon: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png'
    })
  ).toEqual(['https://coin-images.coingecko.com/coins/images/6319/large/usdc.png'])
})

test('does not load token icons directly from public IPFS gateways', () => {
  expect(
    getTokenIconCandidates({
      token: {
        blockchain: 'sol',
        contractAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        icon: 'https://ipfs.io/ipfs/bafy-token/icon.png',
        coingeckoIcon: 'https://coin-images.coingecko.com/coins/images/1/large/token.png'
      }
    })
  ).toEqual(['https://coin-images.coingecko.com/coins/images/1/large/token.png'])
})

test('shares failed icon URLs across component instances and retries them after expiry', () => {
  const url = 'https://tokens.example/missing.png'
  clearTokenIconUrlFailure(url)
  recordTokenIconUrlFailure(url, 1_000)
  expect(hasTokenIconUrlFailed(url, 1_001)).toBe(true)
  expect(hasTokenIconUrlFailed(url, 5 * 60 * 1000 + 1_001)).toBe(false)
})

test('uses one neutral fallback background when no token icon can load', () => {
  const source = readFileSync(
    new URL('../../../src/popup/components/tokens/TokenIcon.tsx', import.meta.url),
    'utf8'
  )
  expect(source).toContain('bg-[#34343f] text-white/80')
  expect(source).not.toContain('fallbackColor')
  expect(source).not.toContain('backgroundColor:')
})

test('keeps token icon provider details out of the selector UI', () => {
  const source = readFileSync(
    new URL('../../../src/popup/components/tokens/TokenSelector.tsx', import.meta.url),
    'utf8'
  )
  expect(source).not.toContain('Powered by CoinGecko')
})
