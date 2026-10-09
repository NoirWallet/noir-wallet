import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import {
  INTENTS_PROGRESS_STALE_MS,
  SWAP_INTENTS_AUTO_REFRESH_MS,
  SWAP_PENDING_AUTO_HIDE_MS,
  getIntentsExplorerUrl,
  getZcashDestinationCatchUpThreshold,
  needsZcashDestinationCatchUp,
  isIntentsProgressAutoHidden,
  isIntentsProgressStale,
  isTerminalIntentsStatus,
  needsZcashDestinationConfirmations,
  normalizeIntentsProgressEntry,
  registerIntentsProgress,
  shouldAutoRefreshIntentsProgress,
  shouldRefreshIntentsProgressOnOpen,
  updateIntentsProgressStatus
} from '../src/lib/intents-progress.ts'
import { createIntentsDeadline, getIntentsQuoteValidityMs } from '../src/lib/intents-timeouts.ts'

const INPUT = {
  kind: 'swap',
  direction: 'from_zcash',
  depositAddress: 't1deposit',
  tokenInSymbol: 'ZEC',
  tokenOutSymbol: 'NEAR',
  tokenInIcon: 'https://icons.example/zec.svg',
  tokenOutIcon: 'https://icons.example/near.svg',
  amountIn: '1',
  amountOut: '2',
  usdAmount: '194.34',
  actionName: 'Swap',
  accountKey: 'mainnet_wallet_account',
  originChain: 'zec',
  destinationChain: 'near'
}

describe('Intents quote validity', () => {
  test('uses ten minutes normally and thirty minutes for Zcash or Bitcoin routes', () => {
    assert.strictEqual(getIntentsQuoteValidityMs('near', 'eth'), 10 * 60 * 1000)
    assert.strictEqual(getIntentsQuoteValidityMs('zec', 'near'), 30 * 60 * 1000)
    assert.strictEqual(getIntentsQuoteValidityMs('eth', 'btc'), 30 * 60 * 1000)
    assert.strictEqual(getIntentsQuoteValidityMs('ZCASH', 'near'), 30 * 60 * 1000)

    const now = Date.parse('2026-09-04T00:00:00.000Z')
    assert.strictEqual(createIntentsDeadline('near', 'eth', now), '2026-09-04T00:10:00.000Z')
    assert.strictEqual(createIntentsDeadline('zec', 'near', now), '2026-09-04T00:30:00.000Z')
  })
})

