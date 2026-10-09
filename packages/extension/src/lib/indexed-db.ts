/**
 * IndexedDB Storage for Noir Wallet Database
 *
 * Provides persistent storage for WASM wallet database with large storage capacity.
 * Uses singleton pattern to maintain a single database connection.
 * Includes version management for WASM data compatibility.
 */

import type { Transaction } from '@/types'
import type { VerboseTransaction } from './zcash-node-rpc.ts'
import {
  WALLET_PERSISTENCE_QUARANTINE_STORE_NAME,
  createWalletPersistenceQuarantineRecord,
  parseWalletPersistenceQuarantineRecord,
  type WalletPersistenceQuarantineReason,
  type WalletPersistenceQuarantineRecord
} from './indexed-db-quarantine'

const DB_NAME = 'zcash-wallet-db'
const DB_VERSION = 7
const STORE_NAME = 'walletData'
const TRANSACTIONS_STORE_NAME = 'transactions'
const VOTING_DATA_STORE_NAME = 'votingData'
const TRANSPARENT_TRANSACTION_CACHE_STORE_NAME = 'transparentTransactionCache'
const LEGACY_TRANSPARENT_TX_CACHE_STORE_NAME = 'transparentTxCache'

function normalizeTransactions(value: unknown): Transaction[] {
  if (Array.isArray(value)) return value
  if (
    value &&
    typeof value === 'object' &&
    'transactions' in value &&
    Array.isArray((value as { transactions?: unknown }).transactions)
  ) {
    return (value as { transactions: Transaction[] }).transactions
  }
  return []
}

function normalizeTransparentTxCache(value: unknown): Record<string, VerboseTransaction> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, VerboseTransaction] =>
        /^[0-9a-fA-F]{64}$/.test(entry[0]) &&
        !!entry[1] &&
        typeof entry[1] === 'object' &&
        'txid' in entry[1] &&
        typeof entry[1].txid === 'string' &&
        entry[1].txid.toLowerCase() === entry[0].toLowerCase()
    )
  )
}
const JOURNAL_STORE_NAME = 'syncJournal'
const JOURNAL_MANIFEST_STORE_NAME = 'syncJournalManifest'

// WASM data version for compatibility checking
const WASM_DATA_VERSION = 1

interface WalletDbMetadata {
  version: number
  timestamp: number
  network: string
  walletId: string
}

interface WalletDbEntry {
  metadata: WalletDbMetadata
  data: Uint8Array
}

/**
 * Chunked manifest stored at the primary key. The DB bytes live in sibling
 * entries keyed `${key}::c::${i}`. Chunking is required because IndexedDB
 * enforces a hard per-value size limit (~127 MiB); a multi-year wallet DB
 * exceeds it and a single put() aborts the transaction.
 */
interface WalletDbChunkManifest {
  metadata: WalletDbMetadata
  chunked: true
  chunkCount: number
  chunkSizes: number[]
  totalBytes: number
}

export type WalletDbInspection =
  | { status: 'missing' }
  | {
      status: 'compatible'
      format: 'single' | 'chunked'
      version: number
      totalBytes: number
    }
  | {
      status: 'incompatible'
      reason: 'legacy-format' | 'version-mismatch' | 'invalid-entry'
      storedVersion?: number
    }
  | {
      status: 'quarantined'
      reason: WalletPersistenceQuarantineReason
      detectedAt: number
    }
  | { status: 'unavailable' }

export class IncompatibleWalletDbError extends Error {
  readonly code = 'INCOMPATIBLE_WALLET_DB'

  constructor(
    readonly key: string,
    readonly inspection: Extract<WalletDbInspection, { status: 'incompatible' }>
  ) {
    super(`Wallet snapshot is incompatible and has been preserved: ${inspection.reason}`)
    this.name = 'IncompatibleWalletDbError'
  }
}

// Keep each stored value comfortably under the IndexedDB per-value limit.
const DB_CHUNK_SIZE = 64 * 1024 * 1024

function walletDbChunkKey(key: string, index: number): string {
  return `${key}::c::${index}`
}

function walletDbChunkRange(key: string): IDBKeyRange {
  return IDBKeyRange.bound(`${key}::c::`, `${key}::c::\uffff`)
}

/**
 * Split source buffers into standalone chunks no larger than DB_CHUNK_SIZE.
 * Buffers already within the limit are stored as-is (no copy) so the streamed
 * worker chunks avoid a redundant 100MB+ reallocation.
 */
