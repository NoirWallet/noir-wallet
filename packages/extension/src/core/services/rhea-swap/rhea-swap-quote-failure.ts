import { getRheaSwapMinimumAmountMessage, RheaSwapHttpError } from './rhea-swap-error'

const MAXIMUM_QUOTE_ERROR_BYTES = 64 * 1024
const PROVIDER_TIMEOUT = /\b(?:timed? out|timeout|deadline exceeded)\b/i
const PROVIDER_NO_ROUTE =
  /\b(?:unsupported (?:source|destination) chain|route does not support this chain pair|no (?:supported |swap )?route(?: found)?|no liquidity)\.?$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readQuoteFailure(value: unknown, depth = 0): 'timeout' | 'no-route' | null {
  if (depth >= 4 || !isRecord(value)) return null
  let failure: 'timeout' | 'no-route' | null = null
  for (const key of ['code', 'errorCode', 'reason']) {
    const code = typeof value[key] === 'string' ? value[key].trim().toLowerCase() : ''
    if (code === 'quote_timeout' || code === 'request_timeout') return 'timeout'
    if (
      code === 'route_not_found' ||
      code === 'route_unavailable' ||
      code === 'confidential_route_unavailable' ||
      code === 'no_route'
    ) {
      failure = 'no-route'
    }
  }
  for (const key of ['data', 'error']) {
    const nested = readQuoteFailure(value[key], depth + 1)
    if (nested === 'timeout') return nested
    failure ??= nested
  }
  return failure
}

function readAggregateQuoteFailure(
  payload: Record<string, unknown>
): 'timeout' | 'no-route' | null {
  const errors = isRecord(payload.data) ? payload.data.errors : undefined
  if (!Array.isArray(errors) || errors.length === 0) return null
  if (errors.some(error => typeof error === 'string' && PROVIDER_TIMEOUT.test(error))) {
    return 'timeout'
  }
  return errors.every(error => typeof error === 'string' && PROVIDER_NO_ROUTE.test(error))
    ? 'no-route'
    : null
}

/** Preserve the provider's fixed quote failure categories without exposing its payload. */
export function classifyRheaQuoteFailure(
  payload: unknown,
  status: number,
  byteLength: number
): RheaSwapHttpError | undefined {
  if (
    byteLength > MAXIMUM_QUOTE_ERROR_BYTES ||
    status === 401 ||
    status === 403 ||
    status === 429 ||
    !isRecord(payload) ||
    typeof payload.code !== 'number' ||
    payload.code === 0 ||
    (typeof payload.msg === 'string' && getRheaSwapMinimumAmountMessage(payload.msg))
  ) {
    return undefined
  }
  const failure = readQuoteFailure(payload) ?? readAggregateQuoteFailure(payload)
  if (!failure) return undefined
  return new RheaSwapHttpError(
    failure === 'timeout' ? 'REQUEST_TIMEOUT' : 'ROUTE_NOT_FOUND',
    'quote',
    failure === 'timeout' ? 'quote_timeout' : 'no route',
    failure === 'timeout'
  )
}
