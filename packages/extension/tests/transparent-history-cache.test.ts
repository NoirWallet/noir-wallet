import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { partitionVerboseTransactions } from '../src/core/wallet/transparent-history-cache'
import {
  fetchTransparentReceiveTransactions,
  mapVerboseTransactionToReceive,
  mergeTransactionsWithWasmHistory,
  mergeTransactionsWithTransparentReceives,
  associateIncomingIntentsTransactions
} from '../src/core/wallet/transparent-history'
import type { VerboseTransaction } from '../src/lib/zcash-node-rpc'
import type { AccountData, Transaction } from '../src/types/wallet'

const txid = (character: string) => character.repeat(64)
const account = {
  addresses: { transparent: 'tmWallet' }
} as AccountData
const walletTransaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx_local',
  txHash: txid('f'),
  status: 'pending',
  type: 'send',
  amount: '0.01',
  to: 'tmWallet',
  from: 'u1Wallet',
  fromType: 'shielded',
  fee: '0.00015',
  timestamp: 1,
  network: 'mainnet',
  ...overrides
})

describe('Transparent history transaction cache', () => {
  test('associates scanned receives by account and exact hash, retaining the link on refresh', () => {
    const receive = walletTransaction({
      id: 'transparent_receive',
      type: 'receive',
      fromType: 'transparent',
      toType: 'transparent'
    })
    const progress = {
      kind: 'swap' as const,
      direction: 'to_zcash' as const,
      accountKey: 'mainnet_wallet_account',
      depositAddress: 'deposit-fixture',
      destinationChainTxHashes: [{ hash: receive.txHash.toUpperCase() }]
    }
    const linked = associateIncomingIntentsTransactions([receive], [progress], progress.accountKey)
    assert.equal(linked[0].depositAddress, 'deposit-fixture')
    assert.deepEqual(associateIncomingIntentsTransactions([], [progress], progress.accountKey), [])
    assert.equal(
      associateIncomingIntentsTransactions([receive], [progress], 'mainnet_other_account')[0]
        .depositAddress,
      undefined
    )
    assert.equal(
      associateIncomingIntentsTransactions(
        [walletTransaction({ type: 'send' })],
        [progress],
        progress.accountKey
      )[0].depositAddress,
      undefined
    )
    const refreshed = mergeTransactionsWithTransparentReceives(linked, [
      { ...receive, confirmations: 10 }
    ])
    assert.equal(refreshed.length, 1)
    assert.deepEqual(
      Object.fromEntries(
        Object.keys({ confirmations: 10, depositAddress: 'deposit-fixture' }).map(key => [
          key,
          refreshed[0][key]
        ])
      ),
      { confirmations: 10, depositAddress: 'deposit-fixture' }
    )
    assert.equal(
      associateIncomingIntentsTransactions(
        [receive],
        [progress, { ...progress, depositAddress: 'conflicting-deposit' }],
        progress.accountKey
      )[0].depositAddress,
      undefined
    )
  })

  test('transparent history only recovers a failed receive after matching final confirmation', () => {
    const failed = walletTransaction({
      id: 'local_receive',
      type: 'receive',
      fromType: 'transparent',
      status: 'failed',
      failureReason: 'timeout',
      notified: true,
      depositAddress: 'deposit-fixture'
    })
    for (const [status, confirmations] of [
      ['pending', 0],
      ['confirming', 9],
      ['success', 3],
      ['success', NaN]
    ] as const) {
      const incoming = walletTransaction({
        id: `rpc_treceive_${failed.txHash}`,
        type: 'receive',
        fromType: 'transparent',
        status,
        confirmations
      })
      assert.deepEqual(mergeTransactionsWithTransparentReceives([failed], [incoming]), [failed])
    }

    const confirmed = walletTransaction({
      id: `rpc_treceive_${failed.txHash}`,
      type: 'receive',
      fromType: 'transparent',
      status: 'success',
      confirmations: 10
    })
    const [recovered] = mergeTransactionsWithTransparentReceives([failed], [confirmed])
    assert.equal(recovered.id, failed.id)
    assert.equal(recovered.status, 'success')
    assert.equal(recovered.failureReason, undefined)
    assert.equal(recovered.notified, false)
    assert.equal(recovered.depositAddress, failed.depositAddress)
    assert.equal(recovered.confirmations, 10)
  })

  test('stale transparent history cannot lower a successful receive', () => {
    const successful = walletTransaction({
      type: 'receive',
      fromType: 'transparent',
      status: 'success',
      confirmations: 10,
      notified: true
    })
    const stale = { ...successful, status: 'confirming' as const, confirmations: 2 }
    assert.deepEqual(mergeTransactionsWithTransparentReceives([successful], [stale]), [successful])
  })

  test('ignores verbose transaction details for a different requested hash', async t => {
    const requestedHash = txid('a')
    const differentHash = txid('b')
    t.mock.method(globalThis, 'fetch', async (_input, init) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string }
      const result =
        method === 'getaddresstxids'
          ? [requestedHash]
          : {
              txid: differentHash,
              confirmations: 10,
              vout: [
                {
                  valueZat: 100_000,
                  scriptPubKey: { addresses: [account.addresses.transparent] }
                }
              ]
            }
      return new Response(JSON.stringify({ result }), { status: 200 })
    })

    const received = await fetchTransparentReceiveTransactions(account, 'mainnet', {
      baseUrl: 'https://rpc-mismatch.example'
    })
    assert.deepEqual(received, [])
  })
  test('reuses transaction details only after the requested confirmation depth', () => {
    const confirmed: VerboseTransaction = {
      txid: txid('a'),
      confirmations: 10
    }
    const confirming: VerboseTransaction = {
      txid: txid('b'),
      confirmations: 3
    }

    const result = partitionVerboseTransactions(
      [confirmed.txid, confirming.txid, txid('c')],
      {
        [confirmed.txid]: confirmed,
        [confirming.txid]: confirming
      },
      10
    )

    assert.deepEqual([...result.reusable.keys()], [confirmed.txid])
    assert.deepEqual(result.txidsToFetch, [confirming.txid, txid('c')])
  })

  test('reuses mined transactions when the node supplies a height', () => {
    const mined: VerboseTransaction = {
      txid: txid('d'),
      height: 4_200_000
    }

    const result = partitionVerboseTransactions([mined.txid], {
      [mined.txid]: mined
    })

    assert.deepEqual(result.reusable.get(mined.txid), mined)
    assert.deepEqual(result.txidsToFetch, [])
  })

  test('uses wallet sync confirmations for a trusted transparent receive', () => {
    const transaction = mapVerboseTransactionToReceive(
      {
        txid: txid('e'),
        confirmations: 1,
        vout: [
          {
            valueZat: 100_000,
            n: 0,
            scriptPubKey: { addresses: [account.addresses.transparent!] }
          }
        ]
      },
      new Map(),
      account,
      'mainnet',
      'trusted',
      3
    )

    assert.deepEqual(
      Object.fromEntries(
        Object.keys({
          status: 'success',
          confirmations: 3,
          requiredConfirmations: 3
        }).map(key => [key, transaction[key]])
      ),
      {
        status: 'success',
        confirmations: 3,
        requiredConfirmations: 3
      }
    )
  })

  test('repairs a stale local send from confirmed wallet history', () => {
    const staleSend = walletTransaction({
      status: 'confirming',
      confirmations: 2,
      requiredConfirmations: 3
    })
    const wasmReceive = walletTransaction({
      id: `wasm_${staleSend.txHash}`,
      status: 'success',
      type: 'receive',
      fromType: 'transparent',
      confirmations: 3,
      requiredConfirmations: 3
    })

    const merged = mergeTransactionsWithWasmHistory([staleSend], [wasmReceive], [])

    assert.deepEqual(merged.transactions[0], {
      ...staleSend,
      status: 'success',
      confirmations: 3
    })
    assert.deepEqual(merged.transactions[1], wasmReceive)
  })

  test('keeps an internal receive aligned with its confirmed send', () => {
    const confirmedSend = walletTransaction({
      status: 'success',
      confirmations: 3,
      requiredConfirmations: 3
    })
    const staleReceive = walletTransaction({
      id: `rpc_treceive_${confirmedSend.txHash}`,
      status: 'confirming',
      type: 'receive',
      fromType: 'transparent',
      confirmations: 2,
      requiredConfirmations: 3
    })
    const staleWasmReceive = {
      ...staleReceive,
      id: `wasm_${confirmedSend.txHash}`
    }

    const merged = mergeTransactionsWithWasmHistory(
      [confirmedSend, staleReceive],
      [staleWasmReceive],
      [staleReceive]
    )

    assert.deepEqual(merged.transactions, [
      confirmedSend,
      {
        ...staleReceive,
        status: 'success',
        confirmations: 3
      }
    ])
  })

  test('does not apply an unrelated send confirmation to an external receive', () => {
    const confirmedSend = walletTransaction({
      status: 'success',
      confirmations: 3,
      requiredConfirmations: 3
    })
    const externalReceive = walletTransaction({
      id: `rpc_treceive_${txid('e')}`,
      txHash: txid('e'),
      status: 'confirming',
      type: 'receive',
      fromType: 'transparent',
      confirmations: 3,
      requiredConfirmations: 10
    })

    const merged = mergeTransactionsWithWasmHistory([confirmedSend], [], [externalReceive])

    assert.deepEqual(merged.transactions, [confirmedSend, externalReceive])
  })

  test('repairs a stale shield amount from the shielded output and fee', () => {
    const staleShield = walletTransaction({
      status: 'confirming',
      type: 'shield',
      amount: '0.004814',
      confirmations: 1,
      requiredConfirmations: 3
    })
    const wasmShield = walletTransaction({
      id: `wasm_${staleShield.txHash}`,
      status: 'success',
      type: 'shield',
      amount: '0.00308475',
      fee: '0.0002',
      confirmations: 3,
      requiredConfirmations: 3
    })

    const merged = mergeTransactionsWithWasmHistory([staleShield], [wasmShield], [])

    assert.equal(merged.transactions.length, 1)
    assert.deepEqual(merged.transactions[0], {
      ...staleShield,
      status: 'success',
      confirmations: 3,
      amount: '0.00328475'
    })
  })

  test('mined wallet history repairs a failed local shield and persists its success', () => {
    const failedShield = walletTransaction({
      type: 'shield',
      status: 'failed',
      amount: '0.00167301',
      failureReason: 'expired',
      notified: true
    })
    const wasmShield = walletTransaction({
      id: `wasm_${failedShield.txHash}`,
      type: 'shield',
      status: 'success',
      amount: '0.00152301',
      fee: '0.00015',
      confirmations: 10,
      requiredConfirmations: 3
    })
    const repaired = mergeTransactionsWithWasmHistory([failedShield], [wasmShield], [])
    assert.equal(repaired.transactions.length, 1)
    const recovered = repaired.transactions[0]
    assert.equal(recovered.id, failedShield.id)
    assert.equal(recovered.status, 'success')
    assert.equal(recovered.amount, '0.00167301')
    assert.equal(recovered.failureReason, undefined)
    assert.equal(recovered.notified, false)
    assert.equal(repaired.newWasmTransactionCount, 0)

    const stale = mergeTransactionsWithWasmHistory(
      repaired.transactions,
      [{ ...wasmShield, status: 'failed' }],
      []
    )
    assert.equal(stale.transactions[0].status, 'success')
    assert.equal(stale.transactions[0].failureReason, undefined)
  })

  test('confirmed wallet history restores an imported failed WASM shield row', () => {
    const failed = walletTransaction({
      id: `wasm_${txid('f')}`,
      type: 'shield',
      status: 'failed',
      failureReason: 'timeout'
    })
    const confirmed = walletTransaction({
      id: failed.id,
      type: 'shield',
      status: 'success',
      confirmations: 3
    })
    const result = mergeTransactionsWithWasmHistory([failed], [confirmed], [])
    assert.equal(result.transactions.length, 1)
    assert.equal(result.transactions[0].status, 'success')
    assert.equal(result.transactions[0].failureReason, undefined)
  })

  test('unmined history and unrelated confirmed transactions cannot recover a failure', () => {
    const failed = walletTransaction({ type: 'shield', status: 'failed' })
    for (const history of [
      walletTransaction({ id: `wasm_${failed.txHash}`, status: 'pending' }),
      walletTransaction({ id: `wasm_${failed.txHash}`, status: 'confirming', confirmations: 2 }),
      walletTransaction({
        id: `wasm_${txid('e')}`,
        txHash: txid('e'),
        status: 'success',
        confirmations: 10
      })
    ]) {
      const result = mergeTransactionsWithWasmHistory([failed], [history], [])
      assert.equal(
        result.transactions.find(transaction => transaction.id === failed.id)?.status,
        'failed'
      )
    }
  })

  test('keeps a multi-step TEX send as one logical activity entry and removes persisted steps', () => {
    const fundingHash = txid('a')
    const paymentHash = txid('b')
    const texSend = walletTransaction({
      txHash: paymentHash,
      amount: '0.0001',
      fee: '0.00025',
      chainHashes: [
        { chain: 'Zcash', hash: fundingHash },
        { chain: 'Zcash', hash: paymentHash }
      ]
    })
    const fundingStep = walletTransaction({
      id: `wasm_${fundingHash}`,
      txHash: fundingHash,
      amount: '0.0002'
    })
    const paymentStep = walletTransaction({
      id: `wasm_${paymentHash}`,
      txHash: paymentHash,
      amount: '0.0001'
    })

    const merged = mergeTransactionsWithWasmHistory(
      [texSend, fundingStep, paymentStep],
      [fundingStep, paymentStep],
      []
    )

    assert.equal(merged.transactions.length, 1)
    assert.equal(merged.transactions[0].txHash, texSend.txHash)
    assert.deepEqual(merged.transactions[0].chainHashes, texSend.chainHashes)
    assert.equal(merged.newWasmTransactionCount, 0)
  })
})