function toStorageChunks(sources: Uint8Array[]): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (const src of sources) {
    if (src.byteLength === 0) continue
    if (src.byteLength <= DB_CHUNK_SIZE) {
      chunks.push(src)
      continue
    }
    for (let offset = 0; offset < src.byteLength; offset += DB_CHUNK_SIZE) {
      chunks.push(src.slice(offset, Math.min(offset + DB_CHUNK_SIZE, src.byteLength)))
    }
  }
  return chunks
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getByteLength(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const byteLength = (value as { byteLength?: unknown }).byteLength
  return typeof byteLength === 'number' && Number.isSafeInteger(byteLength) && byteLength >= 0
    ? byteLength
    : null
}

export function inspectWalletDbEntry(entry: unknown): WalletDbInspection {
  if (entry == null) return { status: 'missing' }
  if (getByteLength(entry) !== null) {
    return { status: 'incompatible', reason: 'legacy-format' }
  }
  if (!isRecord(entry) || !isRecord(entry.metadata)) {
    return { status: 'incompatible', reason: 'invalid-entry' }
  }

  const storedVersion = entry.metadata.version
  if (typeof storedVersion !== 'number' || !Number.isSafeInteger(storedVersion)) {
    return { status: 'incompatible', reason: 'invalid-entry' }
  }
  if (storedVersion !== WASM_DATA_VERSION) {
    return { status: 'incompatible', reason: 'version-mismatch', storedVersion }
  }

  if (entry.chunked === true) {
    const chunkCount = entry.chunkCount
    const chunkSizes = entry.chunkSizes
    const totalBytes = entry.totalBytes
    const validManifest =
      typeof chunkCount === 'number' &&
      Number.isSafeInteger(chunkCount) &&
      chunkCount >= 0 &&
      Array.isArray(chunkSizes) &&
      chunkSizes.length === chunkCount &&
      chunkSizes.every(
        size => typeof size === 'number' && Number.isSafeInteger(size) && size >= 0
      ) &&
      typeof totalBytes === 'number' &&
      Number.isSafeInteger(totalBytes) &&
      totalBytes >= 0 &&
      chunkSizes.reduce((sum, size) => sum + size, 0) === totalBytes
    return validManifest
      ? {
          status: 'compatible',
          format: 'chunked',
          version: storedVersion,
          totalBytes
        }
      : { status: 'incompatible', reason: 'invalid-entry' }
  }

  const totalBytes = getByteLength(entry.data)
  return totalBytes === null
    ? { status: 'incompatible', reason: 'invalid-entry' }
    : {
        status: 'compatible',
        format: 'single',
        version: storedVersion,
        totalBytes
      }
}

// Singleton connection
let dbConnection: IDBDatabase | null = null
let dbConnectionPromise: Promise<IDBDatabase> | null = null

/**
 * Get or create IndexedDB connection (singleton pattern)
 */
async function getConnection(): Promise<IDBDatabase> {
  if (dbConnection) {
    return dbConnection
  }

  if (dbConnectionPromise) {
    return dbConnectionPromise
  }

  dbConnectionPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      dbConnectionPromise = null
      reject(request.error)
    }

    request.onsuccess = () => {
      const db = request.result
      dbConnection = db
      dbConnectionPromise = null

      db.onclose = () => {
        if (dbConnection === db) dbConnection = null
      }
      db.onversionchange = () => {
        db.close()
        if (dbConnection === db) dbConnection = null
      }

      resolve(db)
    }

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(TRANSACTIONS_STORE_NAME)) {
        db.createObjectStore(TRANSACTIONS_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(VOTING_DATA_STORE_NAME)) {
        db.createObjectStore(VOTING_DATA_STORE_NAME)
      }
      if (db.objectStoreNames.contains(LEGACY_TRANSPARENT_TX_CACHE_STORE_NAME)) {
        db.deleteObjectStore(LEGACY_TRANSPARENT_TX_CACHE_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME)) {
        db.createObjectStore(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(JOURNAL_STORE_NAME)) {
        const journalStore = db.createObjectStore(JOURNAL_STORE_NAME, {
          keyPath: ['walletKey', 'seq']
        })
        journalStore.createIndex('byWallet', 'walletKey', { unique: false })
      }
      if (!db.objectStoreNames.contains(JOURNAL_MANIFEST_STORE_NAME)) {
        db.createObjectStore(JOURNAL_MANIFEST_STORE_NAME)
      }
      if (!db.objectStoreNames.contains(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME)) {
        db.createObjectStore(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME)
      }
    }
  })

  return dbConnectionPromise
}

