import { ASSET_PRICE_PORT, type AssetPriceSnapshot } from '@/core/prices/asset-price-channel'
import { parseAssetPriceReadModel } from '@/core/prices'
import type { Network } from '@/types'

type PriceMessenger = (message: {
  type: 'REFRESH_ASSET_PRICES'
  network: Network
  assetId?: string
}) => Promise<unknown>

export function parseAssetPriceSnapshot(value: unknown): AssetPriceSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid asset price snapshot')
  const { network, revision, prices } = value as AssetPriceSnapshot
  if (
    (network !== 'mainnet' && network !== 'testnet') ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw new Error('Invalid asset price snapshot')
  return Object.freeze({
    network,
    revision,
    prices: prices === null ? null : parseAssetPriceReadModel(prices)
  })
}

export class AssetPriceClient {
  private snapshot: AssetPriceSnapshot | null = null
  private connection: chrome.runtime.Port | null = null
  private reconnect: ReturnType<typeof setTimeout> | undefined
  private readonly listeners = new Set<() => void>()

  constructor(private readonly sendMessage: PriceMessenger) {}

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    this.connect()
    return () => {
      this.listeners.delete(listener)
    }
  }

  async refresh(network: Network, assetId?: string) {
    const response = await this.sendMessage({
      type: 'REFRESH_ASSET_PRICES',
      network,
      ...(assetId ? { assetId } : {})
    })
    if (
      !response ||
      typeof response !== 'object' ||
      !('result' in response) ||
      Object.keys(response).length !== 1
    ) {
      throw new Error('Invalid asset price response')
    }
    return response.result === null ? null : parseAssetPriceReadModel(response.result)
  }

  private connect(): void {
    if (this.connection || this.reconnect || typeof document === 'undefined') return
    const port = chrome.runtime.connect({ name: ASSET_PRICE_PORT })
    this.connection = port
    let revision = -1
    const notify = () => port.postMessage(document.visibilityState === 'visible')
    port.onMessage.addListener((message: unknown) => {
      if (this.connection !== port) return
      try {
        const incoming = parseAssetPriceSnapshot(message)
        if (incoming.revision <= revision) return
        if (revision === -1) notify()
        revision = incoming.revision
        if (incoming.prices === null && this.snapshot?.network === incoming.network) return
        this.snapshot = incoming
        this.listeners.forEach(listener => listener())
      } catch {}
    })
    document.addEventListener('visibilitychange', notify)
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError
      document.removeEventListener('visibilitychange', notify)
      if (this.connection !== port) return
      this.connection = null
      this.reconnect = setTimeout(() => {
        this.reconnect = undefined
        if (document.visibilityState === 'visible') this.connect()
        else document.addEventListener('visibilitychange', this.resume, { once: true })
      }, 1_000)
    })
  }

  private resume = () => this.connect()
}

export const assetPriceClient = new AssetPriceClient(message => chrome.runtime.sendMessage(message))
