/**
 * Dynamic fee tiers for Zcash sends/shields.
 *
 * Zcash has no continuous fee market like Bitcoin. The only lever is the
 * ZIP-317 per-action marginal fee. "Standard" is the protocol baseline
 * (5,000 zat/action); "Fast" pays 4x to incentivize prompt inclusion under
 * congestion, per the Shielded Labs dynamic-fee proposal. Going below the
 * standard fee risks the transaction not being relayed or mined, so no
 * cheaper tier is offered.
 */
export type FeeTier = 'standard' | 'fast'

/** ZIP-317 marginal fee per logical action, in zatoshis, keyed by tier. */
export const MARGINAL_FEE_ZATS: Record<FeeTier, number> = {
  standard: 5_000,
  fast: 20_000
}

export const DEFAULT_FEE_TIER: FeeTier = 'standard'

/**
 * Expiry delta (blocks) for one-click sends/shields.
 *
 * A short expiry makes a transaction "land fast or fail fast": if not mined
 * within this many blocks it is evicted from the mempool (ZIP-203) instead of
 * lingering ~50 minutes under librustzcash's 40-block default.
 *
 * The floor is set by zcashd's DoS guard, not by block spacing: AcceptToMemoryPool
 * rejects "expiring soon" txs whose expiry is within TX_EXPIRING_SOON_THRESHOLD (3)
 * blocks of the next block. librustzcash builds expiry as (chain_tip + 1) + delta,
 * so the node only accepts delta >= 3, and anything lower is refused at broadcast
 * with "tx-expiring-soon". We use 5 to keep a 2-block margin in case a block is
 * mined between build and submit, while still failing fast (~6 min at 75s spacing;
 * ~2 min once NU7/ZIP-218 drops spacing to 25s).
 */
export const DEFAULT_EXPIRY_DELTA_BLOCKS = 5

/** Typical logical action count for a 1-in/1-out shielded transfer. */
const TYPICAL_ACTIONS = 3

export interface FeeTierMeta {
  id: FeeTier
  label: string
  /** Marginal-fee multiple of the ZIP-317 baseline. */
  multiplier: number
  /** Short delivery hint shown under the tier label. */
  etaHint: string
  /** Iconify name used as the tier's leading glyph. */
  icon: string
}

export const FEE_TIERS: readonly FeeTierMeta[] = [
  { id: 'standard', label: 'Standard', multiplier: 1, etaHint: '~2 min', icon: 'lucide:clock' },
  { id: 'fast', label: 'Fast', multiplier: 4, etaHint: 'Priority', icon: 'lucide:zap' }
]

export function marginalFeeForTier(tier: FeeTier): number {
  return MARGINAL_FEE_ZATS[tier] ?? MARGINAL_FEE_ZATS[DEFAULT_FEE_TIER]
}

/** Human-readable tier name (e.g. "Standard", "Fast"). */
export function getFeeTierLabel(tier: FeeTier): string {
  return (FEE_TIERS.find(t => t.id === tier) ?? FEE_TIERS[0]).label
}

const ALLOWED_MARGINAL_FEES: ReadonlySet<number> = new Set(Object.values(MARGINAL_FEE_ZATS))

/**
 * Snap an inbound marginal fee to a recognized tier, defaulting to Standard.
 *
 * Defense-in-depth choke point before the value reaches WASM: bounds the fee to
 * the known tier set so a malformed or forged request can never spend an
 * arbitrary amount on fees.
 */
export function sanitizeMarginalFeeZats(value: number | undefined): number {
  return value != null && ALLOWED_MARGINAL_FEES.has(value)
    ? value
    : MARGINAL_FEE_ZATS[DEFAULT_FEE_TIER]
}

/** Coarse fee estimate (zatoshis) used before live estimation resolves. */
export function staticFeeFallbackZats(tier: FeeTier): number {
  return marginalFeeForTier(tier) * TYPICAL_ACTIONS
}

/**
 * Derive every tier's fee from a single Standard-tier estimate.
 *
 * ZIP-317 fees scale linearly with the marginal fee while the action count stays
 * fixed, so one Standard estimate maps onto all tiers without re-running WASM on
 * tier switch. Returns `null` per tier while the estimate is pending; falls back
 * to static figures when it errored.
 */
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
