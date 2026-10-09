import { secp256k1 } from '@noble/curves/secp256k1'
import {
  keccak256,
  parseTransaction,
  serializeTransaction,
  type Hex,
  type TransactionSerializableEIP1559,
  type TransactionSerializedEIP1559
} from 'viem'
import type { PreparedEvmTransfer } from './evm-transaction-builder'

export interface SignedEvmTransactionEnvelope {
  readonly rawTransaction: string
  readonly transactionHash: string
}

function toSerializableEip1559(prepared: PreparedEvmTransfer): TransactionSerializableEIP1559 {
  const transaction = prepared.transaction
  const chainId = Number(transaction.chainId)
  const nonce = Number(transaction.nonce)
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !Number.isSafeInteger(nonce) || nonce < 0) {
    failIntegrity('chain-id')
  }
  return Object.freeze({
    type: 'eip1559' as const,
    chainId,
    nonce,
    maxFeePerGas: BigInt(transaction.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
    gas: BigInt(transaction.gasLimit),
    to: transaction.to as Hex,
    value: BigInt(transaction.value),
    data: transaction.input as Hex,
    accessList: Object.freeze([])
  })
}

export function serializePreparedEvmUnsignedTransaction(prepared: PreparedEvmTransfer): string {
  return serializeTransaction(toSerializableEip1559(prepared))
}

export async function createKeystoneSignedEvmTransaction(
  prepared: PreparedEvmTransfer,
  signatureHex: string
): Promise<SignedEvmTransactionEnvelope> {
  if (!/^0x[0-9a-f]{130}$/.test(signatureHex)) failIntegrity('signature-envelope')
  const yParity = Number.parseInt(signatureHex.slice(-2), 16)
  if (yParity !== 0 && yParity !== 1) failIntegrity('signature-recovery')
  const rawTransaction = serializeTransaction(toSerializableEip1559(prepared), {
    r: signatureHex.slice(0, 66) as Hex,
    s: `0x${signatureHex.slice(66, 130)}` as Hex,
    yParity
  })
  const envelope = Object.freeze({
    rawTransaction,
    transactionHash: keccak256(rawTransaction)
  })
  await assertSignedEvmTransactionMatchesPrepared(prepared, envelope)
  return envelope
}

function failIntegrity(reason: string): never {
  throw new Error(`Signed EVM transaction failed integrity validation (${reason})`)
}

function equalAddress(left: string | null | undefined, right: string): boolean {
  return left?.toLowerCase() === right.toLowerCase()
}

export async function assertSignedEvmTransactionMatchesPrepared(
  prepared: PreparedEvmTransfer,
  signed: SignedEvmTransactionEnvelope
): Promise<void> {
  if (
    !/^0x02(?:[0-9a-f]{2})+$/.test(signed.rawTransaction) ||
    signed.rawTransaction.length > 2 + 128 * 1024 * 2 ||
    !/^0x[0-9a-f]{64}$/.test(signed.transactionHash)
  ) {
    failIntegrity('envelope')
  }

  const rawTransaction = signed.rawTransaction as TransactionSerializedEIP1559
  let decoded: TransactionSerializableEIP1559
  try {
    decoded = parseTransaction(rawTransaction)
  } catch {
    failIntegrity('transaction-decode')
  }

  if (decoded.r === undefined || decoded.s === undefined || decoded.yParity === undefined) {
    failIntegrity('signature-fields')
  }

  const signature = (() => {
    try {
      return secp256k1.Signature.fromCompact(`${decoded.r.slice(2)}${decoded.s.slice(2)}`)
    } catch {
      failIntegrity('signature-decode')
    }
  })()
  if (signature.hasHighS()) failIntegrity('signature-high-s')

  let signer: string
  try {
    const { r: _r, s: _s, v: _v, yParity, ...unsignedTransaction } = decoded
    const signingHash = keccak256(serializeTransaction(unsignedTransaction))
    const publicKey = signature
      .addRecoveryBit(yParity)
      .recoverPublicKey(signingHash.slice(2))
      .toHex(false)
    signer = `0x${keccak256(`0x${publicKey.slice(2)}` as Hex).slice(-40)}`
  } catch {
    failIntegrity('signature-recovery')
  }

  const transaction = prepared.transaction
  if (decoded.type !== 'eip1559') failIntegrity('transaction-type')
  if (keccak256(rawTransaction) !== signed.transactionHash) failIntegrity('transaction-hash')
  if (!equalAddress(signer, prepared.from)) failIntegrity('signer')
  if (decoded.chainId?.toString() !== transaction.chainId) failIntegrity('chain-id')
  if (decoded.nonce?.toString() !== transaction.nonce) failIntegrity('nonce')
  if (decoded.maxFeePerGas?.toString() !== transaction.maxFeePerGas) failIntegrity('max-fee')
  // viem omits an RLP-encoded zero priority fee from the parsed transaction.
  if ((decoded.maxPriorityFeePerGas ?? 0n).toString() !== transaction.maxPriorityFeePerGas) {
    failIntegrity('priority-fee')
  }
  if (decoded.gas?.toString() !== transaction.gasLimit) failIntegrity('gas-limit')
  if (!equalAddress(decoded.to, transaction.to)) failIntegrity('recipient')
  if ((decoded.value ?? 0n).toString() !== transaction.value) failIntegrity('value')
  if ((decoded.data ?? '0x').toLowerCase() !== transaction.input) failIntegrity('calldata')
  if ((decoded.accessList?.length ?? 0) !== 0) failIntegrity('access-list')
}
