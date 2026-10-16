import { wordlist } from '@scure/bip39/wordlists/english'

export const DIAGNOSTIC_LOG_MAX_ENTRIES = 500
export const DIAGNOSTIC_LOG_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const DIAGNOSTIC_LOG_MAX_ENTRY_BYTES = 2 * 1024
export const DIAGNOSTIC_LOG_MAX_TOTAL_BYTES = 512 * 1024

const MAX_DEPTH = 4
const MAX_OBJECT_FIELDS = 30
const MAX_ARRAY_ITEMS = 50
const textEncoder = new TextEncoder()
const recoveryWords = new Set(wordlist)
const nativeStackGetter = Object.getOwnPropertyDescriptor(new Error(), 'stack')?.get

export function getDiagnosticRpcMethod(method: unknown): string {
  return typeof method === 'string' &&
    method.length <= 80 &&
    /^[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(method)
    ? method
    : '[invalid RPC method]'
}

// Error objects may carry full HTTP requests or wallet payloads. Preserve the
// diagnostic fields, including non-enumerable native Error fields, without
// invoking custom accessors or copying those payloads across extension contexts.
export function getDiagnosticErrorDetails(error: unknown): unknown {
  return projectError(error, new WeakSet(), 0)
}

function projectError(error: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (error === null || error === undefined) return error
  if (typeof error !== 'object') {
    return typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean'
      ? error
      : '[Non-standard error]'
  }
  if (seen.has(error)) return '[Circular error]'
  if (depth >= MAX_DEPTH) return '[Error cause truncated]'
  seen.add(error)

  try {
    const fields: Record<string, unknown> = {}
    for (const key of [
      'name',
      'message',
      'code',
      'status',
      'statusCode',
      'type',
      'retryable',
      'details',
      'stack',
      'cause'
    ]) {
      let owner: object | null = error
      let descriptor: PropertyDescriptor | undefined
      for (let level = 0; owner && level < MAX_DEPTH; level += 1) {
        descriptor = Object.getOwnPropertyDescriptor(owner, key)
        if (descriptor) break
        owner = Object.getPrototypeOf(owner)
      }
      if (!descriptor) continue
      let value: unknown
      if ('value' in descriptor) {
        value = descriptor.value
      } else if (
        key === 'stack' &&
        error instanceof Error &&
        nativeStackGetter &&
        descriptor.get === nativeStackGetter
      ) {
        // V8 exposes its lazy native stack through a shared accessor. Custom
        // accessors stay excluded, just like other error payload properties.
        value = nativeStackGetter.call(error)
      } else {
        continue
      }
      if (key === 'cause') {
        fields.cause = projectError(value, seen, depth + 1)
      } else if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        fields[key] = value
      }
    }
    return Object.keys(fields).length ? fields : '[Non-standard error without diagnostic fields]'
  } catch {
    return '[Unserializable error]'
  } finally {
    seen.delete(error)
  }
}

function redactRecoveryPhrases(value: string): string {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  let end = 0
  let count = 0
  const finish = () => {
    if (count >= 12) ranges.push({ start, end })
    count = 0
  }
  for (const match of value.matchAll(/\b[a-z]+\b/gi)) {
    const index = match.index ?? 0
    if (!recoveryWords.has(match[0].toLowerCase())) {
      finish()
      continue
    }
    if (count && !/^\s+$/.test(value.slice(end, index))) finish()
    if (!count) start = index
    end = index + match[0].length
    count += 1
  }
  finish()
  let result = ''
  let cursor = 0
  for (const range of ranges) {
    result += value.slice(cursor, range.start) + '[Recovery phrase redacted]'
    cursor = range.end
  }
  return result + value.slice(cursor)
}

export type DiagnosticLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type DiagnosticLogSource = 'background' | 'popup' | 'offscreen' | 'worker' | 'content-script'

export interface DiagnosticLogDraft {
  source: DiagnosticLogSource
  level: DiagnosticLogLevel
  message: string
  timestamp: number
  contextId: string
  sequence: number
}

export interface DiagnosticLogEntry extends DiagnosticLogDraft {
  id?: number
  byteSize: number
}

