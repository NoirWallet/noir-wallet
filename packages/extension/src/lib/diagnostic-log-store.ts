import {
  getDiagnosticEntryByteSize,
  retainDiagnosticEntries,
  sanitizeDiagnosticMessage,
  type DiagnosticLogDraft,
  type DiagnosticLogEntry
} from '@/lib/diagnostic-log'

const DB_NAME = 'noir-diagnostic-logs'
const STORE_NAME = 'entries'
let connection: Promise<IDBDatabase> | null = null
let writeQueue: Promise<void> = Promise.resolve()

function getConnection(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      connection = null
      reject(request.error)
    }
  })
  return connection
}

export async function appendDiagnosticLog(draft: DiagnosticLogDraft): Promise<void> {
  const safe: DiagnosticLogEntry = {
    ...draft,
    message: sanitizeDiagnosticMessage(draft.message),
    timestamp:
      draft.timestamp > Date.now() + 300_000 || draft.timestamp <= 0 ? Date.now() : draft.timestamp,
    byteSize: 0
  }
  safe.byteSize = getDiagnosticEntryByteSize(safe)
  const pending = writeQueue.then(async () => {
    const db = await getConnection()
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    store.add(safe)
    const request = store.getAll()
    const entries = await new Promise<DiagnosticLogEntry[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as DiagnosticLogEntry[])
      request.onerror = () => reject(request.error)
    })
    const retained = retainDiagnosticEntries(entries)
    const ids = new Set(retained.map(entry => entry.id))
    for (const entry of entries)
      if (entry.id !== undefined && !ids.has(entry.id)) store.delete(entry.id)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
  })
  writeQueue = pending.catch(() => {})
  return pending
}

export async function exportDiagnosticLogs(): Promise<{
  text: string
  filename: string
  count: number
}> {
  await writeQueue
  const db = await getConnection()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const request = store.getAll()
  const entries = await new Promise<DiagnosticLogEntry[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as DiagnosticLogEntry[])
    request.onerror = () => reject(request.error)
  })
  const retained = retainDiagnosticEntries(entries)
  const ids = new Set(retained.map(entry => entry.id))
  for (const entry of entries)
    if (entry.id !== undefined && !ids.has(entry.id)) store.delete(entry.id)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
  const exportedAt = new Date()
  const lines = [
    'Noir Wallet Diagnostics',
    `Version: ${chrome.runtime.getManifest().version}`,
    `Network: ${__NETWORK_MODE__}`,
    `Exported at: ${exportedAt.toISOString()}`,
    `Entries: ${retained.length}`,
    '',
    ...retained.map(
      entry =>
        `[${new Date(entry.timestamp).toISOString()}] [${entry.source}] [${entry.level.toUpperCase()}] ${sanitizeDiagnosticMessage(entry.message)}`
    )
  ]
  const stamp = exportedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  return {
    text: `${lines.join('\n')}\n`,
    filename: `noir-wallet-diagnostics-${stamp}.txt`,
    count: retained.length
  }
}