/**
 * Save wallet database bytes to IndexedDB with version metadata.
 *
 * Bytes are stored as multiple chunk entries plus a manifest so arbitrarily
 * large wallet DBs stay under the IndexedDB per-value limit. Accepts either a
 * single buffer or the pre-chunked stream produced by the worker.
 *
 * @param key - Storage key (e.g., "testnet_walletId123")
 * @param data - Wallet database bytes, or an array of streamed chunks
 */
export async function saveWalletDb(key: string, data: Uint8Array | Uint8Array[]): Promise<void> {
  const existing = await inspectWalletDb(key)
  if (existing.status === 'quarantined') {
    throw new Error(`Cannot overwrite quarantined wallet snapshot: ${key}`)
  }
  if (existing.status === 'incompatible') {
    reportIncompatibleWalletDb(key, existing)
    throw new IncompatibleWalletDbError(key, existing)
  }
  if (existing.status === 'unavailable') {
    throw new Error(`Cannot safely inspect existing wallet snapshot before saving: ${key}`)
  }

  const db = await getConnection()

  // Extract network and walletId from key (format: "network_walletId")
  const [network, walletId] = key.split('_')

  const chunks = toStorageChunks(Array.isArray(data) ? data : [data])
  const chunkSizes = chunks.map(c => c.byteLength)
  const totalBytes = chunkSizes.reduce((sum, n) => sum + n, 0)

  const manifest: WalletDbChunkManifest = {
    metadata: {
      version: WASM_DATA_VERSION,
      timestamp: Date.now(),
      network: network || 'unknown',
      walletId: walletId || 'unknown'
    },
    chunked: true,
    chunkCount: chunks.length,
    chunkSizes,
    totalBytes
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    // Drop any stale chunks from a previous (larger) save before rewriting.
    store.delete(walletDbChunkRange(key))
    chunks.forEach((chunk, i) => store.put(chunk, walletDbChunkKey(key, i)))
    store.put(manifest, key)

    transaction.oncomplete = () =>
      finish(() => {
        console.log(
          `[IndexedDB] Saved ${totalBytes} bytes in ${chunks.length} chunk(s) for key: ${key} (version: ${WASM_DATA_VERSION})`
        )
        resolve()
      })
    transaction.onabort = () =>
      finish(() => {
        const err = transaction.error || new Error('IndexedDB transaction aborted')
        console.warn(`[IndexedDB] save aborted for ${key}: ${err.name}: ${err.message}`)
        reject(err)
      })
    transaction.onerror = () =>
      finish(() => {
        const err = transaction.error || new Error('IndexedDB transaction error')
        console.warn(`[IndexedDB] save error for ${key}: ${err.name}: ${err.message}`)
        reject(err)
      })
  })
}

/**
 * Reassemble chunked wallet DB bytes into a single contiguous buffer.
 */
async function loadChunkedWalletDb(
  db: IDBDatabase,
  key: string,
  manifest: WalletDbChunkManifest
): Promise<Uint8Array> {
  const { chunkCount, chunkSizes, totalBytes } = manifest
  const merged = new Uint8Array(totalBytes)
  const offsets: number[] = []
  let acc = 0
  for (const size of chunkSizes) {
    offsets.push(acc)
    acc += size
  }

  if (chunkCount === 0) return merged

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const store = transaction.objectStore(STORE_NAME)
    let failed = false

    for (let i = 0; i < chunkCount; i++) {
      const req = store.get(walletDbChunkKey(key, i))
      req.onsuccess = () => {
        const chunk = req.result as Uint8Array | undefined
        if (!chunk) {
          failed = true
          reject(new Error(`Missing chunk ${i}/${chunkCount} for key: ${key}`))
          try {
            transaction.abort()
          } catch {
            /* already settling */
          }
          return
        }
        merged.set(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk), offsets[i])
      }
    }

    transaction.oncomplete = () => resolve(merged)
    transaction.onerror = () => {
      if (!failed) reject(transaction.error)
    }
    transaction.onabort = () => {
      if (!failed) reject(transaction.error || new Error('IndexedDB load transaction aborted'))
    }
  })
}

