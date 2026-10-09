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
import {
  parseBase58Bytes,
  parseCanonicalBase64
} from '@/infrastructure/chains/solana/solana-rpc-codecs'
import { parseSolanaTransactionEnvelope } from '@/infrastructure/chains/solana/solana-transaction-codec'
import {
  SolanaSimulationError,
  type SolanaReadRpc
} from '@/infrastructure/chains/solana/solana-rpc-types'
import type { SolanaSigningPreparePayload } from './signing-adapter-solana'
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

export type SolanaTransactionSigningPreparePayload = Extract<
  SolanaSigningPreparePayload,
  { readonly kind: 'solana-transaction' }
>

export type SolanaMessageSigningPreparePayload = Extract<
  SolanaSigningPreparePayload,
  { readonly kind: 'solana-message' }
>

export interface SolanaSigningCredentialBindingProvider {
  readonly getCredentialBinding: (
    keyDomainId: string
  ) => Promise<Extract<KeyringCommandBinding, { readonly kind: 'credential' }>>
}

export interface SolanaMultichainSigningClientOptions {
  readonly credentials: SolanaSigningCredentialBindingProvider
  readonly rpc?: Pick<
    SolanaReadRpc,
    'assertExpectedChain' | 'getAddressLookupTable' | 'getFeeForMessage' | 'simulateTransaction'
  >
  readonly forward?: BackgroundMultichainForwarder
  readonly now?: () => number
  readonly createCommandId?: () => string
}

function parsePreparedSolanaSigning(
  value: unknown,
  payload: SolanaSigningPreparePayload
): PreparedSigningCommand {
  const record = readRecord(value, 'Prepared Solana signing command')
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
    'Prepared Solana signing command'
  )
  if (record.chainId !== payload.chainId) {
    throw new Error('Prepared Solana signing chain does not match the request')
  }
  const operation = payload.kind === 'solana-transaction' ? 'transaction' : 'message'
  readLiteral(record.operation, [operation], 'Solana signing operation')
  const fingerprint = readRecord(record.payloadFingerprint, 'Solana signing payload fingerprint')
  assertExactKeys(fingerprint, ['algorithm', 'digestHex'], [], 'Solana signing fingerprint')
  const digestHex = readString(fingerprint.digestHex, 'Solana signing fingerprint digest', 64)
  if (!/^[0-9a-f]{64}$/.test(digestHex)) {
    throw new Error('Solana signing fingerprint must be canonical lowercase hex')
  }
  const execution = readRecord(record.execution, 'Solana signing execution')
  assertExactKeys(execution, ['kind'], [], 'Solana signing execution')
  readLiteral(execution.kind, ['internal'], 'Solana signing execution kind')
  return Object.freeze({
    commandId: parseSigningCommandId(
      readString(record.commandId, 'Solana signing command ID', 128)
    ),
    chainId: payload.chainId,
    operation,
    summary: parseSigningSummary(record.summary, {
      family: 'solana',
      chainId: payload.chainId,
      operation
    }),
    payloadFingerprint: Object.freeze({
      algorithm: readLiteral(fingerprint.algorithm, ['sha256'], 'fingerprint algorithm'),
      digestHex
    }),
    execution: Object.freeze({ kind: 'internal' as const }),
    expiresAt: readSafeInteger(record.expiresAt, 'Solana signing expiry', Number.MAX_SAFE_INTEGER)
  })
}

function parseSignedSolanaMessage(value: unknown): SigningResult {
  const record = readRecord(value, 'Signed Solana message')
  assertExactKeys(
    record,
    ['kind', 'signature', 'publicKey', 'address'],
    [],
    'Signed Solana message'
  )
  readLiteral(record.kind, ['signature'], 'signed Solana result kind')
  const signature = readRecord(record.signature, 'Signed Solana message signature')
  assertExactKeys(signature, ['encoding', 'value'], [], 'Signed Solana message signature')
  readLiteral(signature.encoding, ['utf8'], 'signed Solana message signature encoding')
  const signatureValue = parseBase58Bytes(signature.value, 64, 'Solana signed message signature')
  const publicKey = parseBase58Bytes(record.publicKey, 32, 'Solana signed message public key')
  const address = parseBase58Bytes(record.address, 32, 'Solana signed message address')
  if (address !== publicKey) {
    throw new Error('Solana signed message address does not match its public key')
  }
  return Object.freeze({
    kind: 'signature' as const,
    signature: Object.freeze({ encoding: 'utf8' as const, value: signatureValue }),
    publicKey,
    address
  })
}

