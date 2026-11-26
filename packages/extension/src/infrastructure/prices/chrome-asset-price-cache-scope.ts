import type { Network } from '@/types'

export class ChromeAssetPriceCacheScope {
  constructor(
    private readonly network: Network,
    private readonly isCurrent: () => boolean
  ) {}

  async read(key: string): Promise<unknown> {
    const scopedKey = this.key(key)
    return (await chrome.storage.local.get(scopedKey))[scopedKey]
  }

  async write(key: string, value: unknown): Promise<void> {
    if (this.isCurrent()) await chrome.storage.local.set({ [this.key(key)]: value })
  }

  async remove(key: string): Promise<void> {
    if (this.isCurrent()) await chrome.storage.local.remove(this.key(key))
  }

  private key(key: string): string {
    return `asset-prices:${this.network}:${key}`
  }
}