function readWalletDbEntry(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function readWalletPersistenceQuarantine(
  db: IDBDatabase,
  key: string
): Promise<WalletPersistenceQuarantineRecord | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME, 'readonly')
    const request = transaction.objectStore(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME).get(key)
    request.onsuccess = () => {
      try {
        resolve(
          request.result === undefined
            ? null
            : parseWalletPersistenceQuarantineRecord(request.result)
        )
      } catch (error) {
        reject(error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

export async function getWalletPersistenceQuarantine(
  key: string
): Promise<WalletPersistenceQuarantineRecord | null> {
  return readWalletPersistenceQuarantine(await getConnection(), key)
}

export async function quarantineWalletPersistence(input: {
  readonly key: string
  readonly network: string
  readonly walletId: string
  readonly reason: WalletPersistenceQuarantineReason
  readonly snapshot: boolean
  readonly journal: boolean
}): Promise<WalletPersistenceQuarantineRecord> {
  const db = await getConnection()
  const existing = await readWalletPersistenceQuarantine(db, input.key).catch(() => null)
  const record = createWalletPersistenceQuarantineRecord({
    key: input.key,
    network: input.network,
    walletId: input.walletId,
    reason: input.reason,
    snapshotQuarantined: input.snapshot,
    journalQuarantined: input.journal,
    detectedAt: Date.now(),
    existing
  })
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME, 'readwrite')
    transaction.objectStore(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME).put(record, input.key)
    transaction.oncomplete = () => resolve(record)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB quarantine transaction aborted'))
  })
}

function reportIncompatibleWalletDb(key: string, inspection: WalletDbInspection): void {
  if (inspection.status !== 'incompatible') return
  const versionDetails =
    inspection.reason === 'version-mismatch'
      ? ` stored=${inspection.storedVersion}, expected=${WASM_DATA_VERSION}.`
      : ''
  console.warn(
    `[IndexedDB] Incompatible wallet snapshot for ${key}: ${inspection.reason}.${versionDetails} Preserving data for migration or recovery.`
  )
}

/**
 * Reports snapshot compatibility without loading or mutating the stored bytes.
 */
export async function inspectWalletDb(key: string): Promise<WalletDbInspection> {
  try {
    const db = await getConnection()
    const quarantine = await readWalletPersistenceQuarantine(db, key)
    if (quarantine?.snapshotQuarantined) {
      return {
        status: 'quarantined',
        reason: quarantine.reasons[quarantine.reasons.length - 1],
        detectedAt: quarantine.detectedAt
      }
    }
    return inspectWalletDbEntry(await readWalletDbEntry(db, key))
  } catch (error) {
    console.warn(`[IndexedDB] Failed to inspect wallet db for ${key}:`, error)
    return { status: 'unavailable' }
  }
}

/**
 * Load wallet database bytes from IndexedDB with version check.
 * Incompatible snapshots are isolated from WASM but retained in place.
 * @param key - Storage key (e.g., "testnet_walletId123")
 */
export async function loadWalletDb(key: string): Promise<Uint8Array | null> {
  try {
    const db = await getConnection()
    const quarantine = await readWalletPersistenceQuarantine(db, key)
    if (quarantine?.snapshotQuarantined) {
      console.warn(
        `[IndexedDB] Wallet snapshot ${key} is quarantined and will not be loaded automatically.`
      )
      return null
    }
    const entry = await readWalletDbEntry(db, key)
    const inspection = inspectWalletDbEntry(entry)

    if (inspection.status !== 'compatible') {
      reportIncompatibleWalletDb(key, inspection)
      if (inspection.status === 'incompatible') {
        throw new IncompatibleWalletDbError(key, inspection)
      }
      return null
    }

    const walletEntry = entry as WalletDbEntry | WalletDbChunkManifest
    if (inspection.format === 'chunked') {
      const manifest = walletEntry as WalletDbChunkManifest
      const merged = await loadChunkedWalletDb(db, key, manifest)
      console.log(
        `[IndexedDB] Loaded ${merged.byteLength} bytes from ${manifest.chunkCount} chunk(s) for key: ${key} (version: ${manifest.metadata.version})`
      )
      return merged
    }

    const singleEntry = walletEntry as WalletDbEntry
    console.log(
      `[IndexedDB] Loaded ${singleEntry.data.byteLength} bytes for key: ${key} (version: ${singleEntry.metadata.version})`
    )
    return new Uint8Array(singleEntry.data)
  } catch (e) {
    if (e instanceof IncompatibleWalletDbError) throw e
    console.warn('[IndexedDB] Failed to load wallet db:', e)
    return null
  }
}

