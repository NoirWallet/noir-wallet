const DER_SEQUENCE_TAG = 0x30
const LEDGER_RECOVERY_BIT = 0x01
const SIGHASH_ALL = 0x01

/** Converts Ledger's recoverable ECDSA encoding to canonical DER + sighash. */
export function normalizeLedgerTransparentSignature(signature: Uint8Array): Uint8Array {
  if (signature.length < 2) {
    throw new Error('Ledger returned an empty transparent signature')
  }
  if (signature[signature.length - 1] !== SIGHASH_ALL) {
    throw new Error('Ledger returned an unsupported transparent signature sighash type')
  }

  const header = signature[0]
  if ((header & ~LEDGER_RECOVERY_BIT) !== DER_SEQUENCE_TAG) {
    throw new Error('Ledger returned an invalid transparent signature encoding')
  }

  const normalized = signature.slice()
  normalized[0] = DER_SEQUENCE_TAG
  return normalized
}
