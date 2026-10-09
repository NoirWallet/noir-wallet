import type { KeySource } from '@/types'

/**
 * ZEC Omni / Intents asset ids (match multichain token list for zec). Not on `config_near`.
 */
export const ZEC_NEAR_TOKEN_ID = 'zec.omft.near'
export const ZEC_ZCASH_ASSET = 'nep141:zec.omft.near'
export const ZEC_NEAR_ASSET = '1cs_v1:near:nep141:zec.omft.near'

/** Native NEAR (wrapped) intents asset — the canonical default swap-to token. */
export const WNEAR_NEAR_ASSET = 'nep141:wrap.near'

/**
 * Intents app fee entry. `fee` is in basis points (100 = 1%).
 * Note: 1Click applies a 50/50 revenue share by default, so half of `fee`
 * reaches the recipient and half goes to the 1Click protocol.
 */
export interface IntentsAppFee {
  recipient: string
  fee: number
}

/** Swap app fee: 0.35% (35 bps), collected to noir's swap account. */
export const NOIR_SWAP_APP_FEES: IntentsAppFee[] = [{ recipient: 'noir_swap.near', fee: 35 }]

export const NOIR_SWAP_REFERRAL = 'noir_swap'
export const NOIR_SWAP_LEDGER_REFERRAL = 'noir_swap_ledger'
export const NOIR_SWAP_KEYSTONE_REFERRAL = 'noir_swap_keystore'

export function getNoirSwapReferral(keySource?: KeySource): string {
  if (keySource === 'ledger') return NOIR_SWAP_LEDGER_REFERRAL
  if (keySource === 'keystone') return NOIR_SWAP_KEYSTONE_REFERRAL
  return NOIR_SWAP_REFERRAL
}

/** Lending app fee disabled for now (0 bps); recipient prewired for easy enablement. */
export const NOIR_LENDING_APP_FEES: IntentsAppFee[] = [{ recipient: 'noir_lending.near', fee: 0 }]
