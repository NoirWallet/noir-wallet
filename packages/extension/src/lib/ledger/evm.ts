import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum'
import { GetAppAndVersionCommand } from '@ledgerhq/device-management-kit'
import { hexToBytes, isAddress, keccak256, type Hex } from 'viem'
import type {
  LedgerEvmSigningRequest,
  LedgerEvmSigningResponse
} from '@/core/keyring/protocol/ledger-signing'
import {
  getLedgerDeviceName,
  runLedgerAction,
  withLedgerSession,
  type LedgerTransport
} from './device'

export interface LedgerEvmAccountExport {
  readonly derivationPath: string
  readonly publicKey: string
  readonly address: string
  readonly deviceModel: string
  readonly deviceName: string
  readonly appVersion: string
}

export type {
  LedgerEvmSigningRequest,
  LedgerEvmSigningResponse
} from '@/core/keyring/protocol/ledger-signing'

interface LedgerEvmDeviceOptions {
  readonly transport: LedgerTransport
  readonly signal?: AbortSignal
  readonly onInteraction?: (interaction: string) => void
}

function normalizePath(path: string): string {
  const match = /^m\/44'\/60'\/((?:0|[1-9][0-9]*))'\/0\/((?:0|[1-9][0-9]*))$/.exec(path)
  if (!match || match.slice(1).some(component => Number(component) > 0x7fffffff)) {
    throw new Error('Unsupported Ledger EVM derivation path')
  }
  return path.slice(2)
}

function formatSignature(
  signature: { readonly r: string; readonly s: string; readonly v: number },
  kind: LedgerEvmSigningRequest['kind']
): string {
  const r = signature.r.toLowerCase()
  const s = signature.s.toLowerCase()
  const parity = signature.v >= 27 ? signature.v - 27 : signature.v
  if (
    !/^0x[0-9a-f]{64}$/.test(r) ||
    !/^0x[0-9a-f]{64}$/.test(s) ||
    (parity !== 0 && parity !== 1)
  ) {
    throw new Error('Ledger returned an invalid EVM signature')
  }
  const recovery = kind === 'transaction' ? parity : parity + 27
  return `${r}${s.slice(2)}${recovery.toString(16).padStart(2, '0')}`
}

export async function exportLedgerEvmAccount(
  input: LedgerEvmDeviceOptions & {
    readonly accountIndex: number
    readonly derivationPath?: string
  }
): Promise<LedgerEvmAccountExport> {
  if (
    !Number.isSafeInteger(input.accountIndex) ||
    input.accountIndex < 0 ||
    input.accountIndex > 0x7fffffff
  ) {
    throw new Error('Invalid Ledger EVM account index')
  }
  const derivationPath = input.derivationPath ?? `m/44'/60'/0'/0/${input.accountIndex}`
  const path = normalizePath(derivationPath)
  return withLedgerSession(input, async ({ dmk, sessionId, device }) => {
    const signer = new SignerEthBuilder({ dmk, sessionId }).build()
    const account = await runLedgerAction(
      signer.getAddress(path, { checkOnDevice: true }),
      input.onInteraction,
      'evm_get_address',
      input.signal
    )
    if (!isAddress(account.address) || !/^(?:0x)?04[0-9a-fA-F]{128}$/.test(account.publicKey)) {
      throw new Error('Ledger returned an invalid EVM account')
    }
    const rawPublicKey = account.publicKey.replace(/^0x/, '')
    const derivedAddress = `0x${keccak256(`0x${rawPublicKey.slice(2)}` as Hex).slice(-40)}`
    if (derivedAddress.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Ledger EVM public key does not match its address')
    }
    const app = await dmk.sendCommand({ sessionId, command: new GetAppAndVersionCommand() })
    return Object.freeze({
      derivationPath,
      publicKey: account.publicKey.startsWith('0x') ? account.publicKey : `0x${account.publicKey}`,
      address: account.address.toLowerCase(),
      deviceModel: device.deviceModel.model,
      deviceName: getLedgerDeviceName(device.deviceModel.model, device.name),
      appVersion: app.status === 'SUCCESS' ? app.data.version : 'unknown'
    })
  })
}

export async function signLedgerEvmRequest(
  request: LedgerEvmSigningRequest,
  options: LedgerEvmDeviceOptions
): Promise<LedgerEvmSigningResponse> {
  const path = normalizePath(request.derivationPath)
  if (!isAddress(request.expectedAddress)) throw new Error('Invalid Ledger EVM account address')
  return withLedgerSession(options, async ({ dmk, sessionId }) => {
    const signer = new SignerEthBuilder({ dmk, sessionId }).build()
    const account = await runLedgerAction(
      signer.getAddress(path),
      options.onInteraction,
      'evm_verify_address',
      options.signal
    )
    if (account.address.toLowerCase() !== request.expectedAddress.toLowerCase()) {
      throw new Error('Connected Ledger does not match the approved EVM account')
    }
    let signature: { readonly r: string; readonly s: string; readonly v: number }
    if (request.kind === 'transaction') {
      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(request.unsignedTransactionHex)) {
        throw new Error('Invalid Ledger EVM unsigned transaction')
      }
      signature = await runLedgerAction(
        signer.signTransaction(path, hexToBytes(request.unsignedTransactionHex as Hex)),
        options.onInteraction,
        'evm_sign_transaction',
        options.signal
      )
    } else if (request.kind === 'personal-sign') {
      if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(request.messageHex)) {
        throw new Error('Invalid Ledger EVM message')
      }
      signature = await runLedgerAction(
        signer.signMessage(path, hexToBytes(request.messageHex as Hex)),
        options.onInteraction,
        'evm_sign_message',
        options.signal
      )
    } else {
      signature = await runLedgerAction(
        signer.signTypedData(
          path,
          request.typedData as unknown as Parameters<typeof signer.signTypedData>[1]
        ),
        options.onInteraction,
        'evm_sign_typed_data',
        options.signal
      )
    }
    return Object.freeze({ signatureHex: formatSignature(signature, request.kind) })
  })
}
