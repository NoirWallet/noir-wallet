import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  DeviceModelId,
  type DeviceManagementKit,
  type DiscoveredDevice,
  type ExecuteDeviceActionReturnType,
  type LoggerSubscriberService
} from '@ledgerhq/device-management-kit'
import {
  SignerZcashBuilder,
  type PcztTransaction,
  type SignerZcash,
  type SignPcztTransactionResult
} from '@ledgerhq/device-signer-kit-zcash'
import { webHidIdentifier, webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid'
import { webBleIdentifier, webBleTransportFactory } from '@ledgerhq/device-transport-kit-web-ble'
import { firstValueFrom, timeout, type Subscription } from 'rxjs'
import { bytesToBase64, base64ToBytes } from '@/lib/bytes'
import { normalizeLedgerTransparentSignature } from '@/lib/ledger/signature'
import type { Network } from '@/types'
import type { LedgerPcztSignatures, LedgerSigningPayload } from '@/core/worker/types'
import { logger } from '@/lib/logger'
import { getLedgerAccountPath } from '@/lib/zcash-derivation'

export type LedgerTransport = 'usb' | 'bluetooth'

export interface LedgerAccountExport {
  ufvk: string
  deviceModel: string
  deviceName: string
  appVersion: string
}

export function parseLedgerSigningPayload(value: unknown): LedgerSigningPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid Ledger signing payload')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.transaction !== 'object' ||
    record.transaction === null ||
    !Array.isArray(record.orchardSignatureIndices) ||
    !Array.isArray(record.ironwoodSignatureIndices) ||
    record.orchardSignatureIndices.length > 1024 ||
    record.ironwoodSignatureIndices.length > 1024 ||
    [...record.orchardSignatureIndices, ...record.ironwoodSignatureIndices].some(
      index => !Number.isSafeInteger(index) || index < 0
    )
  ) {
    throw new Error('Invalid Ledger signing payload')
  }
  return {
    transaction: record.transaction,
    orchardSignatureIndices: record.orchardSignatureIndices,
    ironwoodSignatureIndices: record.ironwoodSignatureIndices
  }
}

const BLUETOOTH_DEVICE_MODELS = new Set<DeviceModelId>([
  DeviceModelId.NANO_X,
  DeviceModelId.STAX,
  DeviceModelId.FLEX,
  DeviceModelId.APEX
])

export function getLedgerDeviceName(deviceModel?: string, deviceName?: string): string {
  if (deviceName) return deviceName
  switch (deviceModel) {
    case DeviceModelId.NANO_SP:
      return 'Ledger Nano S Plus'
    case DeviceModelId.NANO_X:
      return 'Ledger Nano X'
    case DeviceModelId.STAX:
      return 'Ledger Stax'
    case DeviceModelId.FLEX:
      return 'Ledger Flex'
    case DeviceModelId.APEX:
      return 'Ledger Nano Gen5'
    default:
      return 'Ledger'
  }
}

export function ledgerSupportsBluetooth(deviceModel?: string): boolean {
  return BLUETOOTH_DEVICE_MODELS.has(deviceModel as DeviceModelId)
}

const MIN_ZCASH_APP_VERSION = '3.9.2'
const DISCOVERY_TIMEOUT_MS = 60_000
const ACTION_TIMEOUT_MS = 5 * 60_000
const LEDGER_TRANSPARENT_INPUT_DATA_ERROR = 'LedgerPcztTransparentInputDataError'

let dmkInstance: DeviceManagementKit | null = null

interface LedgerCommandTrace {
  command: string
}

let lastLedgerCommand: LedgerCommandTrace | undefined

const PCZT_COMMAND_BY_INS: Record<string, string> = {
  '52': 'PcztHeader',
  '53': 'PcztTransparentInput',
  '54': 'PcztTransparentOutput',
  '55': 'SignPcztTransparent',
  '56': 'PcztOrchardAction',
  '57': 'SignPcztOrchard',
  '58': 'PcztIronwoodAction',
  '59': 'SignPcztIronwood'
}

function pcztCommandFromApdu(apdu: string): LedgerCommandTrace | undefined {
  if (!/^e0[0-9a-f]{8}/i.test(apdu)) return undefined
  const command = PCZT_COMMAND_BY_INS[apdu.slice(2, 4).toLowerCase()]
  if (!command) return undefined
  return { command }
}

