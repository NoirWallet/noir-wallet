import { MultichainCommandClient } from '@/infrastructure/keyring/multichain/command-client'
import type { KeyDomainId } from '@/core/keyring/domain'
import { parseSigningSummary } from '@/core/keyring/domain'
import {
  type KeyringCommandBinding,
  type KeyringCommandPayload,
  parseSigningCommandId,
  type PreparedSigningCommand,
  type SigningCommandId,
  type SigningResult
} from '@/core/keyring/ports'
import { parseNearAccountId, parseNearBase58, parseNearPublicKey } from '@/core/chains/near'
import type { NearSigningPreparePayload } from './signing-adapter-near'
import {
  assertExactKeys,
  readBoolean,
  readLiteral,
  readRecord,
  readSafeInteger,
  readString
} from './raw-wallet-engine'
import {
  BackgroundMultichainTransport,
  type BackgroundMultichainForwarder
} from './background-transport'

const MAXIMUM_SIGNED_TRANSACTION_BYTES = 4 * 1024 * 1024

export type NearTransactionSigningPreparePayload = Extract<
  NearSigningPreparePayload,
  { readonly kind: 'near-transaction' }
>

export type NearMessageSigningPreparePayload = Extract<
  NearSigningPreparePayload,
  { readonly kind: 'near-nep413-message' }
>

export interface NearSigningCredentialBindingProvider {
  readonly getCredentialBinding: (
    keyDomainId: string
  ) => Promise<Extract<KeyringCommandBinding, { readonly kind: 'credential' }>>
}

export interface NearMultichainSigningClientOptions {
  readonly credentials: NearSigningCredentialBindingProvider
  readonly forward?: BackgroundMultichainForwarder
  readonly now?: () => number
  readonly createCommandId?: () => string
}

function parseCanonicalBase64(value: unknown, label: string): string {
  const parsed = readString(value, label, Math.ceil((MAXIMUM_SIGNED_TRANSACTION_BYTES * 4) / 3) + 4)
  const padding = parsed.endsWith('==') ? 2 : parsed.endsWith('=') ? 1 : 0
  const decodedBytes = parsed.length % 4 === 0 ? (parsed.length / 4) * 3 - padding : -1
  if (
    decodedBytes <= 0 ||
    decodedBytes > MAXIMUM_SIGNED_TRANSACTION_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(parsed)
  ) {
    throw new Error(`${label} must be bounded canonical base64`)
  }
  let binary: string
  try {
    binary = atob(parsed)
  } catch {
    throw new Error(`${label} must be bounded canonical base64`)
  }
  if (binary.length !== decodedBytes || btoa(binary) !== parsed) {
    throw new Error(`${label} must be bounded canonical base64`)
  }
  return parsed
}

function parsePreparedNearSigning(
  value: unknown,
  payload: NearSigningPreparePayload
): PreparedSigningCommand {
  const record = readRecord(value, 'Prepared NEAR signing command')
  assertExactKeys(
    record,
    [
      'commandId',
      'chainId',
      'operation',
      'summary',
      'payloadFingerprint',
      'execution',
      'expiresAt'
    ],
    [],
    'Prepared NEAR signing command'
  )
  if (record.chainId !== payload.chainId) {
    throw new Error('Prepared NEAR signing chain does not match the request')
  }
  const operation = payload.kind === 'near-transaction' ? 'transaction' : 'message'
  readLiteral(record.operation, [operation], 'NEAR signing operation')
  const fingerprint = readRecord(record.payloadFingerprint, 'NEAR signing payload fingerprint')
  assertExactKeys(fingerprint, ['algorithm', 'digestHex'], [], 'NEAR signing fingerprint')
  const digestHex = readString(fingerprint.digestHex, 'NEAR signing fingerprint digest', 64)
  if (!/^[0-9a-f]{64}$/.test(digestHex)) {
    throw new Error('NEAR signing fingerprint must be canonical lowercase hex')
  }
  const execution = readRecord(record.execution, 'NEAR signing execution')
  assertExactKeys(execution, ['kind'], [], 'NEAR signing execution')
  readLiteral(execution.kind, ['internal'], 'NEAR signing execution kind')
  return Object.freeze({
    commandId: parseSigningCommandId(readString(record.commandId, 'NEAR signing command ID', 128)),
    chainId: payload.chainId,
    operation,
    summary: parseSigningSummary(record.summary, {
      family: 'near',
      chainId: payload.chainId,
      operation
    }),
    payloadFingerprint: Object.freeze({
      algorithm: readLiteral(fingerprint.algorithm, ['sha256'], 'fingerprint algorithm'),
      digestHex
    }),
    execution: Object.freeze({ kind: 'internal' as const }),
    expiresAt: readSafeInteger(record.expiresAt, 'NEAR signing expiry', Number.MAX_SAFE_INTEGER)
  })
}

