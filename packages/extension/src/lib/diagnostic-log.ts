export const DIAGNOSTIC_LOG_MAX_ENTRIES = 500
export const DIAGNOSTIC_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const DIAGNOSTIC_LOG_MAX_ENTRY_BYTES = 2 * 1024
export const DIAGNOSTIC_LOG_MAX_TOTAL_BYTES = 512 * 1024

export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type DiagnosticLogSource = 'background' | 'popup' | 'offscreen' | 'worker'

export interface DiagnosticLogDraft {
  source: DiagnosticLogSource
  level: DiagnosticLogLevel
  message: string
  timestamp: number
  sequence: number
}

export interface DiagnosticLogEntry extends DiagnosticLogDraft {
  id?: number
  byteSize: number
}

const encoder = new TextEncoder()
const SECRET_KEY =
  /mnemonic|seed|password|passphrase|private.?key|spending.?key|viewing.?key|secret|credential|signature|memo|token|auth/i
const PRIVATE_KEY = /amount|balance|value|fee|price|usd/i
const IDENTIFIER_KEY =
  /address|wallet.?id|account.?id|transaction.?id|tx.?hash|txid|request.?id|origin|domain|hostname|endpoint/i

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength
}

export function truncateDiagnosticText(value: string, maxBytes: number): string {
  if (utf8Length(value) <= maxBytes) return value
  const suffix = '...[Truncated]'
  const bytes = encoder.encode(value)
  let end = Math.max(0, maxBytes - utf8Length(suffix))
  let prefix = new TextDecoder().decode(bytes.slice(0, end))
  while (utf8Length(prefix) > maxBytes - utf8Length(suffix)) {
    end -= 1
    prefix = new TextDecoder().decode(bytes.slice(0, end))
  }
  return `${prefix}${suffix}`
}

function redactText(input: string): string {
  const redacted = input
    .replace(
      /["']?\b(seed(?:\s*phrase)?|mnemonic)\b["']?\s*[:=]\s*["']?((?:[a-z]{2,}\s+){11,23}[a-z]{2,})["']?/gi,
      '$1=[Recovery phrase redacted]'
    )
    .replace(
      /["']?\b(seed(?:\s*phrase)?|mnemonic|password|passphrase|private\s*key|spending\s*key|viewing\s*key|credential|signature|memo|auth(?:orization)?\s*token|access\s*token|refresh\s*token)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi,
      '$1=[Redacted]'
    )
    .replace(
      /["']?\b(amount|balance|fee|price|value|usd(?:\s*value)?|transparent|shielded|sapling|orchard|spendable|available|pending|total)(?:\s+balance)?\b["']?\s*[:=]\s*["']?-?\d+(?:\.\d+)?/gi,
      '$1=[Redacted]'
    )
    .replace(
      /["']?\b(address|walletId|accountId|transactionId|txHash|txid|requestId|origin|domain|hostname|endpoint)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi,
      '$1=[Redacted identifier]'
    )
    .replace(/-?\d+(?:\.\d+)?\s*(?:ZEC|zatoshis?|USD)\b/gi, '[Redacted amount]')
    .replace(/\b(?:https?|wss?):\/\/[^\s)\]}>,]+/gi, '[URL]')
    .replace(
      /\b(?:u1|utest1|zs1|ztestsapling1|t1|t2|t3|tm)[a-zA-Z0-9]{28,}\b/g,
      '[Redacted address]'
    )
    .replace(/\b(?:bc1|tb1|bcrt1)[a-z0-9]{25,90}\b/gi, '[Redacted address]')
    .replace(/\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, '[Redacted address]')
    .replace(/\b0x[0-9a-fA-F]{40,}\b/g, '[Redacted identifier]')
    .replace(/\b[a-z0-9_-]{2,64}\.(?:near|testnet)\b/gi, '[Redacted address]')
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, '[Redacted address]')
    .replace(/\b[0-9a-fA-F]{64}\b/g, '[Redacted identifier]')
    .replace(
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
      '[Redacted identifier]'
    )
  return /^(?:[a-z]{2,}\s+){11,23}[a-z]{2,}$/i.test(redacted.trim())
    ? '[Recovery phrase redacted]'
    : redacted
}

