/**
 * Pure payload construction — kept free of chrome/store dependencies so it
 * can be unit-tested under Node directly.
 */

// Relative .ts imports (not `@/`) so Node-based tests can load this module directly
import { ANALYTICS_CHAIN, ANALYTICS_PROJECT_ID, PAGE_IDS } from './constants.ts'
import type { AnalyticsEventPayload, TrackOptions } from './types.ts'

const ALLOWED_METADATA_KEYS = new Set([
  'account_count',
  'address_type',
  'build_channel',
  'browser',
  'cross_wallet',
  'device_category',
  'direction',
  'engagement_time_msec',
  'event_id',
  'extension_version',
  'fee_tier',
  'from_dapp',
  'from_token',
  'funding_source',
  'hardware',
  'has_birthday_height',
  'is_existing_wallet',
  'is_mca_creation',
  'kind',
  'language',
  'link_domain',
  'link_id',
  'method',
  'network_mode',
  'operating_system',
  'page_id',
  'page_location',
  'page_title',
  'phase',
  'previous_version',
  'reason',
  'signing_mode',
  'source',
  'status',
  'to_token'
])

function isAnonymousMetadataValue(value: unknown): value is string | number | boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

function isAllowedMetadataValue(key: string, value: unknown): value is string | number | boolean {
  if (key === 'engagement_time_msec') {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 3_600_000
  }
  return isAnonymousMetadataValue(value)
}

/**
 * Keeps only bounded, non-identifying product metadata. Callers may pass richer
 * transaction context for local orchestration, but it must not cross the
 * analytics network boundary.
 */
export function sanitizeAnalyticsMetadata(
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {}
  for (const source of sources) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (ALLOWED_METADATA_KEYS.has(key) && isAllowedMetadataValue(key, value)) {
        sanitized[key] = value
      }
    }
  }
  return sanitized
}

function sanitizeSymbol(symbol?: string): string {
  return symbol && /^[A-Za-z0-9._-]{1,16}$/.test(symbol) ? symbol : ''
}

function sanitizeAmount(amount?: string): string {
  if (!amount) return ''
  const normalized = amount.trim()
  return normalized.length <= 128 && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized) ? normalized : ''
}

export function buildPayload(
  name: string,
  options: TrackOptions,
  timestamp?: number
): AnalyticsEventPayload {
  const extra = sanitizeAnalyticsMetadata(options.params, options.extra)
  return {
    chain: ANALYTICS_CHAIN,
    event_name: name,
    extra: Object.keys(extra).length > 0 ? JSON.stringify(extra) : '',
    has_transaction: options.hasTransaction ?? 0,
    input_amount: sanitizeAmount(options.inputAmount),
    input_symbol: sanitizeSymbol(options.inputSymbol),
    input_token_code: '',
    output_amount: sanitizeAmount(options.outputAmount),
    output_symbol: sanitizeSymbol(options.outputSymbol),
    output_token_code: '',
    page_id: options.pageId ?? PAGE_IDS.BACKGROUND,
    project_id: ANALYTICS_PROJECT_ID,
    timestamp: timestamp ?? Date.now(),
    usd_amount: sanitizeAmount(options.usdAmount),
    wallet_address: ''
  }
}