const SECRET_KEY_PARTS = [
  'mnemonic',
  'seedphrase',
  'seedwords',
  'password',
  'passphrase',
  'privatekey',
  'spendingkey',
  'viewingkey',
  'ufvk',
  'secret',
  'credential',
  'keymaterial',
  'sessionpassword',
  'signature',
  'memo',
  'ciphertext',
  'authorization',
  'authtoken',
  'accesstoken',
  'refreshtoken'
]

const PRIVATE_VALUE_KEY_PARTS = ['amount', 'balance', 'valuezat', 'usdvalue', 'usdamount']
const IDENTIFIER_KEY_PARTS = [
  'address',
  'walletid',
  'accountid',
  'transactionid',
  'txhash',
  'txid',
  'requestid',
  'depositaddress'
]
const PRIVATE_LOCATION_KEY_PARTS = ['origin', 'domain', 'hostname', 'url', 'endpoint']

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function keyContains(key: string | undefined, candidates: string[]): boolean {
  if (!key) return false
  const normalized = normalizeKey(key)
  return candidates.some(candidate => normalized.includes(candidate))
}

function isSecretKey(key?: string): boolean {
  return keyContains(key, SECRET_KEY_PARTS)
}

function isPrivateValueKey(key?: string): boolean {
  if (!key) return false
  const normalized = normalizeKey(key)
  return (
    PRIVATE_VALUE_KEY_PARTS.some(candidate => normalized.includes(candidate)) ||
    normalized === 'fee' ||
    normalized.endsWith('fee') ||
    normalized === 'price'
  )
}

function isIdentifierKey(key?: string): boolean {
  return keyContains(key, IDENTIFIER_KEY_PARTS)
}

function isPrivateLocationKey(key?: string): boolean {
  return keyContains(key, PRIVATE_LOCATION_KEY_PARTS)
}

function getObjectTag(value: object): string {
  try {
    return Object.prototype.toString.call(value).slice(8, -1)
  } catch {
    return 'Object'
  }
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value

  const suffix = '...[Truncated]'
  const suffixBytes = byteLength(suffix)
  const bytes = textEncoder.encode(value)
  const limit = Math.max(0, maxBytes - suffixBytes)
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let end = Math.min(bytes.length, limit)
  let truncated = decoder.decode(bytes.slice(0, end))

  while (byteLength(truncated) > limit && end > 0) {
    end -= 1
    truncated = decoder.decode(bytes.slice(0, end))
  }

  return `${truncated}${suffix}`
}

async function fingerprint(kind: string, value: string, salt: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(`${salt}:${value}`))
    const shortHash = Array.from(new Uint8Array(digest).slice(0, 4), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    return `[${kind}:${shortHash}]`
  } catch {
    return `[${kind}:redacted]`
  }
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacer: (match: string) => Promise<string>
): Promise<string> {
  const matches = [...value.matchAll(pattern)]
  if (matches.length === 0) return value

  let result = ''
  let cursor = 0
  for (const match of matches) {
    const index = match.index ?? 0
    result += value.slice(cursor, index)
    result += await replacer(match[0])
    cursor = index + match[0].length
  }
  return result + value.slice(cursor)
}

export function redactSensitiveText(value: string): string {
  let sanitized = redactRecoveryPhrases(value)

  sanitized = sanitized.replace(
    /["']?\b(seed(?:\s*(?:phrase|words))?|recovery\s*phrase|mnemonic|password|passphrase|private\s*key|spending\s*key|viewing\s*key|session\s*key|key\s*material|secret|credential|signature|memo|auth(?:orization)?(?:\s*token)?|access\s*token|refresh\s*token)["']?\s*[:=]\s*(?:\[(?:Redacted|Recovery phrase redacted)\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;)}\]]+)/gi,
    '$1=[Redacted]'
  )
  return sanitized
}

export async function sanitizeDiagnosticText(value: string, salt: string): Promise<string> {
  let sanitized = redactSensitiveText(value)

  sanitized = sanitized.replace(
    /\b(amount|balance|fee|value|usd(?:\s*value)?|transparent|shielded|sapling|orchard|ironwood|unshielded|spendable|available|pending|total)(?:\s+balance)?\s*[:=]\s*-?\d+(?:\.\d+)?/gi,
    '$1=[Redacted]'
  )
  sanitized = sanitized.replace(/-?\d+(?:\.\d+)?\s*(?:ZEC|zatoshis?|USD)\b/gi, '[Redacted amount]')
  sanitized = sanitized.replace(/\b(?:https?|wss?):\/\/[^\s)\]}>,]+/gi, '[URL]')

  sanitized = await replaceAsync(
    sanitized,
    /\b(?:u1|utest1|zs1|ztestsapling1|t1|t2|t3|tm)[a-zA-Z0-9]{28,}\b/g,
    match => fingerprint('address', match, salt)
  )
  sanitized = await replaceAsync(sanitized, /\b[0-9a-fA-F]{64}\b/g, match =>
    fingerprint('tx', match.toLowerCase(), salt)
  )
  sanitized = await replaceAsync(
    sanitized,
    /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/g,
    match => fingerprint('id', match.toLowerCase(), salt)
  )

  return sanitized
}