/**
 * Check whether a persisted wallet DB exists without loading full bytes.
 */
export async function hasWalletDb(key: string): Promise<boolean> {
  try {
    const db = await getConnection()
    const inspection = inspectWalletDbEntry(await readWalletDbEntry(db, key))
    reportIncompatibleWalletDb(key, inspection)
    return inspection.status === 'compatible' && inspection.totalBytes > 0
  } catch {
    return false
  }
}

/**
 * Close the database connection
 */
export function closeConnection(): void {
  if (dbConnection) {
    dbConnection.close()
    dbConnection = null
  }
}

export interface VotingStateEntry {
  readonly revision: string
  readonly bytes: Uint8Array
  readonly updatedAt: number
}

export function validateVotingCheckpoint(
  current: VotingStateEntry | undefined,
  bytes: Uint8Array,
  revision: bigint
): 'write' | 'unchanged' {
  if (revision < 0n) throw new Error('Voting checkpoint revision cannot be negative')
  if (!current) return 'write'

  let currentRevision: bigint
  try {
    currentRevision = BigInt(current.revision)
  } catch {
    throw new Error('Stored voting checkpoint revision is invalid')
  }
  if (currentRevision < 0n) throw new Error('Stored voting checkpoint revision is invalid')
  if (revision < currentRevision) {
    throw new Error(
      `Refusing stale voting checkpoint revision ${revision}; current revision is ${currentRevision}`
    )
  }
  if (revision === currentRevision) {
    const sameBytes =
      current.bytes.byteLength === bytes.byteLength &&
      current.bytes.every((byte, index) => byte === bytes[index])
    if (!sameBytes) throw new Error(`Conflicting voting checkpoint at revision ${revision}`)
    return 'unchanged'
  }
  return 'write'
}

export async function loadVotingState(key: string): Promise<VotingStateEntry | null> {
  const db = await getConnection()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VOTING_DATA_STORE_NAME, 'readonly')
    const request = transaction.objectStore(VOTING_DATA_STORE_NAME).get(key)
    request.onsuccess = () => {
      const entry = request.result as VotingStateEntry | undefined
      resolve(entry ? { ...entry, bytes: new Uint8Array(entry.bytes) } : null)
    }
    request.onerror = () => reject(request.error)
  })
}

export async function saveVotingState(
  key: string,
  bytes: Uint8Array,
  revision: bigint
): Promise<void> {
  const db = await getConnection()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VOTING_DATA_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(VOTING_DATA_STORE_NAME)
    const request = store.get(key)
    let validationError: Error | null = null

    request.onsuccess = () => {
      const current = request.result as VotingStateEntry | undefined
      try {
        if (validateVotingCheckpoint(current, bytes, revision) === 'unchanged') return
        store.put(
          { revision: revision.toString(), bytes: new Uint8Array(bytes), updatedAt: Date.now() },
          key
        )
      } catch (error) {
        validationError = error instanceof Error ? error : new Error('Invalid voting checkpoint')
        transaction.abort()
      }
    }

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(
        validationError ?? transaction.error ?? new Error('Voting checkpoint transaction aborted')
      )
  })
}

/**
 * Load transactions from IndexedDB
 * @param key - Storage key (e.g., "mainnet_walletId123_accountId456")
 */
export async function loadTransactions(key: string): Promise<Transaction[]> {
  try {
    const db = await getConnection()

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TRANSACTIONS_STORE_NAME, 'readonly')
      const store = transaction.objectStore(TRANSACTIONS_STORE_NAME)
      const request = store.get(key)

      request.onsuccess = () => {
        const transactions = normalizeTransactions(request.result)
        console.log(`[IndexedDB] Loaded ${transactions.length} transactions for key: ${key}`)
        resolve(transactions)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (e) {
    console.warn('[IndexedDB] Failed to load transactions:', e)
    return []
  }
}

/**
 * Atomically reads and replaces an account's transaction list.
 *
 * Keeping the read and write in one IndexedDB transaction prevents concurrent
 * background monitors, wallet-history refreshes, and popup updates from
 * overwriting each other's changes with stale snapshots.
 */
export async function mutateTransactions(
  key: string,
  updater: (transactions: Transaction[]) => Transaction[]
): Promise<Transaction[]> {
  const db = await getConnection()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRANSACTIONS_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(TRANSACTIONS_STORE_NAME)
    const request = store.get(key)
    let updatedTransactions: Transaction[] = []
    let updateError: unknown

    request.onsuccess = () => {
      try {
        updatedTransactions = updater(normalizeTransactions(request.result))
        store.put(updatedTransactions, key)
      } catch (error) {
        updateError = error
        transaction.abort()
      }
    }

    transaction.oncomplete = () => {
      console.log(`[IndexedDB] Updated ${updatedTransactions.length} transactions for key: ${key}`)
      resolve(updatedTransactions)
    }
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(updateError ?? transaction.error ?? new Error('Transaction update aborted'))
  })
}

