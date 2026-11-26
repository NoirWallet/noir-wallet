import { isValidZcashBirthdayHeight } from '@/core/wallet/birthday-height'
import { getResponseErrorMessage } from '@/lib/errors'
import { normalizeTxHash } from '@/lib/tx-history-dedup'

type ZcashRecoveryScope = { readonly walletId: string; readonly accountId: string }

export type ZcashTransactionRescanResult = {
  readonly status: 'already-present' | 'restored' | 'pending' | 'not-found' | 'unavailable'
  readonly transactionId?: string
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parseZcashRecoveryTxid(value: string): string | null {
  const txid = normalizeTxHash(value)
  return /^[0-9a-f]{64}$/.test(txid) ? txid : null
}

export async function supportsZcashRecovery(): Promise<boolean> {
  try {
    const response = responseRecord(
      await chrome.runtime.sendMessage({
        type: 'GET_BACKGROUND_INITIALIZATION_STATE',
        includeZcashRecovery: true
      })
    )
    return response?.zcashRecoverySupported === true
  } catch {
    return false
  }
}

async function sendRecoveryRequest(
  type: 'RESCAN_ZCASH_TRANSACTION' | 'RESCAN_ZCASH_RANGE',
  payload: ZcashRecoveryScope &
    ({ readonly txid: string } | { readonly startHeight: number; readonly endHeight: number }),
  fallback: string
): Promise<Record<string, unknown>> {
  const response = responseRecord(await chrome.runtime.sendMessage({ type, ...payload }))
  const data = responseRecord(response?.data)
  if (response?.success === true && data) return data
  throw new Error(getResponseErrorMessage(response) ?? fallback)
}

export async function rescanZcashTransaction(
  input: ZcashRecoveryScope & { readonly txid: string }
): Promise<ZcashTransactionRescanResult> {
  const { status, transactionId } = await sendRecoveryRequest(
    'RESCAN_ZCASH_TRANSACTION',
    input,
    'Could not scan for the Zcash transaction.'
  )
  if (
    status !== 'already-present' &&
    status !== 'restored' &&
    status !== 'pending' &&
    status !== 'not-found' &&
    status !== 'unavailable'
  ) {
    throw new Error('Zcash transaction scan returned an unknown status.')
  }

  return {
    status,
    ...(typeof transactionId === 'string' && transactionId.trim() ? { transactionId } : {})
  }
}

export async function rescanZcashRange(
  input: ZcashRecoveryScope & { readonly startHeight: number; readonly endHeight: number }
): Promise<number> {
  const { checkedThrough } = await sendRecoveryRequest(
    'RESCAN_ZCASH_RANGE',
    input,
    'Could not scan the Zcash block range.'
  )
  if (
    !isValidZcashBirthdayHeight(checkedThrough) ||
    checkedThrough < input.startHeight ||
    checkedThrough > input.endHeight
  ) {
    throw new Error('Zcash range scan returned an invalid block height.')
  }
  return checkedThrough
}

export async function resyncZcashWallet(input: {
  readonly walletId: string
  readonly accountId: string
  readonly birthdayHeight: number
}): Promise<void> {
  const response = responseRecord(
    await chrome.runtime.sendMessage({
      type: 'RESYNC_ZCASH_WALLET',
      walletId: input.walletId,
      accountId: input.accountId,
      birthdayHeight: input.birthdayHeight
    })
  )
  if (response?.success === true) return
  throw new Error(getResponseErrorMessage(response) ?? 'Zcash resync could not be started')
}
