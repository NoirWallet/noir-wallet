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
  private initialized = false

  private constructor() {}

  static getInstance(): DAppManager {
    if (!DAppManager.instance) {
      DAppManager.instance = new DAppManager()
    }
    return DAppManager.instance
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      const stored = result[STORAGE_KEY]

      if (stored && Array.isArray(stored)) {
        stored.forEach((dapp: ConnectedDApp) => {
          this.connectedDApps.set(dapp.origin, dapp)
        })
      }
      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize DAppManager:', error)
    }
  }

  /**
   * Persist the set of batch-authorized accounts for an origin, creating the
   * connection if it does not exist yet. The first account also seeds the
   * single-account binding when none is set, so legacy methods keep working.
   */
  async setAuthorizedAccounts(
    origin: string,
    tabInfo: { title?: string; favIconUrl?: string },
    accounts: AccountRef[]
  ): Promise<void> {
    await this.initialize()
    const primary = accounts[0]
    const existing = this.connectedDApps.get(origin)

    if (existing) {
      existing.authorizedAccounts = accounts
      existing.lastActiveAt = Date.now()
      if (existing.boundWalletId == null && primary) {
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

    await this.saveToStorage()
  }

  /** Union of batch-authorized accounts and the single-account binding. */
  async getAuthorizedAccounts(origin: string): Promise<AccountRef[]> {
    await this.initialize()
    const dapp = this.connectedDApps.get(origin)
    return dapp ? getConnectionAccountRefs(dapp) : []
  }

  /**
   * Add one account to an existing connection's authorized set (wallet-side
   * "Connect" prompt). No-op when the connection is missing or the account is
   * already authorized.
   */
  async addAuthorizedAccount(origin: string, account: AccountRef): Promise<void> {
    await this.initialize()
    const dapp = this.connectedDApps.get(origin)
    if (!dapp) return

    const refs = getConnectionAccountRefs(dapp)
    if (!refs.some(a => a.walletId === account.walletId && a.accountId === account.accountId)) {
      refs.push(account)
    }
    dapp.authorizedAccounts = refs
    dapp.lastActiveAt = Date.now()
    await this.saveToStorage()
  }

  async updateConnectionBinding(
    origin: string,
    binding: { walletId: string; accountId: string }
  ): Promise<void> {
    await this.initialize()
    const d = this.connectedDApps.get(origin)
    if (!d) return
    d.boundWalletId = binding.walletId
    d.boundAccountId = binding.accountId
    d.lastActiveAt = Date.now()
    await this.saveToStorage()
  }

  async removeConnection(origin: string): Promise<void> {
    await this.initialize()
    this.connectedDApps.delete(origin)
    await this.saveToStorage()
  }

  async updateLastActive(origin: string): Promise<void> {
    await this.initialize()
    const dapp = this.connectedDApps.get(origin)
    if (dapp) {
      dapp.lastActiveAt = Date.now()
      await this.saveToStorage()
    }
  }

  async getConnection(origin: string): Promise<ConnectedDApp | null> {
    await this.initialize()
    return this.connectedDApps.get(origin) || null
  }

  async getAllConnections(): Promise<ConnectedDApp[]> {
    await this.initialize()
    return Array.from(this.connectedDApps.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  async isConnected(origin: string): Promise<boolean> {
    await this.initialize()
    return this.connectedDApps.has(origin)
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
    await chrome.storage.local.set({ [STORAGE_KEY]: dapps })
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
