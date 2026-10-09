import { Icon } from '@iconify/react'
import { DetailRow } from '../common/DetailRow'
import { FeeTierSelector } from './FeeTierSelector'
import { getFeeTierLabel, staticFeeFallbackZats, type FeeTier } from '@/config/fee'
import { openModal } from '../../provider/ModalManager'
import { safeBig } from '@/lib/big'

interface FeeTierPickerProps {
  tier: FeeTier
  onTierChange: (tier: FeeTier) => void
  /** Estimated fee per tier (zatoshis); null while pending. */
  feeByTier: Record<FeeTier, number | null>
  loading?: boolean
  /**
   * `inline` (default): DetailRow shape (label left, value right). Pair with an
   * existing card wrapper or other inline rows (Swap, Supply, Shield).
   *
   * `stacked`: label-on-top form-field shape with a full-width 54px trigger,
   * matching the `Send To` input row in Send.tsx.
   */
  variant?: 'inline' | 'stacked'
  /**
   * Drop the "Network Fee" label for callers that already render their own
   * section header (e.g. ApprovalPage's icon + h3 row). Only honoured in the
   * inline variant; stacked relies on the built-in label for form alignment.
   */
  hideLabel?: boolean
}

/**
 * Compact, single-line "Network Fee" picker that mirrors the slippage trigger
 * pattern: shows the current tier + live fee, and opens a bottom sheet for
 * tier switching so the input view stays uncluttered.
 *
 * When no estimate is in flight (e.g. amount not yet entered) both trigger and
 * sheet substitute the ZIP-317 static fallback so nothing renders as "—".
 * While a live estimate is loading we keep the nulls intact in the sheet so
 * the cards show the "…" spinner instead of stale fallback figures; the
 * trigger keeps the last known fallback to avoid layout flicker.
 */
export function FeeTierPicker({
  tier,
  onTierChange,
  feeByTier,
  loading,
  variant = 'inline',
  hideLabel
}: FeeTierPickerProps) {
  const selectedFeeZats = feeByTier[tier] ?? staticFeeFallbackZats(tier)
  const selectedFeeZec = safeBig(selectedFeeZats).div(1e8).toFixed()

  // Estimate is "approximate" when no live value is in flight or resolved —
  // i.e. the upstream feeEstimate hasn't been enabled yet (e.g. swap before a
  // quote, send before a recipient). In that case the trigger and sheet show
  // ZIP-317 static fallbacks; surface a hint in the sheet so users don't
  // mistake the static number for the live network estimate.
  const isApproximate = !loading && feeByTier.standard === null && feeByTier.fast === null

  const sheetFeeByTier: Record<FeeTier, number | null> = loading
    ? feeByTier
    : {
        standard: feeByTier.standard ?? staticFeeFallbackZats('standard'),
        fast: feeByTier.fast ?? staticFeeFallbackZats('fast')
      }

  const handleEdit = () => {
    void openModal({
      title: 'Network Fee',
      showCloseButton: true,
      body: (_resolve, close) => (
        <FeeTierEditContent
          selectedTier={tier}
          feeByTier={sheetFeeByTier}
          loading={loading}
          isApproximate={isApproximate}
          onSelect={t => {
            onTierChange(t)
            close()
          }}
        />
      )
    })
  }

  const trailingIcon = loading ? (
    <Icon icon="lucide:loader-2" className="text-muted animate-spin" />
  ) : (
    <Icon icon="lucide:pencil" className="text-muted" />
  )

  if (variant === 'stacked') {
    return (
      <div>
        <label className="block text-sm text-muted mb-2">Network Fee</label>
        <button
          type="button"
          onClick={handleEdit}
          className="w-full h-[54px] bg-card rounded-xl px-4 flex items-center justify-between hover:opacity-90 transition-opacity"
        >
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm">≈ {selectedFeeZec} ZEC</span>
            <span className="text-xs text-muted">({getFeeTierLabel(tier)})</span>
          </span>
          <span className="size-3.5 inline-flex items-center justify-center [&_svg]:size-3.5">
            {trailingIcon}
          </span>
        </button>
      </div>
    )
  }

  const inlineTrigger = (
    <button
      type="button"
      onClick={handleEdit}
      className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
    >
      <span className="text-sm">≈ {selectedFeeZec} ZEC</span>
      <span className="text-xs text-muted">({getFeeTierLabel(tier)})</span>
      <span className="size-3 inline-flex items-center justify-center [&_svg]:size-3">
        {trailingIcon}
      </span>
    </button>
  )

  if (hideLabel) return inlineTrigger

  return <DetailRow label="Network Fee">{inlineTrigger}</DetailRow>
}

function FeeTierEditContent({
  selectedTier,
  feeByTier,
  loading,
  isApproximate,
  onSelect
}: {
  selectedTier: FeeTier
  feeByTier: Record<FeeTier, number | null>
  loading?: boolean
  isApproximate?: boolean
  onSelect: (tier: FeeTier) => void
}) {
  return (
    <div className="pt-1 pb-4 space-y-3">
      <FeeTierSelector
        value={selectedTier}
        onChange={onSelect}
        feeByTier={feeByTier}
        loading={loading}
        hideLabel
      />
      {isApproximate && (
        <p className="text-xs text-muted leading-relaxed">
          Approximate ZIP-317 estimate. Live fee resolves once the recipient is set.
        </p>
      )}
    </div>
  )
}
