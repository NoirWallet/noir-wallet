import dayjs from './dayjs'
import Big, { safeBig } from './big'
import type { AddressType, WalletItem } from '@/types/wallet'
import { ZEC_DECIMALS } from '@/config/wallet'
import {
  getBlockExplorerBaseUrl,
  getBlockExplorerTransactionPath
} from './block-explorer-preferences'
import { DEFAULT_NETWORK, getNetworkConfig } from '@/lib/runtime-network'
import { detectZcashAddressType } from './zcash-memo'

const subscriptNumbers = [
  '₀',
  '₁',
  '₂',
  '₃',
  '₄',
  '₅',
  '₆',
  '₇',
  '₈',
  '₉',
  '₁₀',
  '₁₁',
  '₁₂',
  '₁₃',
  '₁₄',
  '₁₅',
  '₁₆',
  '₁₇',
  '₁₈',
  '₁₉',
  '₂₀'
]

export function formatTimestamp(timestamp: string | number | Date, template?: string) {
  if (!dayjs(timestamp).isValid()) return ''
  return dayjs(timestamp).format(template || 'YYYY/MM/DD HH:mm')
}

export function formatSortAddress(address: string | undefined) {
  if (!address) return ''
  if (/[() ]/.test(address)) return address
  const maxLength = 12
  const isLongAddress = address.length > maxLength
  return isLongAddress ? `${address.slice(0, 6)}...${address.slice(-6)}` : address
}

export function formatAccountName(name: string | undefined, maxLength: number = 16) {
  if (!name) return ''
  if (name.length <= maxLength) return name
  return `${name.slice(0, maxLength - 3)}...`
}

export function getAccountDisplayName(
  walletId: string,
  accountId: string,
  wasmName: string,
  displayNames: Record<string, string>
): string {
  const key = `${walletId}_${accountId}`

  if (displayNames[key]) {
    return displayNames[key]
  }

  const match = wasmName.match(/^Account_(\d+)_\d+$/)
  if (match) {
    const index = parseInt(match[1], 10)
    return `Account ${index + 1}`
  }

  return wasmName
}

export function formatAmount(amount: string | number | undefined, decimals = ZEC_DECIMALS) {
  if (!amount) return ''
  try {
    const n = safeBig(amount).div(safeBig(10).pow(decimals)).toFixed()
    return n
  } catch (error) {
    return ''
  }
}

export function parseAmount(amount: string | number | undefined, decimals = ZEC_DECIMALS) {
  if (!amount) return ''
  try {
    return safeBig(amount).times(safeBig(10).pow(decimals)).toFixed(0, Big.roundDown)
  } catch (error) {
    return ''
  }
}

function getPriceDecimals(price?: string | number, maxDecimals?: number) {
  if (!price || !Number(price)) return maxDecimals || 15
  const priceNum = Number(price)

  let decimals: number
  if (priceNum >= 10) {
    decimals = 2
  } else if (priceNum >= 1) {
    decimals = 3
  } else {
    const match = priceNum.toFixed(20).match(/^0\.0*/)
    const leadingZeros = match ? match[0].length - 2 : 0
    decimals = leadingZeros + 4
  }

  return maxDecimals ? Math.min(decimals, maxDecimals) : Math.min(decimals, 18)
}

interface FormatNumberOptions {
  rm?: Big.RoundingMode
  displayMinimum?: boolean
  maxDigits?: number
  useUnit?: boolean
  useSubscript?: boolean
  fallback?: string
}

export function formatNumber(
  val: string | number | null | undefined,
  options?: FormatNumberOptions
) {
  const {
    rm = Big.roundHalfUp,
    displayMinimum = true,
    useUnit = false,
    useSubscript = false,
    fallback = '0'
  } = options || {}
  if (val === null || val === undefined || val === '') return fallback
  let bigVal: Big
  try {
    bigVal = new Big(typeof val === 'string' ? val.replace(/,/g, '') : val)
  } catch {
    return fallback
  }
  if (bigVal.eq(0)) return '0'
  const magnitude = bigVal.abs()

  if ((useUnit && magnitude.gte('1e12')) || (useSubscript && magnitude.lt('1e-18'))) {
    return bigVal
      .toExponential(3, rm)
      .replace(/\.?(0+)(?=e)/, '')
      .replace('e+', 'e')
  }
  if (useUnit) {
    for (const [divisor, unit] of [
      ['1000000000', 'B'],
      ['1000000', 'M'],
      ['1000', 'K']
    ] as const) {
      if (magnitude.gte(divisor)) return `${bigVal.div(divisor).round(1, rm).toFixed()}${unit}`
    }
  }
  if (useSubscript && options?.maxDigits === undefined && magnitude.lt('0.0001')) {
    return formatNumberWithSubscript(bigVal.toFixed())
  }

  // Use getPriceDecimals for consistent decimal calculation
  let maxDigits = options?.maxDigits
  if (maxDigits === undefined) {
    const absVal = bigVal.abs()
    if (absVal.eq(0)) {
      maxDigits = 0
    } else {
      maxDigits = getPriceDecimals(absVal.toFixed())
    }
  }

  const min = safeBig(10).pow(-maxDigits)
  const roundedVal = bigVal.round(maxDigits, rm)

  if (displayMinimum && roundedVal.abs().lt(min)) {
    const formattedMin = new Intl.NumberFormat('en-US', {
      style: 'decimal',
      maximumFractionDigits: maxDigits
    }).format(min.toNumber())

    return `< ${roundedVal.lt(0) ? '-' : ''}${formattedMin}`
  }

  const formattedValue = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    maximumFractionDigits: maxDigits
  }).format(roundedVal.toNumber())

  return formattedValue
}