const ledgerCommandTracker: LoggerSubscriberService = {
  log(_level, message, options) {
    const command = /^\[sendCommand\]\s+(.+)$/.exec(message)?.[1]
    // DMK also logs `[sendCommand] result` and `[sendCommand] error` after the
    // command name. Those are events, not commands, and must not overwrite the
    // APDU stage that failed.
    if (command && command !== 'result' && command !== 'error') {
      lastLedgerCommand = { command }
      return
    }

    // Device actions skip the command-name log; inspect only the APDU header.
    const outgoingApdu = /^\[will send APDU\]\s+~\.\.\.>\s+([0-9a-f]+)/i.exec(message)?.[1]
    const exchangeApdu =
      options.data?.type === 'apdu-exchange' && typeof options.data.apdu === 'string'
        ? options.data.apdu
        : undefined
    const pcztCommand = pcztCommandFromApdu(exchangeApdu ?? outgoingApdu ?? '')
    if (pcztCommand) {
      lastLedgerCommand = pcztCommand
    }
  }
}

function getDmk(): DeviceManagementKit {
  if (!dmkInstance) {
    dmkInstance = new DeviceManagementKitBuilder()
      .addTransport(webHidTransportFactory)
      .addTransport(webBleTransportFactory)
      // Track only command names for actionable device errors.
      .addLogger(ledgerCommandTracker)
      .build()
  }
  return dmkInstance
}

function transportIdentifier(transport: LedgerTransport) {
  return transport === 'usb' ? webHidIdentifier : webBleIdentifier
}

const LEDGER_ERROR_MESSAGES: Record<string, string> = {
  InsNotSupportedError:
    'This Zcash app does not support shielded operations. Install the Zcash Shielded app via Ledger Wallet.',
  ClaNotSupportedError:
    'The Zcash app did not recognize this command. Make sure the Zcash app is open on your Ledger.',
  ConditionOfUseNotSatisfiedError: 'Request was rejected on the Ledger device.',
  SecurityStatusNotSatisfiedError:
    'The device is locked or access is denied. Unlock your Ledger and try again.',
  UnsupportedV6TransactionError:
    'This transaction format is not supported by the current Zcash app version.'
}

interface LedgerErrorDetails {
  tag?: string
  code?: string
  message: string
}

function getErrorMessage(value: unknown): string | undefined {
  if (value instanceof Error && value.message) return value.message
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  if (typeof record.message === 'string' && record.message) return record.message
  return (
    getErrorMessage(record.originalError) ??
    getErrorMessage(record.cause) ??
    getErrorMessage(record.err)
  )
}

function describeLedgerError(error: unknown): LedgerErrorDetails {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
  const tag = typeof record?._tag === 'string' ? record._tag : undefined
  const code =
    typeof record?.errorCode === 'string' || typeof record?.errorCode === 'number'
      ? String(record.errorCode)
      : undefined
  const rawMessage = getErrorMessage(error) ?? 'Ledger operation failed'
  const mappedMessage =
    LEDGER_ERROR_MESSAGES[rawMessage] ?? (tag ? LEDGER_ERROR_MESSAGES[tag] : undefined)

  return {
    tag,
    code,
    message: mappedMessage ?? rawMessage
  }
}

function isIncorrectDataError(details: LedgerErrorDetails): boolean {
  return (
    details.code?.toLowerCase() === '6a80' ||
    /IncorrectDataError|ZcashAppCommandError\/6a80/i.test(details.message)
  )
}

function formatLedgerError(
  details: LedgerErrorDetails,
  command: LedgerCommandTrace | undefined
): string {
  const diagnostic = [details.tag, details.code].filter(Boolean).join('/')
  const suffix = diagnostic ? ` (${diagnostic})` : ''
  if (isIncorrectDataError(details) && command?.command === 'PcztTransparentInput') {
    return (
      `${LEDGER_TRANSPARENT_INPUT_DATA_ERROR}: ` +
      `Ledger rejected the transparent input data${suffix}`
    )
  }
  return `${details.message}${suffix}`
}

export function shouldRebuildLedgerPczt(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes(LEDGER_TRANSPARENT_INPUT_DATA_ERROR) ||
    /IncorrectDataError|ZcashAppCommandError\/6a80/i.test(message)
  )
}

