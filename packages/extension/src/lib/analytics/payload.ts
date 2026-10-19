/**
 * Pure payload construction — kept free of chrome/store dependencies so it
 * can be unit-tested under Node directly.
 */

// Relative .ts imports (not `@/`) so Node-based tests can load this module directly
import {
  ANALYTICS_CHAIN,
  ANALYTICS_PROJECT_ID,
  PAGE_IDS,
  resolveAnalyticsChain
} from './constants.ts'
import type { AnalyticsEventPayload, TrackOptions } from './types.ts'

const ALLOWED_METADATA_KEYS = new Set([
  'browser',
  'device_category',
  'language',
  'operating_system',
  'event_id',
  'extension_version',
  'build_channel',
  'network_mode',
  'chain',
  'engagement_time_msec',
  'page_id',
  'action',
  'sourceFamily',
  'account_count',
  'direction',
  'fee_tier',
  'from_dapp',
  'from_token',
  'funding_source',
  'hardware',
  'has_birthday_height',
  'is_existing_wallet',
  'is_mca_creation',
  'kind',
  'method',
  'page_location',
  'page_title',
  'phase',
  'previous_version',
  'signing_mode',
  'source',
  'status',
  'to_token'
])
const KNOWN_PAGE_IDS = new Set<string>(Object.values(PAGE_IDS))
const KNOWN_PAGE_LOCATIONS = new Set(
  Object.values(PAGE_IDS).map(pageId => `https://noir-wallet.extension/${pageId}`)
)

function isAnonymousMetadataValue(value: unknown): value is string | number | boolean {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

function isAllowedMetadataValue(key: string, value: unknown): value is string | number | boolean {
  if (key === 'page_location') {
    return typeof value === 'string' && KNOWN_PAGE_LOCATIONS.has(value)
  }
  if (key === 'page_id' || key === 'page_title') {
    return typeof value === 'string' && KNOWN_PAGE_IDS.has(value)
  }
  if (!isAnonymousMetadataValue(value)) return false
  return (key !== 'chain' && key !== 'sourceFamily') || resolveAnalyticsChain(value) !== undefined
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

export function buildPayload(
  name: string,
  options: TrackOptions,
  timestamp?: number
): AnalyticsEventPayload {
  const extra = sanitizeAnalyticsMetadata(options.params, options.extra)
  return {
    chain: resolveAnalyticsChain(options.chain) ?? ANALYTICS_CHAIN,
    event_name: name,
    extra: Object.keys(extra).length > 0 ? JSON.stringify(extra) : '',
    has_transaction: options.hasTransaction ?? 0,
    input_amount: '',
    input_symbol: sanitizeSymbol(options.inputSymbol),
    input_token_code: '',
    output_amount: '',
    output_symbol: sanitizeSymbol(options.outputSymbol),
    output_token_code: '',
    page_id: options.pageId ?? PAGE_IDS.BACKGROUND,
    project_id: ANALYTICS_PROJECT_ID,
    timestamp: timestamp ?? Date.now(),
    usd_amount: '',
    wallet_address: ''
  }
}
