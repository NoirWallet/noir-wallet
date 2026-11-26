import {
  ASSET_MARKET_CHANGE_EXPIRES_MS,
  ASSET_MARKET_CHANGE_FRESH_MS,
  ASSET_PRICE_EXPIRES_MS,
  ASSET_PRICE_FRESH_MS,
  ASSET_PRICE_QUOTE_SOURCES,
  ASSET_PRICE_SOURCE,
  MAXIMUM_ASSET_PRICE_ITEMS,
  normalizePriceAssetId,
  normalizeUsdPrice,
  type AssetPriceQuote,
  type AssetPriceReadModel
} from '@/core/prices/asset-price'
import {
  ASSET_PRICE_ALARM,
  ASSET_PRICE_CHECK_MS,
  type AssetPriceSnapshot
} from '@/core/prices/asset-price-channel'
import type { Network } from '@/types'

interface AssetPriceSources {
  readCached(): Promise<AssetPriceReadModel>
  refresh(assetId?: string): Promise<AssetPriceReadModel>
}

export interface CatalogPriceObservation {
  readonly assetId: string
  readonly priceUsd: string | number
  readonly updatedAt: string
  readonly provider: 'rhea' | 'confidential'
}

function agePrimaryQuote(quote: AssetPriceQuote, now: number): AssetPriceQuote | null {
  const isDex = quote.source === ASSET_PRICE_QUOTE_SOURCES.dexScreener
  const age = now - quote.sourceUpdatedAt
  if (age > (isDex ? ASSET_MARKET_CHANGE_EXPIRES_MS : ASSET_PRICE_EXPIRES_MS)) return null
  const freshness =
    age > (isDex ? ASSET_MARKET_CHANGE_FRESH_MS : ASSET_PRICE_FRESH_MS) ? 'stale' : quote.freshness
  const { marketChange, ...price } = quote
  const changeAge = marketChange ? now - marketChange.fetchedAt : 0
  return Object.freeze({
    ...price,
    freshness,
    ...(marketChange && changeAge <= ASSET_MARKET_CHANGE_EXPIRES_MS
      ? {
          marketChange: Object.freeze({
            ...marketChange,
            freshness:
              changeAge > ASSET_MARKET_CHANGE_FRESH_MS ? ('stale' as const) : marketChange.freshness
          })
        }
      : {})
  })
}

export function resolveAssetPriceSnapshot(
  primary: AssetPriceReadModel | null,
  observations: readonly CatalogPriceObservation[],
  now: number
): AssetPriceReadModel {
  const quotes = new Map<string, AssetPriceQuote>()
  const missing = new Set(primary?.missingAssetIds)
  for (const quote of primary?.quotes ?? []) {
    if (quotes.size >= MAXIMUM_ASSET_PRICE_ITEMS) break
    const current = agePrimaryQuote(quote, now)
    if (current) quotes.set(current.assetId, current)
    else missing.add(quote.assetId)
  }
  const candidates = new Map<string, AssetPriceQuote>()
  for (const observation of observations) {
    let assetId: string
    try {
      assetId = normalizePriceAssetId(observation.assetId)
    } catch {
      continue
    }
    if (quotes.get(assetId)?.freshness === 'fresh') continue
    const updatedAt = Date.parse(observation.updatedAt)
    const age = now - updatedAt
    if (
      !Number.isFinite(updatedAt) ||
      updatedAt <= 0 ||
      age < -ASSET_PRICE_FRESH_MS ||
      age > ASSET_PRICE_EXPIRES_MS
    )
      continue
    const priceUsd = normalizeUsdPrice(observation.priceUsd)
    if (!priceUsd) continue
    const current = candidates.get(assetId)
    if (
      current &&
      (current.sourceUpdatedAt > updatedAt ||
        (current.sourceUpdatedAt === updatedAt && observation.provider !== 'confidential'))
    )
      continue
    candidates.set(
      assetId,
      Object.freeze({
        assetId,
        source:
          observation.provider === 'confidential'
            ? ASSET_PRICE_QUOTE_SOURCES.confidentialCatalog
            : ASSET_PRICE_QUOTE_SOURCES.swapCatalog,
        priceUsd,
        sourceUpdatedAt: updatedAt,
        fetchedAt: updatedAt,
        freshness: age <= ASSET_PRICE_FRESH_MS ? 'fresh' : 'stale'
      })
    )
  }
  for (const [assetId, candidate] of candidates) {
    const current = quotes.get(assetId)
    if (candidate.freshness === 'stale' && current) continue
    if (!current && quotes.size >= MAXIMUM_ASSET_PRICE_ITEMS) continue
    quotes.set(assetId, candidate)
    missing.delete(assetId)
  }
  const resolved = Object.freeze([...quotes.values()])
  return Object.freeze({
    source: ASSET_PRICE_SOURCE,
    status:
      resolved.length === 0
        ? 'error'
        : missing.size > 0 || resolved.some(quote => quote.freshness === 'stale')
          ? 'partial'
          : 'ready',
    fetchedAt: resolved.reduce(
      (latest, quote) => Math.max(latest, quote.fetchedAt),
      primary?.fetchedAt ?? 0
    ),
    quotes: resolved,
    missingAssetIds: Object.freeze([...missing].slice(0, MAXIMUM_ASSET_PRICE_ITEMS))
  })
}