export function isLedgerTransparentInputDataError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(LEDGER_TRANSPARENT_INPUT_DATA_ERROR)
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(value => Number.parseInt(value, 10) || 0)
  const b = right.split('.').map(value => Number.parseInt(value, 10) || 0)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function assertSupportedDevice(device: DiscoveredDevice): void {
  if (device.deviceModel.model === DeviceModelId.NANO_S) {
    throw new Error('Ledger Nano S is not supported by the Zcash app')
  }
}

function assertSupportedAppVersion(version: string): void {
  if (compareVersions(version, MIN_ZCASH_APP_VERSION) < 0) {
    throw new Error(
      `Zcash app ${MIN_ZCASH_APP_VERSION} or newer is required; connected device has ${version}`
    )
  }
}

async function runAction<Output, Error, Intermediate extends { requiredUserInteraction: string }>(
  action: ExecuteDeviceActionReturnType<Output, Error, Intermediate>,
  onInteraction?: (interaction: string) => void,
  operation = 'device_action'
): Promise<Output> {
  return new Promise((resolve, reject) => {
    lastLedgerCommand = undefined
    let subscription: Subscription | undefined
    const timer = window.setTimeout(() => {
      action.cancel()
      subscription?.unsubscribe()
      reject(new Error('Ledger operation timed out'))
    }, ACTION_TIMEOUT_MS)
    const finish = (callback: () => void) => {
      window.clearTimeout(timer)
      subscription?.unsubscribe()
      callback()
    }
    subscription = action.observable.subscribe(state => {
      if (state.status === DeviceActionStatus.Pending) {
        onInteraction?.(state.intermediateValue.requiredUserInteraction)
      } else if (state.status === DeviceActionStatus.Completed) {
        finish(() => resolve(state.output))
      } else if (state.status === DeviceActionStatus.Error) {
        const details = describeLedgerError(state.error)
        logger.warn(
          `[Ledger] ${operation} failed at ${lastLedgerCommand?.command ?? 'unknown'} (${details.code ?? 'unknown'})`
        )
        const wrappedError = new Error(formatLedgerError(details, lastLedgerCommand))
        Object.defineProperty(wrappedError, 'cause', { value: state.error })
        finish(() => reject(wrappedError))
      } else if (state.status === DeviceActionStatus.Stopped) {
        finish(() => reject(new Error('Ledger operation was cancelled')))
      }
    })
  })
}

export async function discoverLedger(transport: LedgerTransport): Promise<DiscoveredDevice> {
  const dmk = getDmk()
  try {
    const device = await firstValueFrom(
      dmk
        .startDiscovering({ transport: transportIdentifier(transport) })
        .pipe(timeout(DISCOVERY_TIMEOUT_MS))
    )
    assertSupportedDevice(device)
    return device
  } finally {
    await dmk.stopDiscovering().catch(() => {})
  }
}

async function withLedgerSigner<T>(
  transport: LedgerTransport,
  action: (args: {
    signer: SignerZcash
    device: DiscoveredDevice
    appVersion: string
  }) => Promise<T>,
  onInteraction?: (interaction: string) => void,
  preDiscovered?: DiscoveredDevice
): Promise<T> {
  const dmk = getDmk()
  const device = preDiscovered ?? (await discoverLedger(transport))
  const sessionId = await dmk.connect({
    device,
    sessionRefresherOptions: { isRefresherDisabled: true }
  })
  try {
    const signer = new SignerZcashBuilder({ dmk, sessionId }).build()
    const config = await runAction(signer.getAppConfig(), onInteraction, 'get_app_config')
    assertSupportedAppVersion(config.version)
    return await action({ signer, device, appVersion: config.version })
  } finally {
    await dmk.disconnect({ sessionId }).catch(() => {})
  }
}

const LEDGER_BYTE_FIELDS = new Set([
  'pubkey',
  'seedFingerprint',
  'prevoutTxid',
  'scriptPubKey',
  'cvNet',
  'nullifier',
  'rk',
  'spendRecipient',
  'spendRho',
  'spendRseed',
  'alpha',
  'cmx',
  'ephemeralKey',
  'encCiphertext',
  'outCiphertext',
  'recipient',
  'rseed',
  'rcv',
  'anchor'
])
const LEDGER_BIGINT_FIELDS = new Set(['value', 'spendValue', 'valueBalance'])

