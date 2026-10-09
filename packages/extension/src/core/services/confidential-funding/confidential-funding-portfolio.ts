import type { PortfolioAssetView, PortfolioReadModel } from '@/core/portfolio'

export interface ConfidentialPortfolioBalance {
  readonly tokenId: string
  readonly available: string
}

export interface ConfidentialPortfolioAssetMapping {
  readonly assetId: string
  readonly protocolAssetId: string
}

function findAvailableRaw(
  balances: readonly ConfidentialPortfolioBalance[],
  protocolAssetId: string
): string {
  const suffix = `:${protocolAssetId}`
  return (
    balances.find(
      balance => balance.tokenId === protocolAssetId || balance.tokenId.endsWith(suffix)
    )?.available ?? '0'
  )
}

function mergeAsset(
  asset: PortfolioAssetView,
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  balances: readonly ConfidentialPortfolioBalance[]
): PortfolioAssetView {
  const mapping = mappings.find(candidate => candidate.assetId === asset.asset.id)
  if (!mapping || asset.balance.mainRaw === undefined || asset.balance.privateRaw === undefined) {
    return asset
  }
  const confidentialRaw = findAvailableRaw(balances, mapping.protocolAssetId)
  if (!/^\d+$/.test(confidentialRaw)) return asset
  const previousConfidential = BigInt(asset.balance.confidentialRaw ?? '0')
  const privateOnchain = BigInt(
    asset.balance.privateOnchainRaw ??
      (BigInt(asset.balance.privateRaw) - previousConfidential).toString()
  )
  const nextConfidential = BigInt(confidentialRaw)
  const delta = nextConfidential - previousConfidential
  const addDelta = (raw: string) => (BigInt(raw) + delta).toString()
  return Object.freeze({
    ...asset,
    balance: Object.freeze({
      ...asset.balance,
      totalRaw: addDelta(asset.balance.totalRaw),
      privateRaw: (privateOnchain + nextConfidential).toString(),
      privateOnchainRaw: privateOnchain.toString(),
      confidentialRaw: nextConfidential.toString()
    })
  })
}

export function mergeConfidentialBalancesIntoPortfolio(
  model: PortfolioReadModel,
  mappings: readonly ConfidentialPortfolioAssetMapping[],
  balances: readonly ConfidentialPortfolioBalance[]
): PortfolioReadModel {
  const assets = model.assets.map(asset => mergeAsset(asset, mappings, balances))
  const byId = new Map(assets.map(asset => [asset.asset.id, asset]))
  const chains = model.chains.map(chain =>
    Object.freeze({
      ...chain,
      assets: Object.freeze(chain.assets.map(asset => byId.get(asset.asset.id) ?? asset))
    })
  )
  return Object.freeze({ ...model, assets: Object.freeze(assets), chains: Object.freeze(chains) })
}