export class AssetPriceStore {
  private sources!: AssetPriceSources
  private generation = 0
  private tail: Promise<unknown> = Promise.resolve()
  private hydration: Promise<unknown> = Promise.resolve()
  private readonly refreshes = new Map<string, Promise<AssetPriceReadModel | null>>()
  private readonly ports = new Map<chrome.runtime.Port, boolean>()
  private snapshot: AssetPriceSnapshot
  private primary: AssetPriceReadModel | null = null
  private serializedPrices = ''
  private alarmQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly network: Network,
    createSources: (isCurrent: () => boolean) => AssetPriceSources,
    private readonly readCatalog: () => readonly CatalogPriceObservation[],
    private readonly now = Date.now
  ) {
    this.snapshot = Object.freeze({ network, revision: 0, prices: null })
    this.replaceSources(createSources)
  }

  replaceSources(createSources: (isCurrent: () => boolean) => AssetPriceSources): void {
    const generation = ++this.generation
    this.sources = createSources(() => generation === this.generation)
    this.refreshes.clear()
    this.hydration = this.enqueue(generation, sources => sources.readCached())
    if (this.hasVisibleConsumer()) void this.refresh()
  }

  async readCached(): Promise<AssetPriceReadModel> {
    await this.hydration
    this.catalogChanged()
    return this.snapshot.prices ?? resolveAssetPriceSnapshot(null, [], this.now())
  }

  catalogChanged(): void {
    if (this.snapshot.prices) this.publish(this.primary)
  }

  refresh(assetId?: string): Promise<AssetPriceReadModel | null> {
    const key = assetId ?? '*'
    const existing = this.refreshes.get('*') ?? this.refreshes.get(key)
    if (existing) return existing
    const operation = this.enqueue(this.generation, async sources => {
      try {
        return await sources.refresh(assetId)
      } catch {
        return sources.readCached()
      }
    })
    this.refreshes.set(key, operation)
    void operation.then(() => {
      if (this.refreshes.get(key) === operation) this.refreshes.delete(key)
    })
    return operation
  }

  attach(port: chrome.runtime.Port): void {
    this.ports.set(port, false)
    port.onDisconnect.addListener(() => {
      const wasVisible = this.ports.get(port)
      this.ports.delete(port)
      if (wasVisible) this.updateAlarm()
    })
    port.onMessage.addListener((message: unknown) => {
      if (typeof message !== 'boolean' || this.ports.get(port) === message || !this.ports.has(port))
        return
      this.ports.set(port, message)
      if (message) {
        this.catalogChanged()
        void this.refresh()
      }
      this.updateAlarm()
    })
    this.send(port)
  }

  onAlarm(): void {
    if (this.hasVisibleConsumer()) {
      this.catalogChanged()
      void this.refresh()
    }
    this.updateAlarm()
  }

  private enqueue(
    generation: number,
    load: (sources: AssetPriceSources) => Promise<AssetPriceReadModel>
  ): Promise<AssetPriceReadModel | null> {
    const operation = this.tail.then(async () => {
      if (generation !== this.generation) return null
      const primary = await load(this.sources).catch(() => null)
      if (generation !== this.generation) return null
      this.publish(primary ?? this.primary)
      return this.snapshot.prices
    })
    this.tail = operation.catch(() => {})
    return operation.catch(() => null)
  }

  private publish(primary: AssetPriceReadModel | null): void {
    this.primary = primary
    const prices = resolveAssetPriceSnapshot(primary, this.readCatalog(), this.now())
    const serialized = JSON.stringify(prices)
    if (serialized === this.serializedPrices) return
    this.serializedPrices = serialized
    this.snapshot = Object.freeze({
      network: this.network,
      revision: this.snapshot.revision + 1,
      prices
    })
    for (const port of this.ports.keys()) this.send(port)
  }

  private send(port: chrome.runtime.Port): void {
    try {
      port.postMessage(this.snapshot)
    } catch {
      const wasVisible = this.ports.get(port)
      this.ports.delete(port)
      if (wasVisible) this.updateAlarm()
    }
  }

  private hasVisibleConsumer(): boolean {
    return [...this.ports.values()].includes(true)
  }

  private updateAlarm(): void {
    this.alarmQueue = this.alarmQueue
      .then(async () => {
        if (!this.hasVisibleConsumer()) {
          await chrome.alarms.clear(ASSET_PRICE_ALARM)
        } else if (!(await chrome.alarms.get(ASSET_PRICE_ALARM))) {
          await chrome.alarms.create(ASSET_PRICE_ALARM, { when: this.now() + ASSET_PRICE_CHECK_MS })
        }
      })
      .catch(() => {})
  }
}