export function formatNumberWithSubscript(value: string | number): string {
  const bigVal = safeBig(value)
  if (bigVal.eq(0)) return '0'

  const isNegative = bigVal.lt(0)
  const strVal = bigVal.abs().toFixed()
  const parts = strVal.split('.')
  if (parts.length <= 1) return isNegative ? '-' + strVal : strVal

  const leadingZeros = parts[1].match(/^0+/)?.[0]?.length || 0
  const absVal = bigVal.abs()

  let maxDigits
  if (absVal.eq(0)) {
    maxDigits = 0
  } else {
    maxDigits = getPriceDecimals(absVal.toFixed())
  }

  if (leadingZeros > 3 && leadingZeros <= 20) {
    const remainingDigits = parts[1]?.slice(leadingZeros)
    // When using subscript, display a fixed 5 digits since subscript already compresses the length
    const digitsToShow = maxDigits - leadingZeros
    const MathMax = Math.max(1, digitsToShow)
    const truncatedDigits = remainingDigits?.slice(0, MathMax).replace(/0+$/, '')
    const subscriptNumber = subscriptNumbers[leadingZeros]
    parts[1] = '0' + subscriptNumber + truncatedDigits
  } else {
    parts[1] = parts[1]?.slice(0, maxDigits).replace(/0+$/, '')
  }

  const result = parts[1] ? parts.join('.') : parts[0]
  return isNegative ? '-' + result : result
}

export function formatPrice(
  price: string | number | undefined,
  options?: FormatNumberOptions & { showSign?: boolean }
) {
  const bigPrice = safeBig(price)
  const formattedPrice = bigPrice.eq(0)
    ? '0'
    : bigPrice.abs().lt(1)
      ? formatNumberWithSubscript(price || 0)
      : formatNumber(price, options)
  const prefix = options?.showSign ? '$' : ''
  if (formattedPrice.startsWith('-')) return '-' + prefix + formattedPrice?.slice(1)
  return prefix + formattedPrice
}

export function formatPercent(
  val: string | number | undefined,
  options?: {
    maxDigits?: number
    showPlus?: boolean
    decimals?: number
    rm?: Big.RoundingMode
    displayMinimum?: boolean
  }
) {
  const _val = isNaN(Number(val)) ? 0 : Number(val)
  const symbol = options?.showPlus && _val > 0 ? '+' : ''
  const value = safeBig(_val)
    .times(10 ** (options?.decimals || 0))
    .round(options?.maxDigits ?? 2, options?.rm)
  if (options?.displayMinimum && value.abs().gt(0) && value.abs().lt(1)) {
    return `< ${value.lt(0) ? '-' : ''}1%`
  }
  return symbol + value.toString() + '%'
}

export function formatChainName(blockchain: string): string {
  const labels: Record<string, string> = {
    near: 'NEAR',
    eth: 'Ethereum',
    ethereum: 'Ethereum',
    evm: 'Ethereum',
    arb: 'Arbitrum',
    base: 'Base',
    op: 'Optimism',
    bsc: 'BNB Chain',
    arbitrum: 'Arbitrum',
    pol: 'Polygon',
    polygon: 'Polygon',
    optimism: 'Optimism',
    avax: 'Avalanche',
    avalanche: 'Avalanche',
    sol: 'Solana',
    solana: 'Solana',
    btc: 'Bitcoin',
    bitcoin: 'Bitcoin',
    bera: 'Berachain',
    berachain: 'Berachain',
    gnosis: 'Gnosis',
    monad: 'Monad',
    plasma: 'Plasma',
    xlayer: 'X Layer',
    zec: 'Zcash',
    zcash: 'Zcash'
  }
  const normalizedBlockchain = blockchain.toLowerCase()
  return labels[normalizedBlockchain] || blockchain
}

export function formatSymbol(symbol?: string) {
  switch (symbol) {
    case 'wNEAR':
      return 'NEAR'
    default:
      return symbol || ''
  }
}

