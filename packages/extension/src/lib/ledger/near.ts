import {
  Apdu,
  GetAppAndVersionCommand,
  isSuccessCommandResult,
  type DeviceManagementKit,
  type DeviceSessionId,
  type GetAppAndVersionResponse
} from '@ledgerhq/device-management-kit'
import { ed25519 } from '@noble/curves/ed25519'
import { base64ToBytes, bytesToBase64 } from '@/lib/bytes'
import { nearPublicKeyFromImplicitAccountId, parseNearPublicKey } from '@/core/chains/near'
import type {
  LedgerNearSigningRequest,
  LedgerNearSigningResponse
} from '@/core/keyring/protocol/ledger-signing'
import { getLedgerDeviceName, type LedgerTransport, withLedgerSession } from './device'

const NEAR_CLA = 0x80
const GET_PUBLIC_KEY = 4
const SIGN_TRANSACTION = 2
const SIGN_MESSAGE = 7
const GET_VERSION = 6
const CHUNK_SIZE = 123
const MAINNET_APP_NETWORK = 0x57
const NEP413_PREFIX = [0x9d, 0x01, 0x00, 0x80]

export interface LedgerNearAccountExport {
  readonly path: string
  readonly publicKey: string
  readonly address: string
  readonly deviceModel: string
  readonly deviceName: string
  readonly appVersion: string
}

export type {
  LedgerNearSigningRequest,
  LedgerNearSigningResponse
} from '@/core/keyring/protocol/ledger-signing'

export interface LedgerNearDeviceOptions {
  readonly transport: LedgerTransport
  readonly onInteraction?: (interaction: string) => void
  readonly signal?: AbortSignal
}

function nearPathBytes(path: string): Uint8Array {
  const normalized = path.startsWith('m/') ? path.slice(2) : path
  const components = normalized.split('/')
  if (
    components.length !== 5 ||
    components[0] !== "44'" ||
    components[1] !== "397'" ||
    components.some(component => !/^(0|[1-9][0-9]*)'$/.test(component))
  ) {
    throw new Error('Invalid Ledger NEAR derivation path')
  }
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < components.length; index += 1) {
    const value = Number(components[index].slice(0, -1))
    if (!Number.isSafeInteger(value) || value > 0x7fffffff) {
      throw new Error('Invalid Ledger NEAR derivation path')
    }
    view.setUint32(index * 4, value | 0x80000000, false)
  }
  return bytes
}

function normalizePath(path: string): string {
  nearPathBytes(path)
  return path.startsWith('m/') ? path : `m/${path}`
}

async function sendNearApdu(
  dmk: DeviceManagementKit,
  sessionId: DeviceSessionId,
  instruction: number,
  p1: number,
  data: Uint8Array,
  signal?: AbortSignal,
  p2 = MAINNET_APP_NETWORK
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const response = await dmk.sendApdu({
    sessionId,
    apdu: new Apdu(NEAR_CLA, instruction, p1, p2, data).getRawApdu()
  })
  signal?.throwIfAborted()
  if (response.statusCode[0] !== 0x90 || response.statusCode[1] !== 0x00) {
    const status = [...response.statusCode].map(byte => byte.toString(16).padStart(2, '0')).join('')
    throw new Error(`Ledger NEAR app rejected the request (0x${status})`)
  }
  return response.data
}

async function assertNearApp(
  dmk: DeviceManagementKit,
  sessionId: DeviceSessionId,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  const app = await dmk.sendCommand<GetAppAndVersionResponse, void, void>({
    sessionId,
    command: new GetAppAndVersionCommand()
  })
  if (!isSuccessCommandResult(app) || app.data.name !== 'NEAR') {
    throw new Error('Open the NEAR app on your Ledger device')
  }
  await sendNearApdu(dmk, sessionId, GET_VERSION, 0, new Uint8Array(), signal, 0)
  return app.data.version
}

function nearPublicKey(bytes: Uint8Array): string {
  if (bytes.byteLength !== 32) throw new Error('Ledger returned an invalid NEAR public key')
  const implicitAccountId = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return nearPublicKeyFromImplicitAccountId(implicitAccountId)
}

export async function exportLedgerNearAccount(
  path: string,
  options: LedgerNearDeviceOptions
): Promise<LedgerNearAccountExport> {
  const normalizedPath = normalizePath(path)
  return withLedgerSession(options, async ({ dmk, sessionId, device }) => {
    const appVersion = await assertNearApp(dmk, sessionId, options.signal)
    const publicKeyBytes = await sendNearApdu(
      dmk,
      sessionId,
      GET_PUBLIC_KEY,
      0,
      nearPathBytes(normalizedPath),
      options.signal
    )
    const publicKey = nearPublicKey(publicKeyBytes)
    return Object.freeze({
      path: normalizedPath,
      publicKey,
      address: [...publicKeyBytes].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      deviceModel: device.deviceModel.model,
      deviceName: getLedgerDeviceName(device.deviceModel.model, device.name),
      appVersion
    })
  })
}

export async function signLedgerNearRequest(
  request: LedgerNearSigningRequest,
  options: LedgerNearDeviceOptions
): Promise<LedgerNearSigningResponse> {
  if (request.chainId !== 'near:mainnet' && request.chainId !== 'near:testnet') {
    throw new Error('Unsupported Ledger NEAR chain')
  }
  const path = normalizePath(request.path)
  const expectedPublicKey = parseNearPublicKey(
    request.expectedPublicKey,
    'Expected NEAR public key'
  )
  const payload = base64ToBytes(request.payloadBase64)
  if (payload.byteLength === 0 || payload.byteLength > 1024 * 1024) {
    throw new Error('Invalid Ledger NEAR signing payload')
  }
  const isMessage = request.kind === 'near-nep413-message'
  if (isMessage && !NEP413_PREFIX.every((byte, index) => payload[index] === byte)) {
    throw new Error('Ledger NEAR message requires a NEP-413 payload')
  }
  return withLedgerSession(options, async ({ dmk, sessionId }) => {
    await assertNearApp(dmk, sessionId, options.signal)
    const actualPublicKeyBytes = await sendNearApdu(
      dmk,
      sessionId,
      GET_PUBLIC_KEY,
      0,
      nearPathBytes(path),
      options.signal
    )
    const actualPublicKey = nearPublicKey(actualPublicKeyBytes)
    if (actualPublicKey !== expectedPublicKey) {
      throw new Error('Ledger NEAR public key does not match the registered account')
    }
    // The NEAR app strips the NEP-413 domain prefix before parsing the message.
    const data = isMessage ? payload.subarray(4) : payload
    const allData = new Uint8Array(20 + data.byteLength)
    allData.set(nearPathBytes(path))
    allData.set(data, 20)
    let signature: Uint8Array<ArrayBufferLike> = new Uint8Array()
    for (let offset = 0; offset < allData.byteLength; offset += CHUNK_SIZE) {
      signature = await sendNearApdu(
        dmk,
        sessionId,
        isMessage ? SIGN_MESSAGE : SIGN_TRANSACTION,
        offset + CHUNK_SIZE >= allData.byteLength ? 0x80 : 0,
        allData.subarray(offset, offset + CHUNK_SIZE),
        options.signal
      )
    }
    if (signature.byteLength !== 64) throw new Error('Ledger returned an invalid NEAR signature')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(payload)))
    if (!ed25519.verify(signature, digest, actualPublicKeyBytes, { zip215: false })) {
      throw new Error('Ledger NEAR signature does not match the requested payload')
    }
    return Object.freeze({
      kind: request.kind,
      signatureBase64: bytesToBase64(signature),
      publicKey: actualPublicKey
    })
  })
}
