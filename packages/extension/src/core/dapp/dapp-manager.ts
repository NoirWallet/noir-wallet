/** Reference to a specific account within a specific wallet. */
export interface AccountRef {
  walletId: string
  accountId: string
}

export interface ConnectedDApp {
  id: string
  name: string
  host: string
  origin: string
  favicon: string
  connectedAt: number
  lastActiveAt: number
  boundWalletId?: string
  boundAccountId?: string
  /**
   * Accounts authorized via batch (multi-wallet) connection. Independent of the
   * single-account `boundWalletId`/`boundAccountId` binding, so legacy flows are
   * unaffected. Absent for connections that only used single-account connect.
   */
  authorizedAccounts?: AccountRef[]
}

const STORAGE_KEY = 'connectedDApps'
const AUTHORIZATION_KEY = 'dapp_authorization_state'
interface AuthorizationState {
  revision: number
  mode: 'approved' | 'revoked'
}

function parseAuthorizationState(value: unknown): Record<string, AuthorizationState> {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Site authorization storage is unavailable')
  }
  const states: Record<string, AuthorizationState> = {}
  for (const [origin, entry] of Object.entries(value)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('revision' in entry) ||
      typeof entry.revision !== 'number' ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 0 ||
      !('mode' in entry) ||
      (entry.mode !== 'approved' && entry.mode !== 'revoked')
    ) {
      throw new Error('Site authorization storage is unavailable')
    }
    states[origin] = { revision: entry.revision, mode: entry.mode }
  }
  return states
}

function isAccountRef(value: unknown): value is AccountRef {
  if (typeof value !== 'object' || value === null) return false
  const { walletId, accountId } = value as Partial<AccountRef>
  return (
    typeof walletId === 'string' &&
    walletId.length > 0 &&
    typeof accountId === 'string' &&
    accountId.length > 0
  )
}

/**
 * Every account associated with a connection: the batch-authorized set united
 * with the single-account binding, so legacy connections that predate
 * `authorizedAccounts` still resolve to their bound account.
 */
export function getConnectionAccountRefs(dapp: ConnectedDApp): AccountRef[] {
  const refs = Array.isArray(dapp.authorizedAccounts)
    ? dapp.authorizedAccounts.filter(isAccountRef)
    : []
  const binding = { walletId: dapp.boundWalletId, accountId: dapp.boundAccountId }
  if (
    isAccountRef(binding) &&
    !refs.some(a => a.walletId === binding.walletId && a.accountId === binding.accountId)
  ) {
    refs.push(binding)
  }
  return refs
}

export class DAppManager {
  private static instance: DAppManager
  private connectedDApps: Map<string, ConnectedDApp> = new Map()
  private authorizationState: Record<string, AuthorizationState> = {}
  private mutations: Promise<unknown> = Promise.resolve()

  private constructor() {}

  static getInstance(): DAppManager {
    if (!DAppManager.instance) {
      DAppManager.instance = new DAppManager()
    }
    return DAppManager.instance
  }

  async initialize(): Promise<void> {
    await this.mutate(() => {})
  }

  private async loadStorage(): Promise<void> {
    const result = await chrome.storage.local.get([STORAGE_KEY, AUTHORIZATION_KEY])
    const stored = result[STORAGE_KEY]
    this.connectedDApps.clear()
    if (stored && Array.isArray(stored)) {
      stored.forEach((dapp: ConnectedDApp) => {
        this.connectedDApps.set(dapp.origin, dapp)
      })
    }
    this.authorizationState = parseAuthorizationState(result[AUTHORIZATION_KEY])
  }

