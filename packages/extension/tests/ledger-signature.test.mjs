import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeLedgerTransparentSignature } from '../src/lib/ledger/signature.ts'

const DER_SIGNATURE_WITH_SIGHASH = Uint8Array.of(
  0x30,
  0x06,
  0x02,
  0x01,
  0x01,
  0x02,
  0x01,
  0x01,
  0x01
)

test('normalizes the Ledger recovery bit without changing canonical DER signatures', () => {
  const recoverable = DER_SIGNATURE_WITH_SIGHASH.slice()
  recoverable[0] = 0x31

  assert.deepStrictEqual(
    normalizeLedgerTransparentSignature(recoverable),
    DER_SIGNATURE_WITH_SIGHASH
  )
  assert.deepStrictEqual(
    normalizeLedgerTransparentSignature(DER_SIGNATURE_WITH_SIGHASH),
    DER_SIGNATURE_WITH_SIGHASH
  )
})

test('rejects unsupported Ledger transparent signature encodings', () => {
  const invalidHeader = DER_SIGNATURE_WITH_SIGHASH.slice()
  invalidHeader[0] = 0x32
  assert.throws(
    () => normalizeLedgerTransparentSignature(invalidHeader),
    /invalid transparent signature encoding/
  )

  const invalidSighash = DER_SIGNATURE_WITH_SIGHASH.slice()
  invalidSighash[invalidSighash.length - 1] = 0x02
  assert.throws(
    () => normalizeLedgerTransparentSignature(invalidSighash),
    /unsupported transparent signature sighash type/
  )
})
