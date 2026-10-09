import type { MnemonicWordCount } from '@/config/wallet'

type SoftwareWalletProvisioningMode = 'create' | 'import'

function responseRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function responseError(record: Record<string, unknown> | null, fallback: string): Error {
  return new Error(record && typeof record.error === 'string' ? record.error : fallback)
}

export async function generateAddWalletMnemonic(wordCount: MnemonicWordCount): Promise<string[]> {
  const record = responseRecord(
    await chrome.runtime.sendMessage({ type: 'GENERATE_ADD_WALLET_MNEMONIC', wordCount })
  )
  if (record?.success !== true || typeof record.mnemonic !== 'string') {
    throw responseError(record, 'Recovery phrase generation failed')
  }
  const words = record.mnemonic.split(' ')
  if (words.length !== wordCount) {
    throw new Error('Secure module returned an unexpected recovery phrase length')
  }
  return words
}

export async function provisionAdditionalSoftwareWallet(input: {
  readonly mode: SoftwareWalletProvisioningMode
  readonly mnemonic: string
  readonly accountName: string
  readonly birthdayHeight?: number
}): Promise<string> {
  const record = responseRecord(
    await chrome.runtime.sendMessage({
      type: 'ADD_SOFTWARE_WALLET',
      mode: input.mode,
      mnemonic: input.mnemonic,
      accountName: input.accountName,
      ...(input.birthdayHeight === undefined ? {} : { birthdayHeight: input.birthdayHeight })
    })
  )
  if (record?.success !== true || typeof record.walletId !== 'string') {
    throw responseError(record, 'Wallet setup failed')
  }
  return record.walletId
}