const explorerUrls: Record<string, string> = {
  near: 'https://nearblocks.io',
  solana: 'https://solscan.io',
  zcash: getBlockExplorerBaseUrl('zcash'),
  bitcoin: 'https://mempool.space',
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
  arbitrum: 'https://arbiscan.io',
  base: 'https://basescan.org',
  optimism: 'https://optimistic.etherscan.io',
  polygon: 'https://polygonscan.com',
  avalanche: 'https://snowtrace.io',
  berachain: 'https://berascan.com',
  gnosis: 'https://gnosisscan.io',
  monad: 'https://monadscan.com',
  plasma: 'https://plasmascan.to',
  xlayer: 'https://www.okx.com/web3/explorer/xlayer'
}
const explorerPaths: Record<string, Record<string, string>> = {
  near: {
    transaction: 'txns',
    account: 'address',
    token: 'token'
  },
  solana: {
    transaction: 'tx',
    account: 'account',
    token: 'token'
  },
  zcash: {
    transaction: getBlockExplorerTransactionPath('zcash'),
    account: 'address',
    token: 'ua' // generic, zcash doesn't have standard "tokens" in explorer same way
  },
  bitcoin: {
    transaction: 'tx',
    account: 'address',
    token: ''
  },
  ethereum: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  bsc: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  arbitrum: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  base: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  optimism: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  polygon: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  avalanche: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  berachain: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  gnosis: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  monad: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  plasma: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  },
  xlayer: {
    transaction: 'tx',
    account: 'address',
    token: 'token'
  }
}

export function formatExplorerUrl(
  chain: string,
  val: string,
  type: 'transaction' | 'account' | 'token' = 'transaction'
) {
  if (chain === 'zcash' && DEFAULT_NETWORK === 'testnet') {
    const testnetPath = type === 'transaction' ? 'tx' : type === 'account' ? 'address' : 'token'
    return `${getNetworkConfig('testnet').explorerUrl}/${testnetPath}/${val}`
  }

  const explorerUrl = chain === 'zcash' ? getBlockExplorerBaseUrl('zcash') : explorerUrls[chain]
  if (!explorerUrl) return ''
  const explorerPath =
    chain === 'zcash' && type === 'transaction'
      ? getBlockExplorerTransactionPath('zcash')
      : explorerPaths[chain]?.[type]

  let params = ''
  if (chain === 'solana') {
    params = '?cluster=mainnet-beta'
  }

  return `${explorerUrl}/${explorerPath}/${val}${params}`
}

const assetChainMap: Record<string, string> = {
  zec: 'zcash',
  zcash: 'zcash',
  near: 'near',
  eth: 'ethereum',
  sol: 'solana',
  btc: 'bitcoin',
  bsc: 'bsc',
  arb: 'arbitrum',
  base: 'base',
  op: 'optimism',
  pol: 'polygon',
  avax: 'avalanche',
  bera: 'berachain',
  gnosis: 'gnosis',
  monad: 'monad',
  plasma: 'plasma',
  xlayer: 'xlayer'
}

/**
 * Extracts chain name from intents asset ID (fallback, prefer using token.blockchain directly)
 */
export function getChainFromAssetId(assetId: string): string {
  if (!assetId) return ''
  const parts = assetId.split(':')
  if (parts[0] === '1cs_v1' && parts.length >= 3) {
    return assetChainMap[parts[1]] || parts[1]
  }
  if (parts[0] === 'nep245') {
    const chainId = /^([0-9]+)_/.exec(parts.slice(2).join(':'))?.[1]
    const byEvmChainId: Record<string, string> = {
      '10': 'optimism',
      '56': 'bsc',
      '100': 'gnosis',
      '137': 'polygon',
      '143': 'monad',
      '196': 'xlayer',
      '9745': 'plasma',
      '80094': 'berachain',
      '43114': 'avalanche'
    }
    if (chainId && byEvmChainId[chainId]) return byEvmChainId[chainId]
  }
  if (parts[0] === 'nep141' || parts[0] === 'nep245') {
    const tokenId = parts[1] || ''
    if (tokenId.startsWith('zec.')) return 'zcash'
    const prefix = tokenId.split(/[.-]/)[0]
    if (prefix && assetChainMap[prefix]) return assetChainMap[prefix]
    if (tokenId.endsWith('.near')) return 'near'
  }
  return assetChainMap[parts[0]] || parts[0]
}

export function formatWalletName(
  wallet: { id: string; name: string },
  allWallets: { id: string; name: string }[]
): string {
  const walletIndex = allWallets.findIndex(w => w.id === wallet.id)
  return formatWalletNameAtIndex(wallet.name, walletIndex)
}

export function formatWalletBackupName(
  wallet: WalletItem,
  allWallets: WalletItem[],
  displayNames: Record<string, string>
): string {
  const primary = wallet.accounts.find(account => account.derivationIndex === 0)
  if (!primary) return formatWalletName(wallet, allWallets)
  const customName = displayNames[`${wallet.id}_${primary.id}`]?.trim()
  return (
    customName ||
    formatSortAddress(primary.addresses.shielded || primary.addresses.transparent) ||
    formatWalletName(wallet, allWallets)
  )
}

export function formatWalletNameAtIndex(walletName: string, walletIndex: number): string {
  return walletIndex >= 0 && /^Wallet \d{13,}$/.test(walletName)
    ? `Wallet ${walletIndex + 1}`
    : walletName
}

export function detectAddressType(address: string): AddressType {
  return detectZcashAddressType(address)
}
