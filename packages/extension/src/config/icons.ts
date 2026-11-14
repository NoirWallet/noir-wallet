import { getEvmNetworkConfigs } from './networks'

const CHAIN_ICON_BASE_URL = 'https://assets.zknoir.com/chain'
export const GENERIC_CHAIN_ICON_URL = '/icons/chains/network.svg'

interface ChainIconConfig {
  readonly file?: string
  readonly url?: string
}

const CHAIN_ICONS: Readonly<Record<string, ChainIconConfig>> = Object.freeze({
  aptos: { file: 'aptos.svg' },
  arb: { url: '/icons/chains/arbitrum.svg' },
  arbitrum: { url: '/icons/chains/arbitrum.svg' },
  avalanche: { url: '/icons/chains/avalanche.svg' },
  avax: { url: '/icons/chains/avalanche.svg' },
  base: { url: '/icons/chains/base.svg' },
  bera: { url: '/icons/chains/berachain.webp' },
  berachain: { url: '/icons/chains/berachain.webp' },
  bitcoin: { file: 'bitcoin.svg' },
  bsc: { url: '/icons/chains/bsc.png' },
  btc: { file: 'bitcoin.svg' },
  'custom-evm': { url: GENERIC_CHAIN_ICON_URL },
  eth: { url: '/icons/chains/ethereum.svg' },
  ethereum: { url: '/icons/chains/ethereum.svg' },
  evm: { url: '/icons/chains/evm.svg' },
  gnosis: { url: '/icons/chains/gnosis.png' },
  monad: { url: '/icons/chains/monad.png' },
  near: { file: 'near.svg' },
  op: { url: '/icons/chains/optimism.svg' },
  optimism: { url: '/icons/chains/optimism.svg' },
  plasma: { url: '/icons/chains/plasma.png' },
  pol: { url: '/icons/chains/polygon.svg' },
  polygon: { url: '/icons/chains/polygon.svg' },
  sol: { file: 'solana.svg' },
  solana: { file: 'solana.svg' },
  sui: { file: 'sui.svg' },
  tron: { file: 'tron.svg' },
  trx: { file: 'tron.svg' },
  xlayer: { url: '/icons/chains/xlayer.webp' },
  zcash: { url: '/icons/chains/zcash.svg' },
  zec: { url: '/icons/chains/zcash.svg' }
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
