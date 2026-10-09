import * as crossChainSdk from '@rhea-finance/cross-chain-sdk'
import { NOIR_LENDING_APP_FEES } from '@/config/near'

export type LendingSdkEnv = 'stg' | 'prd'

/** Referral tag attached to lending intents quotes (kept distinct from swap). */
const LENDING_REFERRAL = 'noir_lending'

// `setIntentsQuoteConfig` is exposed by SDK >= 0.1.19 (unified referral + app
// fees); the optional intersection keeps this forward-compatible with the
// currently pinned build.
const sdk = crossChainSdk as typeof crossChainSdk & {
  setIntentsQuoteConfig?: (config: {
    referral?: string
    appFees?: { recipient: string; fee: number }[]
  }) => void
}

export function applyLendingSdkEnv(env: LendingSdkEnv) {
  try {
    sdk.setSdkEnv(env)
    sdk.setIntentsQuoteConfig?.({
      referral: LENDING_REFERRAL,
      appFees: NOIR_LENDING_APP_FEES
    })
  } catch {
    // SDK init may fail in Service Worker context
  }
}

// Lending is pinned to production backends; the staging toggle has been removed.
applyLendingSdkEnv('prd')
