import assert from 'node:assert/strict'
import { test } from 'node:test'

globalThis.__NETWORK_MODE__ = 'mainnet'
globalThis.__ENABLED_CHAIN_FEATURE_FLAGS__ = []

const { buildNetworkSettingsOptions } =
  await import('../src/popup/services/chain-settings-options.ts')
const { DEFAULT_CHAIN_ENDPOINT_SETTINGS, withCustomEvmNetwork } =
  await import('../src/core/chains/chain-endpoint-settings.ts')

const custom = {
  chainId: 'eip155:57073',
  numericChainId: 57073,
  displayName: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpc: { protocol: 'evm-json-rpc', label: 'Ink', url: 'https://rpc-gel.inkonchain.com' }
}

test('network settings remain available for Zcash when optional chains are disabled', () => {
  globalThis.__ENABLED_CHAIN_FEATURE_FLAGS__ = []
  const settings = withCustomEvmNetwork(DEFAULT_CHAIN_ENDPOINT_SETTINGS, custom)
  const options = buildNetworkSettingsOptions(settings)
  assert.equal(options.length, 1)
  assert.equal(options[0].label, 'Zcash')
  assert.equal(options[0].currencySymbol, 'ZEC')
  assert.equal(options[0].numericChainId, undefined)
  assert.equal(options[0].source, 'builtin')
})

test('network management includes each enabled chain once and keeps custom identity separate', () => {
  globalThis.__ENABLED_CHAIN_FEATURE_FLAGS__ = [
    'chain.evm',
    'chain.bitcoin',
    'chain.solana',
    'chain.near'
  ]
  const settings = withCustomEvmNetwork(DEFAULT_CHAIN_ENDPOINT_SETTINGS, custom)
  const options = buildNetworkSettingsOptions(settings)
  assert.equal(new Set(options.map(option => option.chainId)).size, options.length)
  assert.deepEqual(
    options
      .filter(option => !option.chainId.startsWith('eip155:'))
      .map(option => option.currencySymbol),
    ['ZEC', 'BTC', 'SOL', 'NEAR']
  )
  assert.deepEqual(
    options.find(option => option.chainId === custom.chainId),
    {
      chainId: custom.chainId,
      label: 'Ink',
      iconChain: 'eip155:57073',
      source: 'custom',
      numericChainId: 57073,
      currencySymbol: 'ETH'
    }
  )
  assert.equal(options.find(option => option.chainId === 'eip155:1').source, 'builtin')
})
