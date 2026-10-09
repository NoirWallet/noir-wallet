import { DEFAULT_FEE_TIER, MARGINAL_FEE_ZATS, type FeeTier } from '@/config/fee'

/** Typical logical action count for a 1-in/1-out shielded transfer. */
const TYPICAL_ACTIONS = 3
const ALLOWED_MARGINAL_FEES: ReadonlySet<number> = new Set(Object.values(MARGINAL_FEE_ZATS))

export function marginalFeeForTier(tier: FeeTier): number {
  return MARGINAL_FEE_ZATS[tier] ?? MARGINAL_FEE_ZATS[DEFAULT_FEE_TIER]
}

/** Bounds inbound fees before they reach WASM. */
export function sanitizeMarginalFeeZats(value: number | undefined): number {
  return value != null && ALLOWED_MARGINAL_FEES.has(value)
    ? value
    : MARGINAL_FEE_ZATS[DEFAULT_FEE_TIER]
}

/** Coarse fee estimate (zatoshis) used before live estimation resolves. */
export function staticFeeFallbackZats(tier: FeeTier): number {
  return marginalFeeForTier(tier) * TYPICAL_ACTIONS
}

/** Scale a Standard estimate across tiers without re-running WASM. */
export function deriveFeeByTier(
  standardZats: number | null,
  hasError: boolean
): Record<FeeTier, number | null> {
  const compute = (target: FeeTier): number | null => {
    if (standardZats != null) {
      return Math.round(standardZats * (MARGINAL_FEE_ZATS[target] / MARGINAL_FEE_ZATS.standard))
    }
    return hasError ? staticFeeFallbackZats(target) : null
  }
  return { standard: compute('standard'), fast: compute('fast') }
}

/** Derive all tiers when the live estimate was built with an arbitrary source tier. */
export function deriveFeeByTierFromEstimate(
  feeZats: number | null,
  sourceTier: FeeTier,
  hasError: boolean
): Record<FeeTier, number | null> {
  const standardZats =
    feeZats == null
      ? null
      : Math.round(feeZats * (MARGINAL_FEE_ZATS.standard / MARGINAL_FEE_ZATS[sourceTier]))
  return deriveFeeByTier(standardZats, hasError)
}
