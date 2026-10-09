import { test, expect } from '@playwright/test'
import {
  getCrossChainSendAssetGroup,
  isCrossChainSendDestination,
  isCrossChainSendRecipientValid
} from '../src/popup/services/cross-chain-send-assets.ts'

const eth = {
  assetId: 'nep141:eth.omft.near',
  blockchain: 'eth',
  contractAddress: null,
  decimals: 18,
  icon: null,
  price: 0,
  priceUpdatedAt: '',
  symbol: 'ETH',
  rheaChainId: '1',
  tokenListChainId: 1,
  rheaAddress: '0x0000000000000000000000000000000000000000',
  isNative: true
}
const enabledChains = { evm: true, solana: true }

test('cross-chain Send uses verified asset identities and excludes the source network', () => {
  const baseEth = { ...eth, rheaChainId: '8453', tokenListChainId: 8453, blockchain: 'base' }
  expect(isCrossChainSendDestination(eth, baseEth, enabledChains)).toBe(true)
  expect(isCrossChainSendDestination(eth, eth, enabledChains)).toBe(false)
  expect(isCrossChainSendDestination(eth, { ...baseEth, isNative: false }, enabledChains)).toBe(
    false
  )
  expect(
    getCrossChainSendAssetGroup({
      chainId: 'eip155:8453',
      namespace: 'slip44',
      reference: '60'
    })
  ).toBe('ETH')
  expect(
    getCrossChainSendAssetGroup({
      chainId: 'eip155:8453',
      namespace: 'erc20',
      reference: '0x0000000000000000000000000000000000000001'
    })
  ).toBe(null)
})

test('cross-chain Send accepts canonical USDC and rejects same-symbol tokens', () => {
  const usdc = {
    ...eth,
    assetId: 'nep141:base-usdc.omft.near',
    rheaChainId: '8453',
    tokenListChainId: 8453,
    blockchain: 'base',
    symbol: 'USDC',
    isNative: false,
    rheaAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  }
  const solanaUsdc = {
    ...usdc,
    rheaChainId: 'solana',
    tokenListChainId: 501,
    blockchain: 'sol',
    rheaAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  }
  expect(isCrossChainSendDestination(usdc, solanaUsdc, enabledChains)).toBe(true)
  expect(isCrossChainSendDestination(usdc, solanaUsdc, { evm: true, solana: false })).toBe(false)
  expect(
    isCrossChainSendDestination(usdc, { ...solanaUsdc, rheaAddress: 'fake' }, enabledChains)
  ).toBe(false)
  expect(
    getCrossChainSendAssetGroup({
      chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      namespace: 'token',
      reference: solanaUsdc.rheaAddress
    })
  ).toBe('USDC')
  expect(isCrossChainSendRecipientValid(solanaUsdc, solanaUsdc.rheaAddress)).toBe(true)
  expect(isCrossChainSendRecipientValid(solanaUsdc, 'invalid')).toBe(false)
  expect(isCrossChainSendRecipientValid(usdc, `0x${'12'.repeat(20)}`)).toBe(true)
  expect(isCrossChainSendRecipientValid(usdc, '0x1234')).toBe(false)
})
