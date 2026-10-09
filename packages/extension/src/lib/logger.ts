import { useWalletStore } from '@/store/wallet-store'
import {
  getDiagnosticErrorDetails,
  serializeDiagnosticArgs,
  type DiagnosticLogDraft,
  type DiagnosticLogLevel,
  type DiagnosticLogSource
} from './diagnostic-log'

const isServiceWorker =
  typeof self !== 'undefined' &&
  'ServiceWorkerGlobalScope' in self &&
  self instanceof (self as any).ServiceWorkerGlobalScope
const debugLogsEnabled = typeof __DEBUG_LOGS__ !== 'boolean' || __DEBUG_LOGS__
const diagnosticSource: DiagnosticLogSource = isServiceWorker
  ? 'background'
  : typeof location !== 'undefined' && location.pathname.includes('/offscreen/')
    ? 'offscreen'
    : 'popup'
const diagnosticContextId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

interface AddressInfo {
  shielded: string
  transparent: string
  walletId: string
}

class WalletLogger {
  private addressCache = new Map<string, AddressInfo>()
  private walletNameCache = new Map<string, string>()
  private currentAccountId: string | null = null
  private diagnosticSequence = 0
  private diagnosticSaltPromise: Promise<string> | null = null
  private diagnosticWriter: ((entry: DiagnosticLogDraft) => Promise<void>) | null = null

  configureDiagnostics(
    getSalt: () => Promise<string>,
    write: (entry: DiagnosticLogDraft) => Promise<void>
  ): void {
    this.diagnosticSaltPromise = getSalt()
    this.diagnosticWriter = write
  }

  log(msg: string, walletId?: string, accountId?: string, error?: unknown): void {
    const prefix = this.getPrefix(walletId, accountId)
    this.persistDiagnostic('debug', msg, walletId, accountId, error)
    if (!debugLogsEnabled) return
    console.log(prefix, msg)
  }

  info(msg: string, walletId?: string, accountId?: string, error?: unknown): void {
    const prefix = this.getPrefix(walletId, accountId)
    this.persistDiagnostic('info', msg, walletId, accountId, error)
    console.info(prefix, msg)
  }

  warn(msg: string, walletId?: string, accountId?: string, error?: unknown): void {
    const prefix = this.getPrefix(walletId, accountId)
    this.persistDiagnostic('warn', msg, walletId, accountId, error)
    console.warn(prefix, msg)
  }

  error(msg: string, walletId?: string, accountId?: string, error?: unknown): void {
    const prefix = this.getPrefix(walletId, accountId)
    this.persistDiagnostic('error', msg, walletId, accountId, error)
    if (isServiceWorker) {
      console.warn(prefix, '[ERROR]', msg)
    } else {
      console.error(prefix, msg)
    }
  }

  private getDiagnosticSalt(): Promise<string> {
    if (!this.diagnosticSaltPromise) {
      this.diagnosticSaltPromise = chrome.runtime
        .sendMessage({ type: 'GET_DIAGNOSTIC_LOG_SALT' })
        .then(response => {
          if (!response?.success || typeof response.salt !== 'string') {
            throw new Error('Diagnostic salt unavailable')
          }
          return response.salt
        })
        .catch(error => {
          this.diagnosticSaltPromise = null
          throw error
        })
    }
    return this.diagnosticSaltPromise
  }

  private persistDiagnostic(
    level: DiagnosticLogLevel,
    msg: string,
    walletId?: string,
    accountId?: string,
    error?: unknown
  ): void {
    const timestamp = Date.now()
    const sequence = this.diagnosticSequence++
    void this.getDiagnosticSalt()
      .then(salt => {
        const args: unknown[] = [msg, { walletId, accountId }]
        if (error !== undefined) args.push({ error: getDiagnosticErrorDetails(error) })
        return serializeDiagnosticArgs(args, salt)
      })
      .then(message => {
        const entry: DiagnosticLogDraft = {
          source: diagnosticSource,
          level,
          message,
          timestamp,
          contextId: diagnosticContextId,
          sequence
        }
        return this.diagnosticWriter
          ? this.diagnosticWriter(entry)
          : chrome.runtime.sendMessage({ type: 'APPEND_DIAGNOSTIC_LOG', entry })
      })
      .catch(() => {})
  }

  getPrefix(walletId?: string, accountId?: string, useCurrentFallback = true): string {
    if (!walletId) return '[Log]'

    const targetAccountId = accountId

    if (targetAccountId) {
      const cached = this.addressCache.get(targetAccountId)
      if (cached) {
        return this.formatPrefix(cached.walletId, `${cached.shielded}-${cached.transparent}`)
      }
      return this.formatPrefix(walletId, targetAccountId.slice(0, 6))
    }

    return this.formatPrefix(walletId)
  }

  getSyncPrefix(walletId: string, accountId: string): string {
    const cached = this.addressCache.get(accountId)
    const accountLabel = cached ? `${cached.shielded}-${cached.transparent}` : accountId.slice(0, 6)
    return this.formatPrefix(cached?.walletId || walletId, accountLabel)
  }

  getWalletLabel(walletId: string): string {
    return this.walletNameCache.get(walletId) || walletId.slice(0, 6)
  }

  private formatPrefix(walletId: string, accountLabel?: string): string {
    const walletName = this.walletNameCache.get(walletId) || walletId.slice(0, 6)
    return accountLabel ? `[${walletName}:${accountLabel}]` : `[${walletName}]`
  }

  async refreshCache(): Promise<void> {
    try {
      const { wallets, currentAccountId } = useWalletStore.getState()
      if (!wallets.length) return

      this.currentAccountId = currentAccountId || null

      this.addressCache.clear()
      this.walletNameCache.clear()

      for (let i = 0; i < wallets.length; i++) {
        const wallet = wallets[i]
        const displayName =
          wallet.name.match(/^Wallet \d+$/) && wallet.name.length > 15
            ? `Wallet ${i + 1}`
            : wallet.name
        this.walletNameCache.set(wallet.id, displayName)

        for (const account of wallet.accounts) {
          const shielded = account.addresses?.shielded?.slice(-4) || 'none'
          const transparent = account.addresses?.transparent?.slice(-4) || 'none'
          this.addressCache.set(account.id, { shielded, transparent, walletId: wallet.id })
        }
      }
    } catch (e) {
      console.error('[WalletLogger] Failed to refresh cache:', e)
    }
  }

  clearCache(): void {
    this.addressCache.clear()
    this.walletNameCache.clear()
    this.currentAccountId = null
  }
}

export const logger = new WalletLogger()