function decodeLedgerWireValue(value: unknown, field?: string): unknown {
  if (
    LEDGER_BIGINT_FIELDS.has(field ?? '') &&
    (typeof value === 'number' || typeof value === 'string')
  ) {
    return BigInt(value)
  }
  if (Array.isArray(value)) {
    return LEDGER_BYTE_FIELDS.has(field ?? '')
      ? Uint8Array.from(value as number[])
      : value.map(entry => decodeLedgerWireValue(entry))
  }
  if (value && typeof value === 'object') {
    if ('__ledgerBytes' in value && typeof value.__ledgerBytes === 'string') {
      return base64ToBytes(value.__ledgerBytes)
    }
    if ('__ledgerBigInt' in value && typeof value.__ledgerBigInt === 'string') {
      return BigInt(value.__ledgerBigInt)
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decodeLedgerWireValue(entry, key)])
    )
  }
  return value
}

function toPcztTransaction(payload: LedgerSigningPayload): PcztTransaction {
  const transaction = decodeLedgerWireValue(payload.transaction)
  if (!transaction || typeof transaction !== 'object' || !('global' in transaction)) {
    throw new Error('Ledger transaction payload is invalid')
  }
  const tx = transaction as Record<string, unknown>
  const global = tx.global as Record<string, unknown>
  // serde-wasm-bindgen represents Rust `Option::None` as `undefined`, while the
  // Ledger signer wire encoder requires `null` for absent optional fields. If
  // left undefined it writes a present-field tag without the field bytes.
  global.fallbackLockTime ??= null
  // DMK SDK assumes these arrays are always present; default to [] for
  // shielded-only transactions where WASM omits the transparent bundle.
  if (!tx.transparentInputs) tx.transparentInputs = []
  if (!tx.transparentOutputs) tx.transparentOutputs = []
  if (Array.isArray(tx.transparentInputs)) {
    for (const input of tx.transparentInputs) {
      if (input && typeof input === 'object') {
        const inputRecord = input as Record<string, unknown>
        inputRecord.sequence ??= null
      }
    }
  }
  if (Array.isArray(tx.transparentOutputs)) {
    for (const output of tx.transparentOutputs) {
      if (output && typeof output === 'object') {
        const outputRecord = output as Record<string, unknown>
        outputRecord.derivation ??= null
      }
    }
  }
  return tx as unknown as PcztTransaction
}

function serializeSignatures(result: SignPcztTransactionResult): LedgerPcztSignatures {
  return {
    orchard: result.orchard.map(({ spendAuthSig }) => ({
      spendAuthSig: bytesToBase64(spendAuthSig)
    })),
    transparentInputSigs: result.transparentInputSigs.map(signature =>
      bytesToBase64(normalizeLedgerTransparentSignature(signature))
    ),
    ironwood: result.ironwood.map(({ spendAuthSig }) => ({
      spendAuthSig: bytesToBase64(spendAuthSig)
    }))
  }
}

export async function exportLedgerAccount(params: {
  transport: LedgerTransport
  network: Network
  accountIndex: number
  onInteraction?: (interaction: string) => void
  device?: DiscoveredDevice
}): Promise<LedgerAccountExport> {
  return withLedgerSigner(
    params.transport,
    async ({ signer, device, appVersion }) => {
      const viewingKey = await runAction(
        signer.getFullViewingKey(getLedgerAccountPath(params.network, params.accountIndex), {
          mode: 'ufvk'
        }),
        params.onInteraction,
        'get_full_viewing_key'
      )
      if (viewingKey.mode !== 'ufvk') {
        throw new Error('Ledger returned an unexpected viewing key format')
      }
      return {
        ufvk: viewingKey.fullViewingKey,
        deviceModel: device.deviceModel.model,
        deviceName: device.deviceModel.name,
        appVersion
      }
    },
    params.onInteraction,
    params.device
  )
}

export async function signLedgerPczt(params: {
  transport: LedgerTransport
  payload: LedgerSigningPayload
  onInteraction?: (interaction: string) => void
  device?: DiscoveredDevice
}): Promise<LedgerPcztSignatures> {
  return withLedgerSigner(
    params.transport,
    async ({ signer }) => {
      const transaction = toPcztTransaction(params.payload)
      lastLedgerCommand = undefined
      const result = await runAction(
        signer.signPcztTransaction(transaction),
        params.onInteraction,
        'sign_pczt_transaction'
      )
      return serializeSignatures(result)
    },
    params.onInteraction,
    params.device
  )
}
