import { ANALYTICS_EVENTS, PAGE_IDS, type AnalyticsEventName } from './constants.ts'
import type { TrackOptions } from './types.ts'

type SafeAnalyticsValue = string | number | boolean

type EventFieldPolicy = {
  readonly params: readonly string[]
  readonly extra: readonly string[]
}

const EVENT_FIELD_POLICIES = {
  [ANALYTICS_EVENTS.EXTENSION_INSTALLED]: { params: [], extra: [] },
  [ANALYTICS_EVENTS.EXTENSION_UPDATED]: {
    params: ['previous_version'],
    extra: []
  },
  [ANALYTICS_EVENTS.WALLET_CREATED]: {
    params: ['method'],
    extra: ['has_birthday_height']
  },
  [ANALYTICS_EVENTS.WALLET_UNLOCKED]: { params: [], extra: ['from_dapp'] },
  [ANALYTICS_EVENTS.WALLET_LOCKED]: { params: [], extra: ['reason'] },
  [ANALYTICS_EVENTS.SHOW_PAGE]: { params: [], extra: [] },
  [ANALYTICS_EVENTS.ACCOUNT_SWITCHED]: { params: [], extra: ['cross_wallet'] },
  [ANALYTICS_EVENTS.ADDRESS_COPIED]: { params: [], extra: ['address_type'] },
  [ANALYTICS_EVENTS.SEND_SUBMITTED]: {
    params: [],
    extra: ['fee_tier', 'hardware']
  },
  [ANALYTICS_EVENTS.SEND_SUCCEEDED]: {
    params: ['hardware'],
    extra: ['funding_source', 'kind']
  },
  [ANALYTICS_EVENTS.SEND_FAILED]: {
    params: [],
    extra: ['funding_source', 'kind', 'phase']
  },
  [ANALYTICS_EVENTS.SHIELD_SUCCEEDED]: { params: [], extra: [] },
  [ANALYTICS_EVENTS.SHIELD_FAILED]: { params: [], extra: [] },
  [ANALYTICS_EVENTS.SWAP_QUOTED]: { params: [], extra: ['direction'] },
  [ANALYTICS_EVENTS.SWAP_SUBMITTED]: {
    params: [],
    extra: ['direction', 'hardware']
  },
  [ANALYTICS_EVENTS.SWAP_DEPOSIT_SENT]: {
    params: ['from_token', 'to_token'],
    extra: ['direction']
  },
  [ANALYTICS_EVENTS.SWAP_FAILED]: { params: [], extra: ['direction'] },
  [ANALYTICS_EVENTS.SWAP_COMPLETED]: {
    params: [],
    extra: ['status', 'action']
  },
  [ANALYTICS_EVENTS.HW_CONNECTED]: {
    params: [],
    extra: ['is_existing_wallet']
  },
  [ANALYTICS_EVENTS.HW_SIGN_FAILED]: {
    params: [],
    extra: ['kind', 'phase']
  },
  [ANALYTICS_EVENTS.DAPP_CONNECTED]: {
    params: [],
    extra: ['account_count', 'source']
  },
  [ANALYTICS_EVENTS.DAPP_DISCONNECTED]: { params: [], extra: [] },
  [ANALYTICS_EVENTS.DAPP_REQUEST_REJECTED]: {
    params: [],
    extra: ['method']
  },
  [ANALYTICS_EVENTS.DAPP_TRANSACTION_SENT]: {
    params: [],
    extra: ['funding_source', 'hardware']
  },
  [ANALYTICS_EVENTS.DAPP_TRANSACTION_FAILED]: {
    params: [],
    extra: ['funding_source', 'hardware']
  },
  [ANALYTICS_EVENTS.DAPP_MESSAGE_SIGNED]: {
    params: [],
    extra: ['signing_mode']
  }
} as const satisfies Record<AnalyticsEventName, EventFieldPolicy>

const eventNames = new Set<string>(Object.values(ANALYTICS_EVENTS))
const pageIds = new Set<string>(Object.values(PAGE_IDS))

function isSafeValue(value: unknown): value is SafeAnalyticsValue {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value)
}

function pickAllowedFields(
  value: Record<string, unknown> | undefined,
  allowedFields: readonly string[]
): Record<string, SafeAnalyticsValue> | undefined {
  if (!value || allowedFields.length === 0) return undefined
  const allowed = new Set(allowedFields)
  const entries = Object.entries(value).filter(
    (entry): entry is [string, SafeAnalyticsValue] => allowed.has(entry[0]) && isSafeValue(entry[1])
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function sanitizeTokenLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined
}

export function sanitizeAnalyticsEvent(
  name: string,
  options: TrackOptions = {}
): { readonly name: AnalyticsEventName; readonly options: TrackOptions } | null {
  if (!eventNames.has(name)) return null

  const eventName = name as AnalyticsEventName
  const policy = EVENT_FIELD_POLICIES[eventName]
  const params = pickAllowedFields(options.params, policy.params)
  const extra = pickAllowedFields(options.extra, policy.extra)
  const pageId =
    typeof options.pageId === 'string' && pageIds.has(options.pageId)
      ? options.pageId
      : PAGE_IDS.BACKGROUND
  const inputSymbol = sanitizeTokenLabel(options.inputSymbol)
  const inputTokenCode = sanitizeTokenLabel(options.inputTokenCode)
  const outputSymbol = sanitizeTokenLabel(options.outputSymbol)
  const outputTokenCode = sanitizeTokenLabel(options.outputTokenCode)

  return {
    name: eventName,
    options: {
      pageId,
      ...(options.hasTransaction === 0 || options.hasTransaction === 1
        ? { hasTransaction: options.hasTransaction }
        : {}),
      ...(inputSymbol ? { inputSymbol } : {}),
      ...(inputTokenCode ? { inputTokenCode } : {}),
      ...(outputSymbol ? { outputSymbol } : {}),
      ...(outputTokenCode ? { outputTokenCode } : {}),
      ...(params ? { params } : {}),
      ...(extra ? { extra } : {})
    }
  }
}
