import type { AddressType } from '../types/wallet'

/** Returns whether the recipient is a mainnet or testnet transparent address. */
export function isTransparentZcashAddress(recipient: string): boolean {
  return /^(?:t(?:[123]|m)|tex1|textest1)/.test(recipient)
}

/** Classifies recognized mainnet and testnet Zcash address prefixes for display. */
export function detectZcashAddressType(address: string): AddressType {
  return /^(?:u1|utest1|zs|ztestsapling)/.test(address) ? 'shielded' : 'transparent'
}

/**
 * Returns a memo only when the recipient can carry one under ZIP-321.
 * Transparent Zcash outputs cannot contain memos.
 */
export function sanitizeMemoForRecipient(recipient: string, memo?: string): string | undefined {
  if (!memo) return undefined
  return isTransparentZcashAddress(recipient) ? undefined : memo
}