function parseSignedSolanaResult(value: unknown): SigningResult {
  const record = readRecord(value, 'Signed Solana result')
  return record.kind === 'signature'
    ? parseSignedSolanaMessage(value)
    : parseSignedSolanaTransaction(value)
}

function parseSignedSolanaTransaction(value: unknown): SigningResult {
  const record = readRecord(value, 'Signed Solana transaction')
  assertExactKeys(record, ['kind', 'payload', 'transactionId'], [], 'Signed Solana transaction')
  readLiteral(record.kind, ['signed-payload'], 'signed Solana result kind')
  const payload = readRecord(record.payload, 'Signed Solana transaction payload')
  assertExactKeys(payload, ['encoding', 'value'], [], 'Signed Solana transaction payload')
  readLiteral(payload.encoding, ['base64'], 'signed Solana payload encoding')
  const transactionBase64 = readString(payload.value, 'signed Solana transaction payload', 2_464)
  parseCanonicalBase64(transactionBase64, 1_232, 'Solana signed transaction')
  const transactionId = parseBase58Bytes(
    record.transactionId,
    64,
    'Solana signed transaction signature'
  )
  return Object.freeze({
    kind: 'signed-payload' as const,
    payload: Object.freeze({ encoding: 'base64' as const, value: transactionBase64 }),
    transactionId
  })
}

function parseCancelledSigning(value: unknown): boolean {
  const record = readRecord(value, 'Cancelled Solana signing command')
  assertExactKeys(record, ['cancelled'], [], 'Cancelled Solana signing command')
  return readBoolean(record.cancelled, 'cancelled Solana signing state')
}

export class SolanaMultichainSigningClient {
  private readonly commandClient: MultichainCommandClient

  constructor(private readonly options: SolanaMultichainSigningClientOptions) {
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
    payload: SolanaSigningPreparePayload,
    signal?: AbortSignal
  ): Promise<PreparedSigningCommand> {
    const binding = await this.options.credentials.getCredentialBinding(keyDomainId)
    let workerPayload = payload
    if (payload.kind === 'solana-transaction' && this.options.rpc) {
      await this.options.rpc.assertExpectedChain(signal)
      const envelope = parseSolanaTransactionEnvelope(payload.transaction)
      const simulationPromise = this.options.rpc
        .simulateTransaction(payload.transaction, signal)
        .then(result => Object.freeze({ status: 'succeeded' as const, result }))
        .catch(error => {
          if (error instanceof SolanaSimulationError) {
            return Object.freeze({
              status: 'failed' as const,
              result: Object.freeze({
                contextSlot: error.contextSlot,
                unitsConsumed: error.unitsConsumed
              })
            })
          }
          throw error
        })
      const [fee, simulation, ...lookupTables] = await Promise.all([
        this.options.rpc.getFeeForMessage(envelope.messageBase64, signal),
        simulationPromise,
        ...envelope.addressTableLookups.map(async lookup => {
          const table = await this.options.rpc?.getAddressLookupTable(lookup.accountKey, signal)
          if (!table) throw new Error(`Solana address lookup table ${lookup.accountKey} is missing`)
          return Object.freeze({
            accountKey: table.address,
            contextSlot: table.contextSlot,
            addresses: table.addresses
          })
        })
      ])
      workerPayload = Object.freeze({
        ...payload,
        reviewContext: Object.freeze({
          messageBase64: envelope.messageBase64,
          feeLamports: fee.feeLamports,
          feeContextSlot: fee.contextSlot,
          simulationStatus: simulation.status,
          simulationUnitsConsumed:
            simulation.status === 'succeeded' ? simulation.result.unitsConsumed.toString() : null,
          simulationContextSlot: simulation.result.contextSlot,
          lookupTables: Object.freeze(lookupTables)
        })
      })
    }
    return this.commandClient.execute(
      {
        operation: 'signing.prepare',
        binding,
        payload: workerPayload as unknown as KeyringCommandPayload,
        signal
      },
      value => parsePreparedSolanaSigning(value, payload)
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
      parseSignedSolanaResult
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
