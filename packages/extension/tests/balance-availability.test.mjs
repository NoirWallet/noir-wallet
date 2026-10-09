import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { mapWasmAccountBalanceToZcashBalance } from '../src/core/wallet/balance-summary.ts'
import { getFundingBalance, usesPendingFunds } from '../src/lib/funding-balance.ts'
import {
  migrateAccountDataState,
  migrateStoredBalance,
  rehydrateAccountDataState
} from '../src/lib/account-balance-migration.ts'
import { scheduleSpendabilityCatchUp } from '../src/lib/spendability-catch-up.ts'

const ZAT = 100_000_000n

describe('available balance contract', () => {
  test('uses the selection-policy shielding amount without changing Available or confirmed funds', () => {
    const balance = mapWasmAccountBalanceToZcashBalance({
      unshielded_balance: 0n,
      unshielded_total_balance: 2n * ZAT,
      unshielded_pending_balance: 2n * ZAT,
      unshielded_shieldable_balance: 2n * ZAT,
      spendable_balance: 0n
    })
    assert.strictEqual(balance.shieldable, '2')
    assert.strictEqual(balance.available, '0')
    assert.strictEqual(balance.confirmed.transparent, '0')
    assert.strictEqual(balance.pending.transparent, '2')
    assert.strictEqual(migrateStoredBalance(balance).shieldable, '2')
  })
  test('keeps Available selectable while retaining total and pending amounts', () => {
    const balance = mapWasmAccountBalanceToZcashBalance({
      orchard_balance: 6n * ZAT,
      orchard_total_balance: 9n * ZAT,
      orchard_pending_balance: 3n * ZAT,
      unshielded_balance: 2n * ZAT,
      unshielded_total_balance: 3n * ZAT,
      unshielded_pending_balance: 1n * ZAT,
      spendable_balance: 8n * ZAT,
      pending_balance: 4n * ZAT,
      total_balance: 12n * ZAT
    })

    assert.deepStrictEqual(
      {
        shielded: balance.shielded,
        transparent: balance.transparent,
        total: balance.total,
        available: balance.available,
        spendable: balance.spendable,
        confirmed: balance.confirmed,
        pending: balance.pending
      },
      {
        shielded: '9',
        transparent: '3',
        total: '12',
        available: '8',
        spendable: '8',
        confirmed: { shielded: '6', transparent: '2' },
        pending: { shielded: '3', transparent: '1', total: '4' }
      }
    )
  })

  test('keeps funding sources isolated and only warns inside the pending range', () => {
    const balance = migrateStoredBalance({
      shielded: '9',
      transparent: '3',
      total: '12',
      spendable: '8',
      confirmed: { shielded: '6', transparent: '2' },
      pending: { shielded: '3', transparent: '1', total: '4' }
    })
    const shielded = getFundingBalance(balance, 'shielded')
    const transparent = getFundingBalance(balance, 'transparent')

    assert.deepStrictEqual(shielded, { total: '9', available: '6', spendable: '6', pending: '3' })
    assert.deepStrictEqual(transparent, {
      total: '3',
      available: '2',
      spendable: '2',
      pending: '1'
    })
    assert.strictEqual(usesPendingFunds('6', shielded), false)
    assert.strictEqual(usesPendingFunds('7', shielded), true)
    assert.strictEqual(usesPendingFunds('10', shielded), false)
  })

  test('migrates cached display balances without guessing unknown spendability', () => {
    const known = migrateStoredBalance({
      shielded: '5',
      transparent: '2',
      total: '7',
      available: '4.99',
      pending: { shielded: '1', transparent: '0.5', total: '1.5' }
    })
    assert.strictEqual(known.available, '5.5')
    assert.deepStrictEqual(known.confirmed, { shielded: '4', transparent: '1.5' })

    const partial = migrateStoredBalance({
      shielded: '5',
      transparent: '2',
      total: '7',
      confirmed: { shielded: '4' },
      pending: { shielded: '1', transparent: '0.5', total: '1.5' }
    })
    assert.deepStrictEqual(partial.confirmed, { shielded: '4', transparent: '1.5' })

    const unknown = migrateStoredBalance({ shielded: '5', transparent: '2', total: '7' })
    assert.strictEqual(unknown.available, '0')
    assert.deepStrictEqual(unknown.confirmed, { shielded: '0', transparent: '0' })
    assert.deepStrictEqual(unknown.pending, { shielded: '5', transparent: '2', total: '7' })

    const state = migrateAccountDataState({
      balances: { account: unknown },
      syncStates: { wallet: { isSyncing: true, lastSyncTime: 123 } }
    })
    assert.strictEqual(state.syncStates.wallet.isSyncing, false)
    assert.strictEqual(state.syncStates.wallet.lastSyncTime, null)
  })

  test('rehydrates migrated account data as runtime Maps before store access', () => {
    const migrated = migrateAccountDataState({
      balances: {
        account: {
          shielded: '5',
          transparent: '2',
          total: '7',
          pending: { shielded: '1', transparent: '0.5', total: '1.5' }
        }
      },
      syncStates: {
        wallet: { isSyncing: true, currentHeight: 123, lastSyncTime: 456 }
      }
    })
    const runtime = rehydrateAccountDataState(migrated, {
      balances: new Map(),
      syncStates: new Map(),
      transactionsCache: new Map([['stale', []]]),
      transactionsLoaded: new Set(['stale'])
    })

    assert.ok(runtime.balances instanceof Map)
    assert.ok(runtime.syncStates instanceof Map)
    assert.strictEqual(runtime.balances.get('account').available, '5.5')
    assert.deepStrictEqual(runtime.balances.get('account').confirmed, {
      shielded: '4',
      transparent: '1.5'
    })
    assert.strictEqual(runtime.syncStates.get('wallet').isSyncing, false)
    assert.strictEqual(runtime.syncStates.get('wallet').currentHeight, 123)
    assert.strictEqual(runtime.syncStates.get('wallet').lastSyncTime, null)
    assert.strictEqual(runtime.transactionsCache.size, 0)
    assert.strictEqual(runtime.transactionsLoaded.size, 0)

    assert.doesNotThrow(() => Object.fromEntries(runtime.balances))
    assert.doesNotThrow(() => Object.fromEntries(runtime.syncStates))
  })
})

describe('spendability catch-up', () => {
  test('marks the transaction only after durable scheduling succeeds', async () => {
    const calls = []
    await scheduleSpendabilityCatchUp(
      async () => calls.push('durable'),
      async () => calls.push('marked'),
      async () => calls.push('foreground')
    )
    assert.deepStrictEqual(calls, ['durable', 'marked', 'foreground'])

    let marked = false
    let foregroundRun = false
    await assert.rejects(
      scheduleSpendabilityCatchUp(
        async () => {
          throw new Error('storage failed')
        },
        async () => {
          marked = true
        },
        async () => {
          foregroundRun = true
        }
      ),
      { message: 'storage failed' }
    )
    assert.strictEqual(marked, false)
    assert.strictEqual(foregroundRun, false)
  })
})