function parseSignedNearTransaction(value: unknown): SigningResult {
  const record = readRecord(value, 'Signed NEAR transaction')
  assertExactKeys(record, ['kind', 'payload', 'transactionId'], [], 'Signed NEAR transaction')
  readLiteral(record.kind, ['signed-payload'], 'signed NEAR result kind')
  const payload = readRecord(record.payload, 'Signed NEAR transaction payload')
  assertExactKeys(payload, ['encoding', 'value'], [], 'Signed NEAR transaction payload')
  readLiteral(payload.encoding, ['base64'], 'signed NEAR payload encoding')
  const signedTransaction = parseCanonicalBase64(payload.value, 'signed NEAR transaction')
  const transactionId = parseNearBase58(record.transactionId, 32, 'NEAR transaction hash')
  return Object.freeze({
    kind: 'signed-payload' as const,
    payload: Object.freeze({ encoding: 'base64' as const, value: signedTransaction }),
    transactionId
  })
}

function parseSignedNearMessage(value: unknown): SigningResult {
  const record = readRecord(value, 'Signed NEAR message')
  assertExactKeys(record, ['kind', 'signature', 'publicKey', 'address'], [], 'Signed NEAR message')
  readLiteral(record.kind, ['signature'], 'signed NEAR result kind')
  const signature = readRecord(record.signature, 'Signed NEAR message signature')
  assertExactKeys(signature, ['encoding', 'value'], [], 'Signed NEAR message signature')
  readLiteral(signature.encoding, ['base64'], 'signed NEAR message signature encoding')
  const signatureValue = parseCanonicalBase64(signature.value, 'signed NEAR message signature')
  if (atob(signatureValue).length !== 64) {
    throw new Error('Signed NEAR message signature must be 64 bytes')
  }
  return Object.freeze({
    kind: 'signature' as const,
    signature: Object.freeze({ encoding: 'base64' as const, value: signatureValue }),
    publicKey: parseNearPublicKey(record.publicKey, 'Signed NEAR message public key'),
    address: parseNearAccountId(record.address, 'Signed NEAR message account ID')
  })
}

function parseSignedNearResult(value: unknown): SigningResult {
  const record = readRecord(value, 'Signed NEAR result')
  return record.kind === 'signature'
    ? parseSignedNearMessage(value)
    : parseSignedNearTransaction(value)
}

function parseCancelledSigning(value: unknown): boolean {
  const record = readRecord(value, 'Cancelled NEAR signing command')
  assertExactKeys(record, ['cancelled'], [], 'Cancelled NEAR signing command')
  return readBoolean(record.cancelled, 'cancelled NEAR signing state')
}

export class NearMultichainSigningClient {
  private readonly commandClient: MultichainCommandClient

  constructor(private readonly options: NearMultichainSigningClientOptions) {
    this.commandClient = new MultichainCommandClient(
      new BackgroundMultichainTransport(options.forward),
      {
        defaultTimeoutMs: 120_000,
        maxTimeoutMs: 120_000,
        ...(options.now === undefined ? {} : { now: options.now }),
        ...(options.createCommandId === undefined
          ? {}
          : { createCommandId: options.createCommandId })
      }
    )
  }

  async prepare(
    keyDomainId: KeyDomainId,
    payload: NearSigningPreparePayload,
    signal?: AbortSignal
  ): Promise<PreparedSigningCommand> {
    const binding = await this.options.credentials.getCredentialBinding(keyDomainId)
    return this.commandClient.execute(
      {
        operation: 'signing.prepare',
        binding,
        payload: payload as unknown as KeyringCommandPayload,
        signal
      },
      value => parsePreparedNearSigning(value, payload)
    )
  }

  async confirm(
    keyDomainId: KeyDomainId,
    commandId: SigningCommandId,
    signal?: AbortSignal
  ): Promise<SigningResult> {
    const binding = await this.options.credentials.getCredentialBinding(keyDomainId)
    return this.commandClient.execute(
      {
        operation: 'signing.confirm',
        binding,
        payload: { signingCommandId: commandId },
        signal
      },
      parseSignedNearResult
    )
  }

  async cancel(
    keyDomainId: KeyDomainId,
    commandId: SigningCommandId,
    signal?: AbortSignal
  ): Promise<void> {
    const binding = await this.options.credentials.getCredentialBinding(keyDomainId)
    await this.commandClient.execute(
      {
        operation: 'signing.cancel',
        binding,
        payload: { signingCommandId: commandId },
        signal
      },
      parseCancelledSigning
    )
  }

  destroy(): Promise<void> {
    return this.commandClient.destroy()
  }
}
