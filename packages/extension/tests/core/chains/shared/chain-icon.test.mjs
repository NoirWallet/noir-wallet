import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatChainIconUrl } from '../../../../src/lib/chain-icon.ts'
import { resolveEvmChainIconAlias } from '../../../../src/config/icons.ts'

test('known chain identities use R2 icons and old local paths resolve to the same URL', () => {
  assert.equal(resolveEvmChainIconAlias('eip155:1'), 'eth')
  assert.equal(formatChainIconUrl('eth'), 'https://assets.zknoir.com/chain/ethereum.svg')
  assert.equal(formatChainIconUrl('bsc'), 'https://assets.zknoir.com/chain/bsc.svg')
  assert.equal(
    formatChainIconUrl('/icons/chains/bsc.png'),
    'https://assets.zknoir.com/chain/bsc.svg'
  )
  assert.equal(
    formatChainIconUrl('/icons/chains/zcash.svg'),
    'https://assets.zknoir.com/chain/zcash.svg'
  )
})

test('unknown custom chain identities have no unverified icon URL', () => {
  assert.equal(resolveEvmChainIconAlias('eip155:4663'), 'eip155:4663')
  assert.equal(formatChainIconUrl('eip155:4663'), undefined)
  assert.equal(formatChainIconUrl('/icons/chains/network.svg'), undefined)
  assert.equal(formatChainIconUrl('evm'), undefined)
})
