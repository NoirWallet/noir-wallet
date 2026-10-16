const STORAGE_PREFIX = 'walletconnect_v1:'

/** WalletConnect cryptographic state survives worker suspension, but not browser exit. */
export class WalletConnectStorage {
  constructor(
    private readonly storage: chrome.storage.SessionStorageArea = chrome.storage.session
  ) {}

  async getKeys(): Promise<string[]> {
    return Object.keys(await this.storage.get(null))
      .filter(key => key.startsWith(STORAGE_PREFIX))
      .map(key => key.slice(STORAGE_PREFIX.length))
  }

  async getEntries<T = unknown>(): Promise<[string, T][]> {
    const values = await this.storage.get(null)
    return Object.entries(values)
      .filter(([key]) => key.startsWith(STORAGE_PREFIX))
      .map(([key, value]) => [key.slice(STORAGE_PREFIX.length), value as T])
  }

  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    const values = await this.storage.get(STORAGE_PREFIX + key)
    return values[STORAGE_PREFIX + key] as T | undefined
  }

  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    await this.storage.set({ [STORAGE_PREFIX + key]: value })
  }

  async removeItem(key: string): Promise<void> {
    await this.storage.remove(STORAGE_PREFIX + key)
  }
}
