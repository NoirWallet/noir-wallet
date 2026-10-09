import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

import { estimateSwapOutputFromPrices } from '../src/popup/components/swap/swap-estimate.ts'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readSource(relativePath) {
  return readFileSync(join(extensionRoot, relativePath), 'utf8')
}

test.describe('Swap provisional price estimate', () => {
  test('estimates the output from validated token catalog prices', () => {
    expect(
      estimateSwapOutputFromPrices({
        amountIn: '2.5',
        tokenInPrice: 40,
        tokenOutPrice: 1
      })
    ).toBe('100')

    expect(
      estimateSwapOutputFromPrices({
        amountIn: '1',
        tokenInPrice: 1,
        tokenOutPrice: 2_000
      })
    ).toBe('0.0005')
  })

  test('does not estimate without a positive amount and both usable prices', () => {
    for (const input of [
      { amountIn: '', tokenInPrice: 40, tokenOutPrice: 1 },
      { amountIn: '0', tokenInPrice: 40, tokenOutPrice: 1 },
      { amountIn: '-1', tokenInPrice: 40, tokenOutPrice: 1 },
      { amountIn: '1', tokenInPrice: 0, tokenOutPrice: 1 },
      { amountIn: '1', tokenInPrice: 40, tokenOutPrice: 0 },
      { amountIn: '1', tokenInPrice: Number.NaN, tokenOutPrice: 1 }
    ]) {
      expect(estimateSwapOutputFromPrices(input)).toBe('')
    }
  })

  test('marks only the provisional output as estimated while the live quote remains authoritative', () => {
    const stateSource = readSource('src/popup/hooks/useSwapState.ts')
    const inputViewSource = readSource('src/popup/components/swap/SwapInputView.tsx')
    const tokenSelectorSource = readSource('src/popup/components/tokens/TokenSelector.tsx')
    const pageSource = readSource('src/popup/pages/swap/Swap.tsx')

    expect(stateSource).toContain(
      "const displayOut = amountOut || (quoteError ? '' : provisionalAmountOut)"
    )
    expect(inputViewSource).toContain("isEstimatedAmount && 'text-muted'")
    expect(inputViewSource).toContain('Estimated output:')
    expect(inputViewSource).toContain(
      "aria-label={showQuoteFeeSkeleton ? 'Updating fee' : undefined}"
    )
    expect(inputViewSource).not.toContain("'Updating…'")
    expect(inputViewSource).not.toContain('This wallet')
    expect(inputViewSource).toContain(
      'className="text-xs font-medium text-primary transition-colors hover:text-primary/80"'
    )
    expect(stateSource).toContain('setCatalogError(true)')
    expect(stateSource).not.toContain(
      "setQuoteError(error instanceof Error ? error.message : 'RHEA Swap assets are unavailable')"
    )
    expect(inputViewSource).toContain('Swap is temporarily unavailable')
    expect(inputViewSource).toContain('onRetryTokenCatalog')
    expect(inputViewSource).toContain('aria-label="Loading swap assets"')
    expect(inputViewSource).toContain('if (sourceAssetsLoading) return <SwapInputSkeleton />')
    expect(inputViewSource).toContain('<SwapAssetCardSkeleton direction={direction} />')
    expect(inputViewSource).not.toContain("tokenSelectDisabled ? 'lucide:loader-circle'")
    expect(tokenSelectorSource).toContain('const MAX_RENDERED_TOKENS = 100')
    expect(tokenSelectorSource).toContain(
      'const visibleTokens = filteredTokens.slice(0, MAX_RENDERED_TOKENS)'
    )
    expect(pageSource).toContain('catalogError={swap.catalogError}')
    expect(pageSource).toContain('isEstimatedOut={swap.isEstimatedOut}')
    expect(pageSource.match(/zcashWalletRuntimeClient\.estimateTransferFee\(/g)).toHaveLength(2)
  })
})