async function serializeValue(
  value: unknown,
  salt: string,
  seen: WeakSet<object>,
  depth: number,
  key?: string
): Promise<unknown> {
  if (isSecretKey(key) || isPrivateValueKey(key)) return '[Redacted]'
  if (isPrivateLocationKey(key)) return '[Redacted URL]'
  if (isIdentifierKey(key) && value !== null && value !== undefined) {
    return fingerprint('id', String(value), salt)
  }

  if (value === null) return null
  if (typeof value === 'string') {
    const sanitized = await sanitizeDiagnosticText(value, salt)
    return key === 'stack' ? truncateUtf8(sanitized, 512) : sanitized
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `[BigInt:${value.toString()}]`
  if (typeof value === 'undefined') return '[Undefined]'
  if (typeof value === 'symbol') return `[Symbol:${value.description ?? ''}]`
  if (typeof value === 'function') return `[Function:${value.name || 'anonymous'}]`
  if (typeof value !== 'object') return String(value)

  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return `[MaxDepth:${getObjectTag(value)}]`
  seen.add(value)

  try {
    if (value instanceof Error) {
      return serializeValue(getDiagnosticErrorDetails(value), salt, seen, depth)
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString()
    }
    if (typeof URL !== 'undefined' && value instanceof URL) return '[Redacted URL]'
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      return `[ArrayBuffer:${value.byteLength} bytes]`
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
      return `[${getObjectTag(value)}:${value.byteLength} bytes]`
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      const name = typeof File !== 'undefined' && value instanceof File ? 'File' : 'Blob'
      return `[${name}:${value.size} bytes${value.type ? `:${value.type}` : ''}]`
    }
    if (typeof Event !== 'undefined' && value instanceof Event) {
      return `[${getObjectTag(value)}:${await sanitizeDiagnosticText(value.type, salt)}]`
    }
    if (value instanceof Map) {
      const entries = [...value.entries()].slice(0, MAX_OBJECT_FIELDS)
      const serialized = await Promise.all(
        entries.map(async ([mapKey, mapValue]) => [
          await serializeValue(mapKey, salt, seen, depth + 1),
          await serializeValue(mapValue, salt, seen, depth + 1)
        ])
      )
      if (value.size > MAX_OBJECT_FIELDS) serialized.push(['[Truncated]', value.size])
      return { '[Map]': serialized }
    }
    if (value instanceof Set) {
      const values = [...value.values()].slice(0, MAX_ARRAY_ITEMS)
      const serialized = await Promise.all(
        values.map(item => serializeValue(item, salt, seen, depth + 1))
      )
      if (value.size > MAX_ARRAY_ITEMS)
        serialized.push(`[Truncated:${value.size - MAX_ARRAY_ITEMS}]`)
      return { '[Set]': serialized }
    }
    if (Array.isArray(value)) {
      const serialized = await Promise.all(
        value.slice(0, MAX_ARRAY_ITEMS).map(item => serializeValue(item, salt, seen, depth + 1))
      )
      if (value.length > MAX_ARRAY_ITEMS) {
        serialized.push(`[Truncated:${value.length - MAX_ARRAY_ITEMS}]`)
      }
      return serialized
    }

    let descriptors: Record<string, PropertyDescriptor>
    try {
      descriptors = Object.getOwnPropertyDescriptors(value)
    } catch {
      return '[Unserializable]'
    }

    const keys = Object.keys(descriptors)
      .filter(descriptorKey => descriptors[descriptorKey]?.enumerable)
      .sort()
      .slice(0, MAX_OBJECT_FIELDS)
    const serialized: Record<string, unknown> = {}
    for (const propertyKey of keys) {
      const descriptor = descriptors[propertyKey]
      if (!descriptor || !('value' in descriptor)) {
        serialized[propertyKey] = '[Unserializable]'
        continue
      }
      serialized[propertyKey] = await serializeValue(
        descriptor.value,
        salt,
        seen,
        depth + 1,
        propertyKey
      )
    }
    const fieldCount = Object.keys(descriptors).filter(
      descriptorKey => descriptors[descriptorKey]?.enumerable
    ).length
    if (fieldCount > MAX_OBJECT_FIELDS) {
      serialized['[Truncated]'] = `${fieldCount - MAX_OBJECT_FIELDS} fields`
    }
    if (keys.length === 0 && getObjectTag(value) !== 'Object') {
      return `[${getObjectTag(value)}]`
    }
    return serialized
  } catch {
    return '[Unserializable]'
  } finally {
    seen.delete(value)
  }
}