  private mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    const run = async () => {
      const commit = async () => {
        await this.loadStorage()
        return operation()
      }
      return typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request('noir-dapp-authorization', commit)
        : commit()
    }
    const result = this.mutations.then(run, run)
    this.mutations = result.catch(() => {})
    return result
  }

  async getAuthorizationRevision(origin: string): Promise<number> {
    return this.mutate(() => this.authorizationState[origin]?.revision ?? 0)
  }

  async canAutoConnect(origin: string): Promise<boolean> {
    return this.mutate(() => !this.authorizationState[origin])
  }

  async isRevoked(origin: string): Promise<boolean> {
    return this.mutate(() => this.authorizationState[origin]?.mode === 'revoked')
  }

  /**
   * Persist the set of batch-authorized accounts for an origin, creating the
   * connection if it does not exist yet. The first account also seeds the
   * single-account binding when none is set, so legacy methods keep working.
   */
  async setAuthorizedAccounts(
    origin: string,
    tabInfo: { title?: string; favIconUrl?: string },
    accounts: AccountRef[],
    authorization?: { automatic?: boolean; expectedRevision?: number }
  ): Promise<void> {
    return this.mutate(async () => {
      const state = this.authorizationState[origin]
      if (
        (authorization?.automatic && state) ||
        (authorization?.expectedRevision !== undefined &&
          authorization.expectedRevision !== (state?.revision ?? 0))
      )
        throw new Error('Site authorization changed. Connect again.')
      const primary = accounts[0]
      const existing = this.connectedDApps.get(origin)

      if (existing) {
        existing.authorizedAccounts = accounts
        existing.lastActiveAt = Date.now()
        if (primary) {
          existing.boundWalletId = primary.walletId
          existing.boundAccountId = primary.accountId
        }
      } else {
        const host = new URL(origin).host
        this.connectedDApps.set(origin, {
          id: this.generateId(origin),
          name: tabInfo.title || host,
          host,
          origin,
          favicon: tabInfo.favIconUrl || this.getDefaultFavicon(origin),
          connectedAt: Date.now(),
          lastActiveAt: Date.now(),
          boundWalletId: primary?.walletId,
          boundAccountId: primary?.accountId,
          authorizedAccounts: accounts
        })
      }

      if (!authorization?.automatic) {
        this.authorizationState[origin] = { revision: state?.revision ?? 0, mode: 'approved' }
      }
      await this.saveToStorage()
    })
  }

  /** Union of batch-authorized accounts and the single-account binding. */
  async getAuthorizedAccounts(origin: string): Promise<AccountRef[]> {
    return (await this.getAuthorization(origin)).accounts
  }

  async getAuthorization(origin: string): Promise<{ revision: number; accounts: AccountRef[] }> {
    return this.mutate(() => {
      const dapp = this.connectedDApps.get(origin)
      return {
        revision: this.authorizationState[origin]?.revision ?? 0,
        accounts:
          dapp && this.authorizationState[origin]?.mode !== 'revoked'
            ? getConnectionAccountRefs(dapp)
            : []
      }
    })
  }

  /**
   * Add one account to an existing connection's authorized set (wallet-side
   * "Connect" prompt). No-op when the connection is missing or the account is
   * already authorized.
   */
  async addAuthorizedAccount(origin: string, account: AccountRef): Promise<void> {
    return this.mutate(async () => {
      const dapp = this.connectedDApps.get(origin)
      if (!dapp) return

      const refs = getConnectionAccountRefs(dapp)
      if (!refs.some(a => a.walletId === account.walletId && a.accountId === account.accountId)) {
        refs.push(account)
      }
      dapp.authorizedAccounts = refs
      dapp.lastActiveAt = Date.now()
      await this.saveToStorage()
    })
  }

  async updateConnectionBinding(
    origin: string,
    binding: { walletId: string; accountId: string }
  ): Promise<void> {
    return this.mutate(async () => {
      const d = this.connectedDApps.get(origin)
      if (!d) return
      d.boundWalletId = binding.walletId
      d.boundAccountId = binding.accountId
      d.lastActiveAt = Date.now()
      await this.saveToStorage()
    })
  }

  async removeConnection(origin: string): Promise<void> {
    return this.mutate(async () => {
      this.authorizationState[origin] = {
        revision: (this.authorizationState[origin]?.revision ?? 0) + 1,
        mode: 'revoked'
      }
      this.connectedDApps.delete(origin)
      await this.saveToStorage()
    })
  }

  async updateLastActive(origin: string): Promise<void> {
    return this.mutate(async () => {
      const dapp = this.connectedDApps.get(origin)
      if (dapp) {
        dapp.lastActiveAt = Date.now()
        await this.saveToStorage()
      }
    })
  }

  async getConnection(origin: string): Promise<ConnectedDApp | null> {
    return this.mutate(() => this.connectedDApps.get(origin) || null)
  }

  async getAllConnections(): Promise<ConnectedDApp[]> {
    return this.mutate(() =>
      Array.from(this.connectedDApps.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    )
  }

  async isConnected(origin: string): Promise<boolean> {
    return this.mutate(() => this.connectedDApps.has(origin))
  }

  async getCurrentTabDApp(): Promise<ConnectedDApp | null> {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const currentTab = tabs[0]

      if (!currentTab?.url) return null

      const url = new URL(currentTab.url)
      const origin = url.origin

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return null
      }

      return await this.getConnection(origin)
    } catch (error) {
      console.error('Failed to get current tab dApp:', error)
      return null
    }
  }

  private async saveToStorage(): Promise<void> {
    const dapps = Array.from(this.connectedDApps.values())
    await chrome.storage.local.set({
      [STORAGE_KEY]: dapps,
      [AUTHORIZATION_KEY]: this.authorizationState
    })
  }

  private generateId(origin: string): string {
    return `dapp_${Date.now()}_${origin.replace(/[^a-zA-Z0-9]/g, '_')}`
  }

  private getDefaultFavicon(origin: string): string {
    try {
      const url = new URL(origin)
      return `${url.origin}/favicon.ico`
    } catch {
      return ''
    }
  }
}

export const dappManager = DAppManager.getInstance()
