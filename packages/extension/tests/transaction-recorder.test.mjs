import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
  mergeTransactionUpdate,
  synchronizeInternalTransferConfirmations
} from '../src/lib/transaction-status.ts'
import { isDuplicateWasmRow, localTxHashSet } from '../src/lib/tx-history-dedup.ts'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function recorderWith(initial) {
  let records = initial
  const { outputText } = typescript.transpileModule(
    readFileSync(new URL('../src/background/transaction-recorder.ts', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022
      }
    }
  )
  const module = { exports: {} }
  const dependencies = {
    '@/lib/indexed-db': {
      mutateTransactions: async (_accountKey, update) => {
        records = update(records)
        return records
      }
    },
    '@/lib/transaction-status': {
      mergeTransactionUpdate,
      synchronizeInternalTransferConfirmations
    },
    '@/lib/tx-history-dedup': { isDuplicateWasmRow, localTxHashSet },
    '@/lib/logger': { logger: { log() {} } }
  }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  const recorder = new module.exports.TransactionRecorder()
  recorder.broadcastTransactionUpdated = () => {}
  return { recorder, records: () => records }
}

const failedShield = {
  id: 'local-shield',
  txHash: 'synthetic-hash',
  status: 'failed',
  type: 'shield',
  amount: '1',
  timestamp: 0,
  network: 'mainnet',
  failureReason: 'expired',
  notified: true
}
const confirmation = { txHash: failedShield.txHash, confirmations: 10 }

test('a confirmed failed record is persisted and notified once', async () => {
  const state = recorderWith([{ ...failedShield }])
  const result = await state.recorder.updateTerminalTransaction(
    'account-fixture',
    failedShield.id,
    { status: 'success', txHash: failedShield.txHash },
    confirmation
  )
  assert.deepEqual(result, { found: true, statusMatches: true, shouldNotify: true })
  assert.equal(state.records()[0].status, 'success')
  assert.equal(state.records()[0].failureReason, undefined)
  assert.equal(state.records()[0].confirmations, 10)
  assert.deepEqual(
    await state.recorder.markTerminalNotified('account-fixture', failedShield.id, 'success'),
    { found: true, newlyNotified: true }
  )
  assert.deepEqual(
    await state.recorder.updateTerminalTransaction(
      'account-fixture',
      failedShield.id,
      { status: 'success' },
      confirmation
    ),
    { found: true, statusMatches: true, shouldNotify: false }
  )
})

test('missing confirmation or a different bound hash leaves a terminal failure intact', async () => {
  for (const evidence of [undefined, { txHash: 'other-hash', confirmations: 10 }]) {
    const state = recorderWith([{ ...failedShield }])
    const result = await state.recorder.updateTerminalTransaction(
      'account-fixture',
      failedShield.id,
      { status: 'success' },
      evidence
    )
    assert.equal(result.statusMatches, false)
    assert.equal(result.shouldNotify, false)
    assert.equal(state.records()[0].status, 'failed')
  }
})

test('out-of-order failures cannot override a confirmed recovery', async () => {
  for (const successFirst of [false, true]) {
    const state = recorderWith([{ ...failedShield }])
    const recover = () =>
      state.recorder.updateTerminalTransaction(
        'account-fixture',
        failedShield.id,
        { status: 'success' },
        confirmation
      )
    const staleFailure = () =>
      state.recorder.updateTerminalTransaction('account-fixture', failedShield.id, {
        status: 'failed',
        failureReason: 'timeout'
      })
    await Promise.all(successFirst ? [recover(), staleFailure()] : [staleFailure(), recover()])
    assert.equal(state.records()[0].status, 'success')
    assert.equal(state.records()[0].failureReason, undefined)
  }
})