export async function serializeDiagnosticArgs(args: unknown[], salt: string): Promise<string> {
  const parts: string[] = []
  for (const arg of args) {
    const serialized = await serializeValue(arg, salt, new WeakSet(), 0)
    if (typeof serialized === 'string') {
      parts.push(serialized)
      continue
    }
    try {
      parts.push(JSON.stringify(serialized))
    } catch {
      parts.push('[Unserializable]')
    }
  }
  return truncateUtf8(parts.join(' '), DIAGNOSTIC_LOG_MAX_ENTRY_BYTES)
}

export function getDiagnosticEntryByteSize(entry: Pick<DiagnosticLogEntry, 'message'>): number {
  return byteLength(entry.message) + 96
}

export function retainDiagnosticEntries<T extends DiagnosticLogEntry>(
  entries: T[],
  now = Date.now()
): T[] {
  const cutoff = now - DIAGNOSTIC_LOG_MAX_AGE_MS
  const eligible = entries
    .filter(entry => entry.timestamp >= cutoff && entry.timestamp <= now + 5 * 60 * 1000)
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
      if (a.contextId === b.contextId && a.sequence !== b.sequence) return a.sequence - b.sequence
      return (a.id ?? 0) - (b.id ?? 0)
    })

  const retained: T[] = []
  let totalBytes = 0
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const entry = eligible[index]
    const entryBytes = entry.byteSize || getDiagnosticEntryByteSize(entry)
    if (retained.length >= DIAGNOSTIC_LOG_MAX_ENTRIES) break
    if (totalBytes + entryBytes > DIAGNOSTIC_LOG_MAX_TOTAL_BYTES) break
    retained.push(entry)
    totalBytes += entryBytes
  }
  return retained.reverse()
}

export function isDiagnosticLogLevel(value: unknown): value is DiagnosticLogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
}

export function isDiagnosticLogSource(value: unknown): value is DiagnosticLogSource {
  return (
    value === 'background' ||
    value === 'popup' ||
    value === 'offscreen' ||
    value === 'worker' ||
    value === 'content-script'
  )
}

export function parseDiagnosticLogDraft(value: unknown): DiagnosticLogDraft | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<DiagnosticLogDraft>
  if (
    !isDiagnosticLogSource(candidate.source) ||
    !isDiagnosticLogLevel(candidate.level) ||
    typeof candidate.message !== 'string' ||
    !Number.isFinite(candidate.timestamp) ||
    typeof candidate.contextId !== 'string' ||
    candidate.contextId.length > 100 ||
    !Number.isSafeInteger(candidate.sequence) ||
    (candidate.sequence ?? -1) < 0
  ) {
    return null
  }
  return {
    source: candidate.source,
    level: candidate.level,
    message: truncateUtf8(candidate.message, DIAGNOSTIC_LOG_MAX_ENTRY_BYTES),
    timestamp: candidate.timestamp as number,
    contextId: candidate.contextId,
    sequence: candidate.sequence as number
  }
}
