import { RHEA_SWAP_CHAIN_CATALOG, type RheaSwapToken } from '@/core/services/rhea-swap'
import { rheaSwapClient } from './rhea-swap-client'
import { getChainFromAssetId } from '@/lib/format'
import { createDebugRequestId, logDebugTiming, traceDebugStage } from '@/lib/debug-performance'

export interface SwapInitialCatalogOptions {
  readonly sourceAssetId?: string | null
  readonly destinationAssetId?: string | null
  readonly destinationApiChainId?: string | null
  readonly defaultSourceChainId?: string | null
}

function assetChain(assetId?: string | null) {
  if (!assetId) return undefined
  const numericChain =
    /^nep245:[^:]+:([0-9]+)_/.exec(assetId)?.[1] ?? /^eip155:([0-9]+)(?:\/|$)/.exec(assetId)?.[1]
  if (numericChain) return RHEA_SWAP_CHAIN_CATALOG.find(chain => chain.apiChainId === numericChain)
  if (assetId.startsWith('bip122:'))
    return RHEA_SWAP_CHAIN_CATALOG.find(chain => chain.apiChainId === 'btc')
  const blockchain = getChainFromAssetId(assetId)
  const aliases: Readonly<Record<string, string>> = {
    ethereum: 'eth',
    zcash: 'zec',
    bitcoin: 'btc',
    solana: 'sol',
    polygon: 'pol',
    optimism: 'op',
    avalanche: 'avax',
    arbitrum: 'arb',
    berachain: 'bera'
  }
  return RHEA_SWAP_CHAIN_CATALOG.find(
    chain => chain.blockchain === (aliases[blockchain] ?? blockchain)
  )
}

export function buildInitialSwapCatalogPlan(options: SwapInitialCatalogOptions) {
  const destination =
    assetChain(options.destinationAssetId) ??
    RHEA_SWAP_CHAIN_CATALOG.find(chain => chain.apiChainId === options.destinationApiChainId)
  const defaultSource = RHEA_SWAP_CHAIN_CATALOG.find(
    chain =>
      options.defaultSourceChainId === `eip155:${chain.apiChainId}` ||
      (chain.walletFamily === 'bitcoin' && options.defaultSourceChainId?.startsWith('bip122:')) ||
      options.defaultSourceChainId?.startsWith(`${chain.walletFamily}:`)
  )
  const source =
    assetChain(options.sourceAssetId) ??
    defaultSource ??
    RHEA_SWAP_CHAIN_CATALOG.find(chain => chain.blockchain === 'zec')
  if (!source) throw new Error('Swap source chain is unavailable')
  const target =
    destination ??
    RHEA_SWAP_CHAIN_CATALOG.find(
      chain => chain.blockchain === (source.blockchain === 'near' ? 'eth' : 'near')
    )
  return {
    sourceChainIds: [source.tokenListChainId],
    destinationChainIds:
      target && target.apiChainId !== source.apiChainId ? [target.tokenListChainId] : []
  }
}

export const WALLET_SOURCE_CHAIN_IDS = Object.freeze(
  RHEA_SWAP_CHAIN_CATALOG.filter(chain => chain.walletFamily !== undefined)
    .sort((left, right) => Number(right.blockchain === 'zec') - Number(left.blockchain === 'zec'))
    .map(chain => chain.tokenListChainId)
)
export const ALL_DESTINATION_CHAIN_IDS = Object.freeze(
  [
    ...RHEA_SWAP_CHAIN_CATALOG.filter(chain =>
      ['eth', 'zec', 'sol', 'near', 'btc'].includes(chain.blockchain)
    ),
    ...RHEA_SWAP_CHAIN_CATALOG.filter(
      chain => !['eth', 'zec', 'sol', 'near', 'btc'].includes(chain.blockchain)
    )
  ].map(chain => chain.tokenListChainId)
)

export function mergeTokenCatalogs(
  ...catalogs: readonly (readonly RheaSwapToken[])[]
): readonly RheaSwapToken[] {
  const tokens = new Map<string, RheaSwapToken>()
  for (const catalog of catalogs) {
    for (const token of catalog) tokens.set(`${token.rheaChainId}:${token.rheaAddress}`, token)
  }
  return Object.freeze([...tokens.values()])
}

export function findSwapTokenInCatalog(
  catalog: readonly RheaSwapToken[],
  token: RheaSwapToken
): RheaSwapToken | undefined {
  return catalog.find(
    candidate => candidate.assetId === token.assetId && candidate.blockchain === token.blockchain
  )
}

export function mergeSelectedSwapSourceCatalog(
  current: readonly RheaSwapToken[],
  selectorCatalog: readonly RheaSwapToken[],
  selected: RheaSwapToken
): readonly RheaSwapToken[] {
  return mergeTokenCatalogs(
    current,
    selectorCatalog.filter(token => token.tokenListChainId === selected.tokenListChainId),
    [selected]
  )
}

export function readCachedTokenCatalogByChain(
  direction: 'from' | 'cross-chain-to',
  chainIds: readonly number[]
): readonly RheaSwapToken[] {
  return mergeTokenCatalogs(
    ...chainIds.map(
      chainId =>
        rheaSwapClient.readCachedTokens({ direction, tokenListChainIds: [chainId] })?.tokens ?? []
    )
  )
}

export async function loadTokenCatalogByChain(
  direction: 'from' | 'cross-chain-to',
  chainIds: readonly number[],
  bypassCache: boolean,
  onTokens: (tokens: readonly RheaSwapToken[]) => void,
  isCancelled: () => boolean,
  client: Pick<typeof rheaSwapClient, 'listTokens'> = rheaSwapClient
): Promise<readonly RheaSwapToken[]> {
  const requestId = createDebugRequestId(`swap-catalog-${direction}`)
  const startedAt = performance.now()
  const tokens: RheaSwapToken[] = []
  let cursor = 0
  const worker = async () => {
    while (!isCancelled() && cursor < chainIds.length) {
      const chainId = chainIds[cursor++]
      try {
        const result = await traceDebugStage(requestId, `list-chain-${chainId}`, () =>
          client.listTokens({ direction, tokenListChainIds: [chainId] }, { bypassCache })
        )
        tokens.push(...result.tokens)
        if (!isCancelled() && result.tokens.length > 0) onTokens(result.tokens)
      } catch {
        // A failed chain must not discard catalogs that are already usable.
      }
    }
  }
  // Source and destination loaders run together with at most four requests total.
  await Promise.all(Array.from({ length: Math.min(2, chainIds.length) }, worker))
  logDebugTiming(requestId, `complete chains=${chainIds.length} tokens=${tokens.length}`, startedAt)
  return mergeTokenCatalogs(tokens)
}
