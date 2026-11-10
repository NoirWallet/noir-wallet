import { getEvmNetworkConfigs } from './networks'

const CHAIN_ICON_BASE_URL = 'https://assets.zknoir.com/chain'
export const GENERIC_CHAIN_ICON_URL = '/icons/chains/network.svg'

interface ChainIconConfig {
  readonly file?: string
  readonly url?: string
}

const CHAIN_ICONS: Readonly<Record<string, ChainIconConfig>> = Object.freeze({
  aptos: { file: 'aptos.svg' },
  arb: { file: 'arbitrum.svg' },
  arbitrum: { file: 'arbitrum.svg' },
  avalanche: { file: 'avalanche.svg' },
  avax: { file: 'avalanche.svg' },
  base: { file: 'base.svg' },
  bera: { file: 'berachain.svg' },
  berachain: { file: 'berachain.svg' },
  bitcoin: { file: 'bitcoin.svg' },
  bsc: { file: 'bsc.svg' },
  btc: { file: 'bitcoin.svg' },
  'custom-evm': { url: GENERIC_CHAIN_ICON_URL },
  eth: { file: 'ethereum.svg' },
  ethereum: { file: 'ethereum.svg' },
  evm: { url: '/icons/chains/evm.svg' },
  gnosis: { file: 'gnosis.svg' },
  monad: { file: 'monad.svg' },
  near: { file: 'near.svg' },
  op: { file: 'optimism.svg' },
  optimism: { file: 'optimism.svg' },
  plasma: { file: 'plasma.svg' },
  pol: { file: 'polygon.svg' },
  polygon: { file: 'polygon.svg' },
  sol: { file: 'solana.svg' },
  solana: { file: 'solana.svg' },
  sui: { file: 'sui.svg' },
  tron: { file: 'tron.svg' },
  trx: { file: 'tron.svg' },
  xlayer: { file: 'xlayer.svg' },
  zcash: { file: 'zcash.svg' },
  zec: { file: 'zcash.svg' }
})

export function formatConfiguredChainIconUrl(chain: string): string {
  const normalized = chain.trim().toLowerCase()
  if (isDynamicEvmChainIcon(normalized)) return GENERIC_CHAIN_ICON_URL
  const config = CHAIN_ICONS[normalized]
  if (config?.url) return config.url
  const file = config?.file ?? `${encodeURIComponent(normalized)}.svg`
  return `${CHAIN_ICON_BASE_URL}/${file}`
}

export function isDynamicEvmChainIcon(chain: string): boolean {
  return /^eip155:[1-9][0-9]*$/.test(chain) && Number.isSafeInteger(Number(chain.slice(7)))
}

export function resolveEvmChainIconAlias(chainId: string): string {
  for (const mode of ['mainnet', 'testnet'] as const) {
    const builtin = getEvmNetworkConfigs(mode).find(network => network.chainId === chainId)
    if (builtin) return builtin.iconChain
  }
  return isDynamicEvmChainIcon(chainId) ? chainId : 'custom-evm'
}
