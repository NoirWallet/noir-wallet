import { getAddress, isAddress } from 'viem'

const CHAIN_ICON_BASE_URL = 'https://assets.zknoir.com/chain'
const TRUST_WALLET_CHAIN_ASSET_BASE = 'https://assets-cdn.trustwallet.com/blockchains'

interface ChainIconConfig {
  readonly file?: string
  readonly native?: string
  readonly token?: string
  readonly evmAddress?: boolean
}

const CHAIN_ICONS: Readonly<Record<string, ChainIconConfig>> = Object.freeze({
  abs: { native: 'ethereum' },
  aptos: { file: 'aptos.svg', native: 'aptos', token: 'aptos' },
  arb: { file: 'arbitrum.svg', native: 'ethereum', token: 'arbitrum', evmAddress: true },
  arbitrum: { file: 'arbitrum.svg', native: 'ethereum', token: 'arbitrum', evmAddress: true },
  avalanche: { file: 'avalanche.svg' },
  avax: { file: 'avalanche.svg', native: 'avalanchec', token: 'avalanchec', evmAddress: true },
  base: { file: 'base.svg', native: 'ethereum', token: 'base', evmAddress: true },
  bch: { native: 'bitcoincash' },
  bera: { file: 'berachain.svg' },
  berachain: { file: 'berachain.svg' },
  bitcoin: { file: 'bitcoin.svg', native: 'bitcoin' },
  bsc: { file: 'bsc.svg', native: 'smartchain', token: 'smartchain', evmAddress: true },
  btc: { file: 'bitcoin.svg', native: 'bitcoin' },
  cardano: { native: 'cardano' },
  dash: { native: 'dash' },
  doge: { native: 'doge' },
  eth: { file: 'ethereum.svg', native: 'ethereum', token: 'ethereum', evmAddress: true },
  ethereum: { file: 'ethereum.svg' },
  evm: { file: 'ethereum.svg' },
  gnosis: { file: 'gnosis.svg', native: 'xdai', token: 'xdai', evmAddress: true },
  ltc: { native: 'litecoin' },
  monad: { file: 'monad.svg', native: 'monad', token: 'monad', evmAddress: true },
  near: { file: 'near.svg', native: 'near', token: 'near' },
  op: { file: 'optimism.svg', native: 'ethereum', token: 'optimism', evmAddress: true },
  optimism: { file: 'optimism.svg', native: 'ethereum', token: 'optimism', evmAddress: true },
  plasma: { file: 'plasma.svg', native: 'plasma', token: 'plasma', evmAddress: true },
  pol: { file: 'polygon.svg', native: 'polygon', token: 'polygon', evmAddress: true },
  polygon: { file: 'polygon.svg', native: 'polygon', token: 'polygon', evmAddress: true },
  scroll: { native: 'scroll', token: 'scroll', evmAddress: true },
  sol: { file: 'solana.svg', native: 'solana', token: 'solana' },
  solana: { file: 'solana.svg', native: 'solana', token: 'solana' },
  stellar: { native: 'stellar', token: 'stellar' },
  sui: { file: 'sui.svg', native: 'sui', token: 'sui' },
  ton: { native: 'ton', token: 'ton' },
  tron: { file: 'tron.svg', native: 'tron', token: 'tron' },
  trx: { file: 'tron.svg' },
  xlayer: { file: 'xlayer.svg', native: 'okx' },
  xrp: { native: 'ripple' },
  zcash: { file: 'zcash.svg', native: 'zcash' },
  zec: { file: 'zcash.svg', native: 'zcash' }
})

export function formatConfiguredChainIconUrl(chain: string): string {
  const normalized = chain.trim().toLowerCase()
  const file = CHAIN_ICONS[normalized]?.file ?? `${encodeURIComponent(normalized)}.svg`
  return `${CHAIN_ICON_BASE_URL}/${file}`
}

function formatTrustWalletNativeIconUrl(chain: string): string | undefined {
  const slug = CHAIN_ICONS[chain.trim().toLowerCase()]?.native
  return slug ? `${TRUST_WALLET_CHAIN_ASSET_BASE}/${slug}/info/logo.png` : undefined
}

export function formatTrustWalletTokenIconUrl(
  chain: string,
  contractAddress: string
): string | undefined {
  const config = CHAIN_ICONS[chain.trim().toLowerCase()]
  const address = contractAddress.trim()
  if (!config?.token || address.length === 0) return undefined
  if (config.evmAddress && !isAddress(address)) return undefined
  const pathAddress = config.evmAddress ? getAddress(address) : address
  return `${TRUST_WALLET_CHAIN_ASSET_BASE}/${config.token}/assets/${encodeURIComponent(pathAddress)}/logo.png`
}

export function formatNativeTokenIconUrl(chain: string): string {
  return formatTrustWalletNativeIconUrl(chain) ?? formatConfiguredChainIconUrl(chain)
}