/**
 * Delete transactions from IndexedDB
 * @param key - Storage key (e.g., "mainnet_walletId123_accountId456")
 */
export async function deleteTransactions(key: string): Promise<void> {
  const db = await getConnection()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRANSACTIONS_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(TRANSACTIONS_STORE_NAME)
    const request = store.delete(key)

    request.onsuccess = () => {
      console.log(`[IndexedDB] Deleted transactions for key: ${key}`)
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

/**
 * Save recent transparent transaction details used to reconstruct receive history.
 */
export async function saveTransparentTxCache(
  key: string,
  transactions: ReadonlyMap<string, VerboseTransaction>
): Promise<void> {
  const db = await getConnection()
  const value = Object.fromEntries(transactions)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME, 'readwrite')
    transaction.objectStore(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('Transparent transaction cache save aborted'))
  })
}

/**
 * Load cached transparent transaction details. Invalid persisted values are ignored.
 */
export async function loadTransparentTxCache(
  key: string
): Promise<Record<string, VerboseTransaction>> {
  try {
    const db = await getConnection()

    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME, 'readonly')
      const request = transaction.objectStore(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME).get(key)

      request.onsuccess = () => {
        resolve(normalizeTransparentTxCache(request.result))
      }
      request.onerror = () => reject(request.error)
    })
  } catch (error) {
    console.warn('[IndexedDB] Failed to load transparent transaction cache:', error)
    return {}
  }
}

/**
 * Delete persisted transparent transaction details for an account.
 */
export async function deleteTransparentTxCache(key: string): Promise<void> {
  const db = await getConnection()

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME, 'readwrite')
    transaction.objectStore(TRANSPARENT_TRANSACTION_CACHE_STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('Transparent transaction cache delete aborted'))
  })
}

// ============================================================================
// Journal Store - for resumable sync
// ============================================================================

export interface JournalManifest {
  walletKey: string
  baseSnapshotSeq: number
  nextSeq: number
  totalBytes: number
  createdAt: number
  updatedAt: number
}

interface JournalEntry {
  walletKey: string
  seq: number
  rangeStart: number
  rangeEnd: number
  data: Uint8Array
  committedAt: number
}

function journalWalletKey(network: string, walletId: string): string {
  return `${network}_${walletId}`
}

export async function getJournalManifest(
  network: string,
  walletId: string
): Promise<JournalManifest | null> {
  try {
    const db = await getConnection()
    const key = journalWalletKey(network, walletId)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(JOURNAL_MANIFEST_STORE_NAME, 'readonly')
      const store = tx.objectStore(JOURNAL_MANIFEST_STORE_NAME)
      const req = store.get(key)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.warn('[IndexedDB] Failed to load journal manifest:', e)
    return null
  }
}

