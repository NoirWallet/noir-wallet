import {
  DIAGNOSTIC_LOG_MAX_ENTRY_BYTES,
  getDiagnosticEntryByteSize,
  retainDiagnosticEntries,
  sanitizeDiagnosticText,
  truncateUtf8,
  type DiagnosticLogDraft,
  type DiagnosticLogEntry
} from '@/lib/diagnostic-log'

const DB_NAME = 'noir-diagnostic-logs'
const DB_VERSION = 1
const ENTRY_STORE = 'entries'
const META_STORE = 'metadata'
const SALT_KEY = 'fingerprint_salt'

let dbConnection: IDBDatabase | null = null
let connectionPromise: Promise<IDBDatabase> | null = null
let saltPromise: Promise<string> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

async function getConnection(): Promise<IDBDatabase> {
  if (dbConnection) return dbConnection
  if (connectionPromise) return connectionPromise

  connectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      connectionPromise = null
      reject(request.error || new Error('Failed to open diagnostic log database'))
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        const entries = db.createObjectStore(ENTRY_STORE, {
          keyPath: 'id',
          autoIncrement: true
        })
        entries.createIndex('timestamp', 'timestamp', { unique: false })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    request.onsuccess = () => {
      const db = request.result
      dbConnection = db
      connectionPromise = null
      db.onclose = () => {
        if (dbConnection === db) dbConnection = null
      }
      db.onversionchange = () => {
        db.close()
        if (dbConnection === db) dbConnection = null
      }
      resolve(db)
    }
  })

  return connectionPromise
}

function generateSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function getDiagnosticLogSalt(): Promise<string> {
  if (saltPromise) return saltPromise

  saltPromise = getConnection()
    .then(
      db =>
        new Promise<string>((resolve, reject) => {
          // A single readwrite transaction makes first use atomic across the
          // background and Worker, which share the extension's IndexedDB.
          const transaction = db.transaction(META_STORE, 'readwrite')
          const store = transaction.objectStore(META_STORE)
          const request = store.get(SALT_KEY)
          let salt: string | undefined
          request.onsuccess = () => {
            try {
              const existing: unknown = request.result
              salt =
                typeof existing === 'string' && existing.length >= 16 ? existing : generateSalt()
              if (salt !== existing) store.put(salt, SALT_KEY)
            } catch (error) {
              transaction.abort()
              reject(error)
            }
          }
          transaction.oncomplete = () => {
            if (salt) resolve(salt)
            else reject(new Error('Diagnostic salt unavailable'))
          }
          transaction.onerror = () =>
            reject(transaction.error || new Error('Diagnostic salt transaction failed'))
          transaction.onabort = () =>
            reject(transaction.error || new Error('Diagnostic salt transaction aborted'))
        })
    )
    .catch(error => {
      saltPromise = null
      throw error
    })

  return saltPromise
}

async function sanitizeEntry(draft: DiagnosticLogDraft): Promise<DiagnosticLogEntry> {
  const salt = await getDiagnosticLogSalt()
  const message = truncateUtf8(
    await sanitizeDiagnosticText(draft.message, salt),
    DIAGNOSTIC_LOG_MAX_ENTRY_BYTES
  )
  const entry: DiagnosticLogEntry = {
    ...draft,
    message,
    timestamp:
      draft.timestamp > Date.now() + 5 * 60 * 1000 || draft.timestamp <= 0
        ? Date.now()
        : draft.timestamp,
    byteSize: 0
  }
  entry.byteSize = getDiagnosticEntryByteSize(entry)
  return entry
}

function pruneStore(
  store: IDBObjectStore,
  entries: DiagnosticLogEntry[],
  now: number
): DiagnosticLogEntry[] {
  const retained = retainDiagnosticEntries(entries, now)
  const retainedIds = new Set(retained.map(entry => entry.id).filter(id => id !== undefined))
  for (const entry of entries) {
    if (entry.id !== undefined && !retainedIds.has(entry.id)) store.delete(entry.id)
  }
  return retained
}

async function appendNow(draft: DiagnosticLogDraft): Promise<void> {
  const entry = await sanitizeEntry(draft)
  const db = await getConnection()
  const transaction = db.transaction(ENTRY_STORE, 'readwrite')
  const store = transaction.objectStore(ENTRY_STORE)
  store.add(entry)
  const entries = (await requestResult(store.getAll())) as DiagnosticLogEntry[]
  pruneStore(store, entries, Date.now())
  await transactionComplete(transaction)
}

export function appendDiagnosticLog(draft: DiagnosticLogDraft): Promise<void> {
  const pending = writeQueue.then(() => appendNow(draft))
  writeQueue = pending.catch(() => {})
  return pending
}

export async function readDiagnosticLogs(now = Date.now()): Promise<DiagnosticLogEntry[]> {
  await writeQueue
  const db = await getConnection()
  const transaction = db.transaction(ENTRY_STORE, 'readwrite')
  const store = transaction.objectStore(ENTRY_STORE)
  const entries = (await requestResult(store.getAll())) as DiagnosticLogEntry[]
  const retained = pruneStore(store, entries, now)
  await transactionComplete(transaction)
  return retained
}

function formatTimestampForFilename(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function formatDiagnosticLogExport(
  entries: DiagnosticLogEntry[],
  exportedAt = Date.now()
): { text: string; filename: string; count: number } {
  const manifest = chrome.runtime.getManifest()
  const lines = [
    'Noir Wallet Diagnostics',
    `Version: ${manifest.version}`,
    `Network: ${__NETWORK_MODE__}`,
    `Build channel: ${__BUILD_CHANNEL__}`,
    `Exported at: ${new Date(exportedAt).toISOString()}`,
    `Entries: ${entries.length}`,
    'Retention: Last 24 hours, up to 500 entries',
    'Privacy: Sensitive wallet, account, transaction, credential, amount, and dApp data is removed or anonymized before storage.',
    ''
  ]

  if (entries.length === 0) {
    lines.push('No diagnostic entries recorded')
  } else {
    for (const entry of entries) {
      lines.push(
        `[${new Date(entry.timestamp).toISOString()}] [${entry.source}] [${entry.level.toUpperCase()}] ${entry.message}`
      )
    }
  }

  return {
    text: `${lines.join('\n')}\n`,
    filename: `noir-wallet-diagnostics-${formatTimestampForFilename(exportedAt)}.txt`,
    count: entries.length
  }
}

export async function exportDiagnosticLogs(): Promise<{
  text: string
  filename: string
  count: number
}> {
  return formatDiagnosticLogExport(await readDiagnosticLogs())
}
