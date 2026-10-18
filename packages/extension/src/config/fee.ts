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
 * The baseline keeps a transaction "land fast or fail fast" when the wallet
 * is current. One-click builders extend it by the gap between the wallet's
 * chain tip and the live node tip, up to the 40-block default.
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

interface FeeTierMeta {
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

/** Human-readable tier name (e.g. "Standard", "Fast"). */
export function getFeeTierLabel(tier: FeeTier): string {
  return (FEE_TIERS.find(t => t.id === tier) ?? FEE_TIERS[0]).label
}