describe('Intents progress lifecycle', () => {
  test('keeps the first-seen time and links a later local transaction', () => {
    const original = registerIntentsProgress(INPUT, undefined, 1_000)
    const linked = registerIntentsProgress(
      { ...INPUT, transactionId: 'tx-1', usdAmount: undefined },
      original,
      2_000
    )

    assert.strictEqual(linked.createdAt, 1_000)
    assert.strictEqual(linked.lastCheckedAt, 1_000)
    assert.strictEqual(linked.lastStatusChangeAt, 1_000)
    assert.strictEqual(linked.transactionId, 'tx-1')
    assert.strictEqual(linked.usdAmount, '194.34')
  })

  test('only resets the three-hour auto refresh window when remote status changes', () => {
    const pending = registerIntentsProgress(INPUT, undefined, 1_000)
    const unchanged = updateIntentsProgressStatus(pending, 'PENDING_DEPOSIT', 2_000)
    const processing = updateIntentsProgressStatus(unchanged, 'PROCESSING', 3_000)

    assert.strictEqual(unchanged.lastCheckedAt, 2_000)
    assert.strictEqual(unchanged.lastStatusChangeAt, 1_000)
    assert.strictEqual(processing.lastStatusChangeAt, 3_000)
    assert.strictEqual(
      isIntentsProgressStale(processing, 3_000 + SWAP_INTENTS_AUTO_REFRESH_MS - 1),
      false
    )
    assert.strictEqual(
      isIntentsProgressStale(processing, 3_000 + SWAP_INTENTS_AUTO_REFRESH_MS),
      true
    )
    assert.strictEqual(
      shouldAutoRefreshIntentsProgress(unchanged, 1_000 + SWAP_INTENTS_AUTO_REFRESH_MS),
      false
    )
    assert.strictEqual(shouldRefreshIntentsProgressOnOpen(unchanged), true)

    const completed = {
      ...updateIntentsProgressStatus(processing, 'SUCCESS', 4_000),
      completionHandledAt: 4_001
    }
    assert.strictEqual(shouldRefreshIntentsProgressOnOpen(completed), false)
  })

  test('validates persisted entries and migrates the previous monitor shape', () => {
    const { kind: _kind, direction: _direction, ...legacyInput } = INPUT
    const migrated = normalizeIntentsProgressEntry(legacyInput, 4_000)
    for (const [key, value] of Object.entries(legacyInput)) {
      assert.deepStrictEqual(migrated[key], value)
    }
    assert.strictEqual(migrated.kind, 'swap')
    assert.strictEqual(migrated.direction, 'from_zcash')
    assert.strictEqual(migrated.status, 'PENDING_DEPOSIT')
    assert.strictEqual(migrated.createdAt, 4_000)
    assert.strictEqual(migrated.lastCheckedAt, 4_000)
    assert.strictEqual(migrated.lastStatusChangeAt, 4_000)
    assert.strictEqual(normalizeIntentsProgressEntry({ depositAddress: 'missing-fields' }), null)
  })

  test('stores inbound swaps without a local Activity transaction', () => {
    const inbound = registerIntentsProgress(
      {
        ...INPUT,
        direction: 'to_zcash',
        tokenInSymbol: 'ETH',
        tokenOutSymbol: 'ZEC',
        originChain: 'eth',
        destinationChain: 'zec'
      },
      undefined,
      5_000
    )

    assert.strictEqual(inbound.transactionId, undefined)
    assert.strictEqual(inbound.kind, 'swap')
    assert.strictEqual(inbound.direction, 'to_zcash')
    assert.strictEqual(inbound.status, 'PENDING_DEPOSIT')
  })

  test('auto-hides only swaps that remain pending for 24 hours', () => {
    const pending = registerIntentsProgress(INPUT, undefined, 1_000)
    const progressed = updateIntentsProgressStatus(pending, 'PROCESSING', 2_000)
    const pendingAgain = updateIntentsProgressStatus(progressed, 'PENDING_DEPOSIT', 3_000)

    assert.strictEqual(
      isIntentsProgressAutoHidden(pending, 1_000 + SWAP_PENDING_AUTO_HIDE_MS - 1),
      false
    )
    assert.strictEqual(
      isIntentsProgressAutoHidden(pending, 1_000 + SWAP_PENDING_AUTO_HIDE_MS),
      true
    )
    assert.strictEqual(
      isIntentsProgressAutoHidden(pendingAgain, 1_000 + SWAP_PENDING_AUTO_HIDE_MS),
      false
    )
  })

  test('does not auto-refresh a terminal record after completion was handled', () => {
    const success = updateIntentsProgressStatus(
      registerIntentsProgress(INPUT, undefined, 1_000),
      'SUCCESS',
      2_000
    )
    assert.strictEqual(isTerminalIntentsStatus(success.status), true)
    assert.strictEqual(shouldAutoRefreshIntentsProgress(success, 2_001), true)
    assert.strictEqual(
      shouldAutoRefreshIntentsProgress({ ...success, completionHandledAt: 2_000 }, 2_001),
      false
    )
  })

  test('keeps polling an inbound Zcash destination until it reaches finality', () => {
    const success = {
      ...updateIntentsProgressStatus(
        registerIntentsProgress(
          {
            ...INPUT,
            direction: 'to_zcash',
            tokenOutSymbol: 'ZEC',
            destinationChain: 'zec'
          },
          undefined,
          1_000
        ),
        'SUCCESS',
        2_000
      ),
      completionHandledAt: 2_001,
      destinationChainTxHashes: [{ hash: 'zcash-hash' }],
      destinationConfirmations: 1,
      destinationRequiredConfirmations: 10
    }

    assert.strictEqual(needsZcashDestinationConfirmations(success), true)
    assert.strictEqual(shouldAutoRefreshIntentsProgress(success, 2_002), true)
    assert.strictEqual(shouldRefreshIntentsProgressOnOpen(success), true)

    const finalized = {
      ...success,
      destinationConfirmations: 10,
      destinationCatchUpConfirmations: 10
    }
    assert.strictEqual(needsZcashDestinationConfirmations(finalized), false)
    assert.strictEqual(shouldAutoRefreshIntentsProgress(finalized, 2_002), false)
    assert.strictEqual(shouldRefreshIntentsProgressOnOpen(finalized), false)
  })

  test('only schedules missed mined, selection and finality catch-up thresholds', () => {
    assert.deepStrictEqual(
      [0, 1, 2, 3, 9, 10].map(value => getZcashDestinationCatchUpThreshold(value)),
      [0, 1, 1, 3, 3, 10]
    )
    const entry = {
      ...registerIntentsProgress({ ...INPUT, direction: 'to_zcash' }, undefined, 1_000),
      status: 'SUCCESS',
      completionHandledAt: 2_000,
      destinationChainTxHashes: [{ hash: 'a'.repeat(64) }],
      destinationConfirmations: 2,
      destinationCatchUpConfirmations: 1
    }
    assert.strictEqual(needsZcashDestinationCatchUp(entry), false)
    assert.strictEqual(
      needsZcashDestinationCatchUp({ ...entry, destinationConfirmations: 3 }),
      true
    )
    assert.strictEqual(
      needsZcashDestinationCatchUp({ ...entry, destinationConfirmations: 10 }),
      true
    )
    assert.strictEqual(
      shouldAutoRefreshIntentsProgress(
        { ...entry, destinationConfirmations: 10 },
        1_000 + INTENTS_PROGRESS_STALE_MS + 1
      ),
      true
    )
    assert.strictEqual(needsZcashDestinationCatchUp({ ...entry, direction: 'from_zcash' }), false)
  })

  test('refreshes stale and hidden swaps once when the progress page opens', () => {
    const pending = registerIntentsProgress(INPUT, undefined, 1_000)
    const staleAndHiddenAt = 1_000 + SWAP_PENDING_AUTO_HIDE_MS
    const completed = {
      ...updateIntentsProgressStatus(pending, 'SUCCESS', 2_000),
      completionHandledAt: 2_001
    }

    assert.strictEqual(shouldAutoRefreshIntentsProgress(pending, staleAndHiddenAt), false)
    assert.strictEqual(isIntentsProgressAutoHidden(pending, staleAndHiddenAt), true)
    assert.strictEqual(shouldRefreshIntentsProgressOnOpen(pending), true)
    assert.strictEqual(shouldRefreshIntentsProgressOnOpen(completed), false)
  })

  test('does not downgrade a terminal status when a stale response arrives', () => {
    const success = updateIntentsProgressStatus(
      registerIntentsProgress(INPUT, undefined, 1_000),
      'SUCCESS',
      2_000
    )
    const stale = updateIntentsProgressStatus(success, 'PROCESSING', 3_000)

    assert.strictEqual(stale.status, 'SUCCESS')
    assert.strictEqual(stale.lastCheckedAt, 3_000)
    assert.strictEqual(stale.lastStatusChangeAt, 2_000)
  })

  test('builds the NEAR Intents transaction details URL from the deposit address', () => {
    assert.strictEqual(
      getIntentsExplorerUrl('0xabc/123'),
      'https://explorer.near-intents.org/transactions/0xabc%2F123?referral=noir_swap'
    )
  })
})
