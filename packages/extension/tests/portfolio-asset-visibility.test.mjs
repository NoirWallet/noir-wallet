import { expect, test } from '@playwright/test'

import { isAssetVisibleInAssetView } from '../src/popup/components/portfolio/portfolio-asset-visibility.ts'

function chain(id, family, displayName) {
  return { id, family, displayName }
}

function asset({ kind = 'native', symbol, totalRaw = '0' }) {
  return {
    asset: { kind },
    metadata: { symbol },
    balance: { totalRaw }
  }
}

test.describe('Portfolio asset-mode visibility', () => {
  test('shows every held asset and hides other zero-balance assets', () => {
    expect(
      isAssetVisibleInAssetView(
        chain('near:mainnet', 'near', 'NEAR'),
        asset({ symbol: 'NEAR', totalRaw: '1' })
      )
    ).toBe(true)
    expect(
      isAssetVisibleInAssetView(chain('near:mainnet', 'near', 'NEAR'), asset({ symbol: 'NEAR' }))
    ).toBe(false)
    expect(
      isAssetVisibleInAssetView(
        chain('eip155:1', 'evm', 'Ethereum'),
        asset({ kind: 'token', symbol: 'USDC' })
      )
    ).toBe(false)
  })

  test('keeps only zero-balance native BTC and Ethereum ETH as empty-state actions', () => {
    expect(
      isAssetVisibleInAssetView(
        chain('bip122:mainnet', 'bitcoin', 'Bitcoin'),
        asset({ symbol: 'BTC' })
      )
    ).toBe(true)
    expect(
      isAssetVisibleInAssetView(chain('eip155:1', 'evm', 'Ethereum'), asset({ symbol: 'ETH' }))
    ).toBe(true)
    expect(
      isAssetVisibleInAssetView(chain('eip155:42161', 'evm', 'Arbitrum'), asset({ symbol: 'ETH' }))
    ).toBe(false)
    expect(
      isAssetVisibleInAssetView(
        chain('solana:mainnet', 'solana', 'Solana'),
        asset({ symbol: 'SOL' })
      )
    ).toBe(false)
  })
})