function serialize(value: unknown, depth = 0, key = ''): unknown {
  if (SECRET_KEY.test(key) || PRIVATE_KEY.test(key)) return '[Redacted]'
  if (IDENTIFIER_KEY.test(key)) return '[Redacted identifier]'
  if (depth >= 4) return '[MaxDepth]'
  if (typeof value === 'string') return redactText(value)
  if (typeof value === 'number') return PRIVATE_KEY.test(key) ? '[Redacted]' : value
  if (typeof value === 'bigint') return '[Redacted]'
  if (typeof value === 'boolean' || value === null) return value
  if (value instanceof Error)
    return { name: redactText(value.name), message: redactText(value.message) }
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
  if (typeof URL !== 'undefined' && value instanceof URL) return '[Redacted URL]'
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)
    return `[ArrayBuffer:${value.byteLength} bytes]`
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value))
    return `[${Object.prototype.toString.call(value).slice(8, -1)}:${value.byteLength} bytes]`
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `[Blob:${value.size} bytes]`
  if (Array.isArray(value)) return value.slice(0, 50).map(item => serialize(item, depth + 1))
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    let descriptors: PropertyDescriptorMap
    try {
      descriptors = Object.getOwnPropertyDescriptors(value)
    } catch {
      return '[Unserializable]'
    }
    for (const property of Object.keys(descriptors).sort().slice(0, 30)) {
      const descriptor = descriptors[property]
      if (!descriptor?.enumerable) continue
      result[property] =
        'value' in descriptor
          ? serialize(descriptor.value, depth + 1, property)
          : '[Unserializable]'
    }
    return result
  }
  return value === undefined ? '[Undefined]' : String(value)
}

export function serializeDiagnosticArgs(args: unknown[]): string {
  const message = args
    .map(value => {
      const safe = serialize(value)
      return typeof safe === 'string' ? safe : JSON.stringify(safe)
    })
    .join(' ')
  return truncateDiagnosticText(message, DIAGNOSTIC_LOG_MAX_ENTRY_BYTES)
}

export function sanitizeDiagnosticMessage(message: string): string {
  return truncateDiagnosticText(redactText(message), DIAGNOSTIC_LOG_MAX_ENTRY_BYTES)
}

export function getDiagnosticEntryByteSize(entry: Pick<DiagnosticLogEntry, 'message'>): number {
  return utf8Length(entry.message) + 64
}

export function retainDiagnosticEntries<T extends DiagnosticLogEntry>(
  entries: T[],
  now = Date.now()
): T[] {
  const cutoff = now - DIAGNOSTIC_LOG_MAX_AGE_MS
  const eligible = entries
    .filter(entry => entry.timestamp >= cutoff && entry.timestamp <= now + 300_000)
    .sort((left, right) => left.timestamp - right.timestamp || (left.id ?? 0) - (right.id ?? 0))
  const retained: T[] = []
  let totalBytes = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const entry = eligible[index]
    const bytes = entry.byteSize || getDiagnosticEntryByteSize(entry)
    if (
      retained.length >= DIAGNOSTIC_LOG_MAX_ENTRIES ||
      totalBytes + bytes > DIAGNOSTIC_LOG_MAX_TOTAL_BYTES
    )
      break
    retained.push(entry)
    totalBytes += bytes
  }
  return retained.reverse()
}

export function parseDiagnosticLogDraft(value: unknown): DiagnosticLogDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<DiagnosticLogDraft>
  if (
    !['background', 'popup', 'offscreen', 'worker'].includes(draft.source ?? '') ||
    !['debug', 'info', 'warn', 'error'].includes(draft.level ?? '') ||
    typeof draft.message !== 'string' ||
    !Number.isFinite(draft.timestamp) ||
    !Number.isSafeInteger(draft.sequence) ||
    (draft.sequence ?? -1) < 0
  )
    return null
  return {
    source: draft.source as DiagnosticLogSource,
    level: draft.level as DiagnosticLogLevel,
    message: truncateDiagnosticText(draft.message, DIAGNOSTIC_LOG_MAX_ENTRY_BYTES),
    timestamp: draft.timestamp as number,
    sequence: draft.sequence as number
  }
}