export async function saveJournalManifest(manifest: JournalManifest): Promise<void> {
  const db = await getConnection()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(JOURNAL_MANIFEST_STORE_NAME, 'readwrite')
    const store = tx.objectStore(JOURNAL_MANIFEST_STORE_NAME)
    const req = store.put(manifest, manifest.walletKey)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * Append a journal entry, assigning its seq from the manifest inside a single
 * transaction so concurrent appends can never reuse (and overwrite) a seq.
 */
export async function appendJournalEntry(
  network: string,
  walletId: string,
  rangeStart: number,
  rangeEnd: number,
  data: Uint8Array
): Promise<number> {
  const db = await getConnection()
  const walletKey = journalWalletKey(network, walletId)

  return new Promise((resolve, reject) => {
    const tx = db.transaction([JOURNAL_STORE_NAME, JOURNAL_MANIFEST_STORE_NAME], 'readwrite')
    const journalStore = tx.objectStore(JOURNAL_STORE_NAME)
    const manifestStore = tx.objectStore(JOURNAL_MANIFEST_STORE_NAME)

    let assignedSeq = 0
    const mReq = manifestStore.get(walletKey)
    mReq.onsuccess = () => {
      const existing = mReq.result as JournalManifest | undefined
      assignedSeq = existing?.nextSeq ?? 0

      const entry: JournalEntry = {
        walletKey,
        seq: assignedSeq,
        rangeStart,
        rangeEnd,
        data,
        committedAt: Date.now()
      }
      journalStore.put(entry)

      const manifest: JournalManifest = {
        walletKey,
        baseSnapshotSeq: existing?.baseSnapshotSeq ?? 0,
        nextSeq: assignedSeq + 1,
        totalBytes: (existing?.totalBytes ?? 0) + data.byteLength,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      }
      manifestStore.put(manifest, walletKey)
    }

    tx.oncomplete = () => resolve(assignedSeq)
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadJournalEntries(
  network: string,
  walletId: string,
  fromSeq: number
): Promise<{ seq: number; rangeStart: number; rangeEnd: number; data: Uint8Array }[]> {
  try {
    const db = await getConnection()
    const walletKey = journalWalletKey(network, walletId)

    return new Promise((resolve, reject) => {
      const tx = db.transaction(JOURNAL_STORE_NAME, 'readonly')
      const store = tx.objectStore(JOURNAL_STORE_NAME)
      const index = store.index('byWallet')
      const results: { seq: number; rangeStart: number; rangeEnd: number; data: Uint8Array }[] = []

      const req = index.openCursor(IDBKeyRange.only(walletKey))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          const entry = cursor.value as JournalEntry
          if (entry.seq >= fromSeq) {
            results.push({
              seq: entry.seq,
              rangeStart: entry.rangeStart,
              rangeEnd: entry.rangeEnd,
              data: new Uint8Array(entry.data)
            })
          }
          cursor.continue()
        } else {
          results.sort((a, b) => a.seq - b.seq)
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  } catch (e) {
    console.warn('[IndexedDB] Failed to load journal entries:', e)
    return []
  }
}

export async function clearJournalEntries(
  network: string,
  walletId: string,
  upToSeq?: number
): Promise<void> {
  try {
    const db = await getConnection()
    const walletKey = journalWalletKey(network, walletId)

    return new Promise((resolve, reject) => {
      const tx = db.transaction([JOURNAL_STORE_NAME, JOURNAL_MANIFEST_STORE_NAME], 'readwrite')
      const journalStore = tx.objectStore(JOURNAL_STORE_NAME)
      const manifestStore = tx.objectStore(JOURNAL_MANIFEST_STORE_NAME)
      const index = journalStore.index('byWallet')

      const req = index.openCursor(IDBKeyRange.only(walletKey))
      let clearedBytes = 0
      let maxClearedSeq = -1

      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          const entry = cursor.value as JournalEntry
          if (upToSeq === undefined || entry.seq <= upToSeq) {
            clearedBytes += entry.data.byteLength
            if (entry.seq > maxClearedSeq) maxClearedSeq = entry.seq
            cursor.delete()
          }
          cursor.continue()
        } else if (maxClearedSeq >= 0) {
          const mReq = manifestStore.get(walletKey)
          mReq.onsuccess = () => {
            const m = mReq.result as JournalManifest | undefined
            if (m) {
              m.baseSnapshotSeq = (upToSeq ?? maxClearedSeq) + 1
              m.totalBytes = Math.max(0, m.totalBytes - clearedBytes)
              m.updatedAt = Date.now()
              manifestStore.put(m, walletKey)
            }
          }
        }
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (e) {
    console.warn('[IndexedDB] Failed to clear journal entries:', e)
  }
}

export interface WalletPersistenceQuarantineExport {
  readonly record: WalletPersistenceQuarantineRecord
  readonly snapshotEntry: unknown
  readonly snapshotChunks: readonly unknown[]
  readonly journalManifest: unknown
  readonly journalEntries: readonly unknown[]
}

/**
 * Reads retained recovery data without making it active again.
 * The caller is responsible for serializing binary values to an export format.
 */
export async function exportWalletPersistenceQuarantine(
  key: string,
  network: string,
  walletId: string
): Promise<WalletPersistenceQuarantineExport> {
  const db = await getConnection()
  const record = await readWalletPersistenceQuarantine(db, key)
  if (!record) throw new Error(`Wallet persistence is not quarantined: ${key}`)
  if (record.network !== network || record.walletId !== walletId) {
    throw new Error('Quarantine scope does not match the requested wallet')
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [STORE_NAME, JOURNAL_STORE_NAME, JOURNAL_MANIFEST_STORE_NAME],
      'readonly'
    )
    const snapshotRequest = transaction.objectStore(STORE_NAME).get(key)
    const chunksRequest = transaction.objectStore(STORE_NAME).getAll(walletDbChunkRange(key))
    const journalStore = transaction.objectStore(JOURNAL_STORE_NAME)
    const journalRequest = journalStore
      .index('byWallet')
      .getAll(IDBKeyRange.only(journalWalletKey(network, walletId)))
    const manifestRequest = transaction
      .objectStore(JOURNAL_MANIFEST_STORE_NAME)
      .get(journalWalletKey(network, walletId))

    transaction.oncomplete = () =>
      resolve(
        Object.freeze({
          record,
          snapshotEntry: snapshotRequest.result,
          snapshotChunks: Object.freeze(chunksRequest.result),
          journalManifest: manifestRequest.result,
          journalEntries: Object.freeze(journalRequest.result)
        })
      )
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB quarantine export transaction aborted'))
  })
}

/**
 * Explicit recovery cleanup. Snapshot, dependent journal and quarantine marker
 * are removed in one IndexedDB transaction.
 */
export async function deleteWalletPersistenceAndQuarantine(
  key: string,
  network: string,
  walletId: string
): Promise<void> {
  const db = await getConnection()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [
        STORE_NAME,
        JOURNAL_STORE_NAME,
        JOURNAL_MANIFEST_STORE_NAME,
        WALLET_PERSISTENCE_QUARANTINE_STORE_NAME
      ],
      'readwrite'
    )
    const snapshotStore = transaction.objectStore(STORE_NAME)
    snapshotStore.delete(key)
    snapshotStore.delete(walletDbChunkRange(key))

    const walletKey = journalWalletKey(network, walletId)
    const journalRequest = transaction
      .objectStore(JOURNAL_STORE_NAME)
      .index('byWallet')
      .openCursor(IDBKeyRange.only(walletKey))
    journalRequest.onsuccess = () => {
      const cursor = journalRequest.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    transaction.objectStore(JOURNAL_MANIFEST_STORE_NAME).delete(walletKey)
    transaction.objectStore(WALLET_PERSISTENCE_QUARANTINE_STORE_NAME).delete(key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB explicit recovery cleanup aborted'))
  })
}

export async function deleteVotingStatesForWallet(
  network: string,
  walletId: string
): Promise<void> {
  const db = await getConnection()
  const prefix = `${network}_${walletId}_`
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VOTING_DATA_STORE_NAME, 'readwrite')
    const request = transaction.objectStore(VOTING_DATA_STORE_NAME).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) cursor.delete()
      cursor.continue()
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('Voting state cleanup transaction aborted'))
  })
}

export async function deleteVotingState(key: string): Promise<void> {
  const db = await getConnection()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VOTING_DATA_STORE_NAME, 'readwrite')
    transaction.objectStore(VOTING_DATA_STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('Voting state delete transaction aborted'))
  })
}

/**
 * Explicit full-wallet reset. Removes every wallet-owned IndexedDB record,
 * including orphaned data that no longer has a metadata entry.
 */
export async function deleteAllWalletData(): Promise<void> {
  const db = await getConnection()
  return new Promise((resolve, reject) => {
    const storeNames = [
      STORE_NAME,
      TRANSACTIONS_STORE_NAME,
      TRANSPARENT_TRANSACTION_CACHE_STORE_NAME,
      VOTING_DATA_STORE_NAME,
      JOURNAL_STORE_NAME,
      JOURNAL_MANIFEST_STORE_NAME,
      WALLET_PERSISTENCE_QUARANTINE_STORE_NAME
    ]
    const transaction = db.transaction(storeNames, 'readwrite')
    for (const storeName of storeNames) {
      transaction.objectStore(storeName).clear()
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error || new Error('IndexedDB full wallet reset aborted'))
  })
}
