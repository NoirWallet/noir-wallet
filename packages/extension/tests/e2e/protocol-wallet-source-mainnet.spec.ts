import * as secp256k1 from '@bitcoinerlab/secp256k1'
import type { BrowserContext, Page, Route } from '@playwright/test'
import { networks, payments } from 'bitcoinjs-lib'
import { Buffer } from 'buffer'
import { keccak256, parseTransaction, type Hex } from 'viem'
import { DEFAULT_HISTORY_API_ORIGIN } from '../../src/config/extension'
import { NEAR_NETWORKS } from '../../src/config/networks'
import {
  captureScreenshot,
  e2eEnabledChainFeatureFlags,
  expect,
  selectImportedZcashHistory,
  test,
  waitForBackgroundWalletInitialization
} from './extension-fixtures'

const TEST_MNEMONIC_24 = `${'abandon '.repeat(23)}art`
const TEST_PASSWORD = 'protocol-wallet-source-password'
const TEST_BETA_INVITE_CODE = 'PROTOCOL-WALLET-SOURCE-INVITE'
const ETH_ASSET = 'nep141:eth.omft.near'
const USDC_ASSET = 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near'
const POL_ASSET = 'nep245:v2_1.omni.hot.tg:137_11111111111111111111'
const BNB_ASSET = 'nep245:v2_1.omni.hot.tg:56_11111111111111111111'
const POLYGON_USDC_ASSET = 'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L'
const POLYGON_USDC_CONTRACT = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
const BASE_USDC_ASSET = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near'
const BASE_USDC_CONTRACT = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const ETHEREUM_USDC_CONTRACT = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const BTC_ASSET = 'nep141:btc.omft.near'
const NEAR_ASSET = 'nep141:wrap.near'
const ZEC_ASSET = 'nep141:zec.omft.near'
const TRIAL_ASSET = 'nep141:trial-eth.omft.near'
const TRIAL_CONTRACT = `0x${'7'.repeat(40)}`
const MAINNET_GENESIS = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
const EVM_RPC_NETWORKS = Object.freeze([
  Object.freeze({ url: 'https://eth.deltarpc.com/**', chainId: '0x1' }),
  Object.freeze({ url: 'https://bsc-dataseed.bnbchain.org/**', chainId: '0x38' }),
  Object.freeze({ url: 'https://arbitrum.drpc.org/**', chainId: '0xa4b1' }),
  Object.freeze({ url: 'https://mainnet.base.org/**', chainId: '0x2105' }),
  Object.freeze({ url: 'https://mainnet.optimism.io/**', chainId: '0xa' }),
  Object.freeze({ url: 'https://polygon.drpc.org/**', chainId: '0x89' }),
  Object.freeze({ url: 'https://api.avax.network/ext/bc/C/rpc/**', chainId: '0xa86a' }),
  Object.freeze({ url: 'https://rpc.monad.xyz/**', chainId: '0x8f' }),
  Object.freeze({ url: 'https://rpc.gnosischain.com/**', chainId: '0x64' }),
  Object.freeze({ url: 'https://rpc.plasma.to/**', chainId: '0x2611' }),
  Object.freeze({ url: 'https://rpc.xlayer.tech/**', chainId: '0xc4' }),
  Object.freeze({ url: 'https://rpc.berachain.com/**', chainId: '0x138de' })
])
const EVM_HISTORY_URLS = [
  'https://eth.blockscout.com/api/**',
  'https://arbitrum.blockscout.com/api/**',
  'https://base.blockscout.com/api/**',
  'https://explorer.optimism.io/api/**',
  'https://polygon.blockscout.com/api/**',
  'https://gnosis.blockscout.com/api/**'
] as const
const EVM_HISTORY_PROXY_ORIGINS = new Set([DEFAULT_HISTORY_API_ORIGIN, 'https://evm-history.test'])
const MEMPOOL_URL = 'https://mempool.space/api/**'
const BLOCKSTREAM_URL = 'https://blockstream.info/api/**'
const EMZY_URL = 'https://mempool.emzy.de/api/**'
const TOKEN_LIST_URL = 'https://1click.chaindefuser.com/v0/tokens'
const COINGECKO_MARKETS_URL = 'https://api.coingecko.com/api/v3/coins/markets**'
const QUOTE_URL = 'https://api.rhea.finance/api/swap/quote'
const BUILD_SWAP_URL = 'https://api.rhea.finance/api/swap/swap'
const REPORT_SWAP_URL = 'https://api.rhea.finance/api/swap/report'
const ORDER_STATUS_URL = 'https://api.rhea.finance/api/swap/order-status'
const LENDING_QUOTE_URL = 'https://api.rhea.finance/api/1click/quote'
const CONFIDENTIAL_API_URL = 'https://1click.chaindefuser.com/v0'
const CONFIDENTIAL_BALANCES_URL = 'https://1click.chaindefuser.com/v0/account/balances'
const LENDING_METADATA_URL = 'https://api.rhea.finance/list-burrow-asset-token'
const NEAR_RPC_URLS = [
  'https://free.rpc.fastnear.com/**',
  'https://nearinner.deltarpc.com/**'
] as const
const UTXO_TRANSACTION_ID = 'b'.repeat(64)
const UTXO_VALUE_SATS = 100_000
const POL_WALLET_ASSET = 'eip155:137/slip44:966'
const POLYGON_USDC_WALLET_ASSET = 'eip155:137/erc20:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
const USDC_BALANCE_RAW = 10_000_000n
const MOCK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#00d18a"/></svg>'
const inviteBindAddresses = new WeakMap<BrowserContext, string>()
const bitcoinEnabled = e2eEnabledChainFeatureFlags.includes('chain.bitcoin')

test.beforeEach(async ({ context }) => {
  const fulfillIcon = (route: Route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: MOCK_ICON_SVG })
  await context.route('https://assets.zknoir.com/**', fulfillIcon)
  await context.route('https://assets-cdn.trustwallet.com/**', fulfillIcon)
  await context.route('https://coin-images.coingecko.com/**', fulfillIcon)
  const invitePath = `/v1/invite-codes/${encodeURIComponent(TEST_BETA_INVITE_CODE)}`
  await context.route('https://api.zknoir.com/v1/invite-codes/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === `${invitePath}/check`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { exists: true, bound: false } })
      })
      return
    }
    if (request.method() === 'POST' && url.pathname === `${invitePath}/bind`) {
      const body = request.postDataJSON() as { wallet_address?: unknown }
      expect(body.wallet_address).toMatch(/^0x[0-9a-fA-F]{40}$/)
      inviteBindAddresses.set(context, body.wallet_address as string)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { code: TEST_BETA_INVITE_CODE, bound: true } })
      })
      return
    }
    throw new Error('Unexpected invite API request')
  })
})

function p2wpkhAddress(privateKeyDigit: number): string {
  const privateKey = Buffer.alloc(32)
  privateKey[31] = privateKeyDigit
  const publicKey = Buffer.from(secp256k1.pointFromScalar(privateKey, true))
  const address = payments.p2wpkh({ pubkey: publicKey, network: networks.bitcoin }).address
  if (!address) throw new Error('Unable to derive Bitcoin test address')
  return address
}

const BITCOIN_DEPOSIT_ADDRESS = p2wpkhAddress(2)

async function importTestWallet(page: Page): Promise<void> {
  const activation = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_BETA_INVITE_ACTIVATION' })
  )
  if (typeof activation?.result?.required !== 'boolean') {
    throw new Error('Invite activation status is unavailable')
  }
  if (activation.result.required && activation.result.state?.phase === 'unverified') {
    await expect(page.getByRole('heading', { name: 'Enter invite code' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Invite code' }).fill(TEST_BETA_INVITE_CODE)
    await page.getByRole('button', { name: 'Continue' }).click()
  }
  await page.getByRole('button', { name: 'Import wallet' }).click()
  await page.getByRole('radio', { name: '24 words' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('input[type="text"]').first().fill(TEST_MNEMONIC_24)
  await page.getByRole('button', { name: 'Continue' }).click()
  await selectImportedZcashHistory(page, { birthdayHeight: 3_000_000 })
  await page.getByPlaceholder('8–64 characters').fill(TEST_PASSWORD)
  await page.getByPlaceholder('Confirm password').fill(TEST_PASSWORD)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Import Wallet' }).click()
  await expect(page.getByRole('heading', { name: 'Congratulations!' })).toBeVisible({
    timeout: 60_000
  })
  await page.getByRole('button', { name: 'Got it' }).click()
  if (!activation.result.required) return
  await expect
    .poll(async () => {
      const response = await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_BETA_INVITE_ACTIVATION' })
      )
      return response?.result?.state?.phase
    })
    .toBe('activated')
  const boundAddress = inviteBindAddresses.get(page.context())
  expect(boundAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
  const accountAddress = await page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const active = response?.result?.accounts?.find(
      (account: { active?: unknown }) => account.active === true
    )
    const evm = active?.networks?.find(
      (network: { chainId?: unknown }) => network.chainId === 'eip155:1'
    )
    return evm?.addresses?.find(
      (address: { preferredForReceive?: unknown }) => address.preferredForReceive === true
    )?.value
  })
  expect(boundAddress?.toLowerCase()).toBe(accountAddress?.toLowerCase())
}

async function connectEvmDApp(
  context: BrowserContext
): Promise<Readonly<{ page: Page; address: string }>> {
  await context.route('https://private-defi.example/**', route =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Private DeFi</title></head><body>Private DeFi</body></html>'
    })
  )
  const page = await context.newPage()
  await page.goto('https://private-defi.example/connect')
  await page.waitForFunction(() => {
    const target = window as typeof window & {
      noirwallet?: { ethereum?: { isNoirWallet?: boolean } }
    }
    return target.noirwallet?.ethereum?.isNoirWallet === true
  })

  const approvalPromise = context.waitForEvent('page')
  const accountsPromise = page.evaluate(() => {
    const provider = (
      window as typeof window & {
        noirwallet: {
          ethereum: {
            request: (input: { method: string; params?: unknown[] }) => Promise<unknown>
          }
        }
      }
    ).noirwallet.ethereum
    return provider.request({ method: 'eth_requestAccounts' })
  })
  const approval = await approvalPromise
  await approval.waitForURL(/#approval\?requestId=/)
  await approval.setViewportSize({ width: 375, height: 632 })
  await approval.getByRole('button', { name: 'Connect', exact: true }).click()
  const accounts = (await accountsPromise) as string[]
  if (!approval.isClosed()) await approval.close()
  expect(accounts).toEqual([expect.stringMatching(/^0x[0-9a-f]{40}$/)])
  return Object.freeze({ page, address: accounts[0] })
}

async function readEvmAccounts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const provider = (
      window as typeof window & {
        noirwallet: {
          ethereum: {
            request: (input: { method: string; params?: unknown[] }) => Promise<unknown>
          }
        }
      }
    ).noirwallet.ethereum
    return provider.request({ method: 'eth_accounts' }) as Promise<string[]>
  })
}

async function readPersistedSwapSource(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const stored = await chrome.storage.local.get(['wallet_state', 'swap_preferences'])
    const walletState =
      typeof stored.wallet_state === 'string'
        ? JSON.parse(stored.wallet_state).state
        : stored.wallet_state?.state
    const swapState =
      typeof stored.swap_preferences === 'string'
        ? JSON.parse(stored.swap_preferences).state
        : stored.swap_preferences?.state
    const scope = `${walletState?.currentWalletId}:${walletState?.currentAccountId}`
    return swapState?.tokenSelections?.[scope]?.tokenInId
  })
}

interface MockEvmNetworkState {
  readonly getBroadcastCount: () => number
  readonly getRpcRequestCount: () => number
  readonly getBroadcastHashes: () => readonly string[]
  readonly getBroadcastRawTransactions: () => readonly string[]
  readonly getBroadcastValues: () => readonly bigint[]
  readonly setAddressBalanceRaw: (address: string, balanceRaw: bigint) => void
  readonly getContractGasEstimateCount: () => number
}

async function mockEvmNetwork(
  context: BrowserContext,
  options: {
    readonly allowBroadcast?: boolean
    readonly pendingBroadcast?: boolean
    readonly contractGas?: string
    readonly balanceRaw?: bigint
  } = {}
): Promise<MockEvmNetworkState> {
  let broadcastCount = 0
  let rpcRequestCount = 0
  let contractGasEstimateCount = 0
  const broadcastHashes: string[] = []
  const broadcastRawTransactions: string[] = []
  const broadcastValues: bigint[] = []
  const addressBalances = new Map<string, bigint>()
  await context.route(
    url => EVM_HISTORY_PROXY_ORIGINS.has(url.origin) && url.pathname === '/',
    route => {
      const request = route.request().postDataJSON() as { id: number | string; method: string }
      expect(['ankr_getTransactionsByAddress', 'ankr_getTokenTransfers']).toContain(request.method)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result:
            request.method === 'ankr_getTokenTransfers' ? { transfers: [] } : { transactions: [] }
        })
      })
    }
  )
  for (const url of EVM_HISTORY_URLS) {
    await context.route(url, route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ status: '0', message: 'No transactions found', result: [] })
      })
    )
  }
  for (const network of EVM_RPC_NETWORKS) {
    await context.route(network.url, async route => {
      rpcRequestCount += 1
      const request = route.request().postDataJSON() as {
        id: number
        method: string
        params?: readonly unknown[]
      }
      const call = request.params?.[0]
      const balanceAddress =
        typeof request.params?.[0] === 'string' ? request.params[0].toLowerCase() : ''
      const callData =
        typeof call === 'object' && call !== null && 'data' in call
          ? (call as { data?: unknown }).data
          : undefined
      const result =
        request.method === 'eth_chainId'
          ? network.chainId
          : request.method === 'eth_getBalance'
            ? `0x${(addressBalances.get(balanceAddress) ?? options.balanceRaw ?? 1_000_000_000_000_000_000n).toString(16)}`
            : request.method === 'eth_getTransactionCount'
              ? '0x0'
              : request.method === 'eth_call'
                ? request.params?.[1] === 'latest' &&
                  typeof callData === 'string' &&
                  callData.startsWith('0x70a08231')
                  ? `0x${USDC_BALANCE_RAW.toString(16).padStart(64, '0')}`
                  : typeof callData === 'string' && callData.startsWith('0xdd62ed3e')
                    ? `0x${'0'.repeat(64)}`
                    : '0x'
                : request.method === 'eth_estimateGas'
                  ? (() => {
                      if (callData === '0x1234') {
                        contractGasEstimateCount += 1
                        return options.contractGas ?? '0x5208'
                      }
                      return '0x5208'
                    })()
                  : request.method === 'eth_maxPriorityFeePerGas'
                    ? '0x3b9aca00'
                    : request.method === 'eth_getBlockByNumber'
                      ? { number: '0x101', baseFeePerGas: '0x3b9aca00' }
                      : request.method === 'eth_sendRawTransaction'
                        ? (() => {
                            broadcastCount += 1
                            if (!options.allowBroadcast) {
                              throw new Error(
                                'The protocol review test must not broadcast EVM funds'
                              )
                            }
                            const rawTransaction = request.params?.[0]
                            if (
                              typeof rawTransaction !== 'string' ||
                              !/^0x[0-9a-fA-F]+$/.test(rawTransaction)
                            ) {
                              throw new Error('Expected a canonical signed EVM transaction')
                            }
                            const hash = keccak256(rawTransaction as Hex)
                            const transaction = parseTransaction(rawTransaction as Hex)
                            const value = transaction.value ?? 0n
                            const fee =
                              (transaction.gas ?? 0n) *
                              (transaction.maxFeePerGas ?? transaction.gasPrice ?? 0n)
                            if (
                              options.balanceRaw !== undefined &&
                              value + fee > options.balanceRaw
                            )
                              throw new Error('Broadcast exceeds the source balance including gas')
                            broadcastValues.push(value)
                            broadcastHashes.push(hash)
                            broadcastRawTransactions.push(rawTransaction)
                            return hash
                          })()
                        : request.method === 'eth_getTransactionReceipt'
                          ? typeof request.params?.[0] === 'string' &&
                            broadcastHashes.includes(request.params[0]) &&
                            !options.pendingBroadcast
                            ? {
                                transactionHash: request.params[0],
                                blockHash: `0x${'2'.repeat(64)}`,
                                blockNumber: '0x100',
                                status: '0x1'
                              }
                            : null
                          : request.method === 'eth_getTransactionByHash'
                            ? typeof request.params?.[0] === 'string' &&
                              broadcastHashes.includes(request.params[0])
                              ? {
                                  hash: request.params[0],
                                  blockHash: options.pendingBroadcast
                                    ? null
                                    : `0x${'2'.repeat(64)}`,
                                  blockNumber: options.pendingBroadcast ? null : '0x100'
                                }
                              : null
                            : null
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
      })
    })
  }
  return {
    getBroadcastCount: () => broadcastCount,
    getRpcRequestCount: () => rpcRequestCount,
    getContractGasEstimateCount: () => contractGasEstimateCount,
    getBroadcastHashes: () => [...broadcastHashes],
    getBroadcastRawTransactions: () => [...broadcastRawTransactions],
    getBroadcastValues: () => [...broadcastValues],
    setAddressBalanceRaw: (address: string, balanceRaw: bigint) => {
      addressBalances.set(address.toLowerCase(), balanceRaw)
    }
  }
}

async function mockBitcoinNetwork(context: BrowserContext): Promise<{
  readonly getBroadcastCount: () => number
  readonly getAddressActivityCount: () => number
  readonly getAddressUtxoCount: () => number
}> {
  let fundedAddress: string | null = null
  let broadcastCount = 0
  let addressActivityCount = 0
  let addressUtxoCount = 0
  const stats = (used: boolean) => ({
    tx_count: used ? 1 : 0,
    funded_txo_count: used ? 1 : 0,
    funded_txo_sum: used ? UTXO_VALUE_SATS : 0,
    spent_txo_count: 0,
    spent_txo_sum: 0
  })
  const fulfillJson = (route: Route, body: unknown) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  const handler = async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const markerIndex = url.pathname.indexOf('/api/')
    if (markerIndex < 0) throw new Error(`Unexpected Bitcoin URL: ${request.url()}`)
    const path = decodeURIComponent(url.pathname.slice(markerIndex + 5))
    if (path === 'block-height/0') {
      await route.fulfill({ contentType: 'text/plain', body: MAINNET_GENESIS })
      return
    }
    if (path === 'blocks/tip/height') {
      await route.fulfill({ contentType: 'text/plain', body: '900000' })
      return
    }
    if (path === 'fee-estimates') {
      await fulfillJson(route, { 6: 2 })
      return
    }
    if (path === 'tx' && request.method() === 'POST') {
      broadcastCount += 1
      throw new Error('The protocol review test must not broadcast Bitcoin funds')
    }
    const utxoMatch = /^address\/(.+)\/utxo$/.exec(path)
    if (utxoMatch) {
      addressUtxoCount += 1
      const address = utxoMatch[1]
      await fulfillJson(
        route,
        address === fundedAddress
          ? [
              {
                txid: UTXO_TRANSACTION_ID,
                vout: 0,
                value: UTXO_VALUE_SATS,
                status: {
                  confirmed: true,
                  block_height: 899900,
                  block_hash: 'c'.repeat(64),
                  block_time: 1_786_000_000
                }
              }
            ]
          : []
      )
      return
    }
    if (/^address\/(.+)\/txs$/.test(path)) {
      await fulfillJson(route, [])
      return
    }
    const addressMatch = /^address\/(.+)$/.exec(path)
    if (addressMatch) {
      addressActivityCount += 1
      const address = addressMatch[1]
      if (fundedAddress === null && address.startsWith('bc1q')) fundedAddress = address
      const used = address === fundedAddress
      await fulfillJson(route, {
        address,
        chain_stats: stats(used),
        mempool_stats: stats(false)
      })
      return
    }
    throw new Error(`Unhandled Bitcoin test path: ${path}`)
  }
  await context.route(MEMPOOL_URL, handler)
  await context.route(BLOCKSTREAM_URL, handler)
  await context.route(EMZY_URL, handler)
  return Object.freeze({
    getBroadcastCount: () => broadcastCount,
    getAddressActivityCount: () => addressActivityCount,
    getAddressUtxoCount: () => addressUtxoCount
  })
}

async function mockProtocolApis(
  context: BrowserContext,
  options: {
    readonly mcaId?: string
    readonly includeMultichainMarkets?: boolean
    readonly tokenResponseDelayMs?: number
    readonly quoteResponseDelayMs?: number
    readonly mockRheaCatalog?: boolean
    readonly mockRheaQuote?: boolean
    readonly evmApproval?: boolean
    readonly orderStatus?: 'pending' | 'completed'
  } = {}
): Promise<{
  readonly setTokenOnline: (online: boolean) => void
  readonly setNearOnline: (online: boolean) => void
  readonly setOrderStatus: (status: 'pending' | 'completed') => void
  readonly getQuoteRequests: () => readonly {
    originAsset: string
    destinationAsset: string
    amount: string
    refundTo: string
    recipient: string
    dry: boolean
    confidentiality?: 'basic'
    depositType?: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
    refundType?: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
    recipientType?: 'CONFIDENTIAL_INTENTS' | 'DESTINATION_CHAIN'
  }[]
}> {
  let tokenOnline = true
  let nearOnline = true
  let orderStatus = options.orderStatus ?? 'completed'
  const quoteRequests: Array<{
    originAsset: string
    destinationAsset: string
    amount: string
    refundTo: string
    recipient: string
    dry: boolean
    confidentiality?: 'basic'
    depositType?: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
    refundType?: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
    recipientType?: 'CONFIDENTIAL_INTENTS' | 'DESTINATION_CHAIN'
  }> = []
  const priceUpdatedAt = new Date().toISOString()
  await context.route(TOKEN_LIST_URL, async route => {
    if (!tokenOnline) return route.abort('failed')
    if (options.tokenResponseDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.tokenResponseDelayMs))
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          assetId: ZEC_ASSET,
          blockchain: 'zec',
          contractAddress: null,
          decimals: 8,
          icon: null,
          price: 40,
          priceUpdatedAt,
          symbol: 'ZEC'
        },
        {
          assetId: ETH_ASSET,
          blockchain: 'eth',
          contractAddress: null,
          decimals: 18,
          icon: null,
          price: 2500,
          priceUpdatedAt,
          symbol: 'ETH'
        },
        {
          assetId: TRIAL_ASSET,
          blockchain: 'eth',
          contractAddress: TRIAL_CONTRACT,
          decimals: 18,
          icon: null,
          price: 1,
          priceUpdatedAt,
          symbol: 'TRIAL'
        },
        {
          assetId: USDC_ASSET,
          blockchain: 'eth',
          contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          coingeckoId: 'usd-coin',
          decimals: 6,
          price: 1,
          priceUpdatedAt,
          symbol: 'USDC'
        },
        {
          assetId: POL_ASSET,
          blockchain: 'polygon',
          contractAddress: null,
          decimals: 18,
          icon: null,
          price: 0.5,
          priceUpdatedAt,
          symbol: 'POL'
        },
        {
          assetId: BNB_ASSET,
          blockchain: 'bsc',
          contractAddress: null,
          decimals: 18,
          icon: null,
          price: 600,
          priceUpdatedAt,
          symbol: 'BNB'
        },
        {
          assetId: POLYGON_USDC_ASSET,
          blockchain: 'polygon',
          decimals: 6,
          price: 1,
          priceUpdatedAt,
          symbol: 'USDC'
        },
        {
          assetId: BTC_ASSET,
          blockchain: 'btc',
          decimals: 8,
          icon: null,
          price: 60000,
          priceUpdatedAt,
          symbol: 'BTC'
        },
        {
          assetId: NEAR_ASSET,
          blockchain: 'near',
          contractAddress: null,
          decimals: 24,
          icon: null,
          price: 3,
          priceUpdatedAt,
          symbol: 'NEAR'
        }
      ])
    })
  })
  await context.route(COINGECKO_MARKETS_URL, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'usd-coin',
          image: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png'
        }
      ])
    })
  )
  const rheaTokenListChainIds: Readonly<Record<string, number>> = {
    eth: 1,
    base: 8453,
    bsc: 56,
    polygon: 137,
    near: 900001,
    btc: 900002,
    zec: 900010
  }
  const rheaTokenRows = [
    {
      assetId: ZEC_ASSET,
      blockchain: 'zec',
      contractAddress: null,
      decimals: 8,
      price: 40,
      symbol: 'ZEC'
    },
    {
      assetId: ETH_ASSET,
      blockchain: 'eth',
      contractAddress: null,
      decimals: 18,
      price: 2500,
      sources: ['nearintents'],
      symbol: 'ETH'
    },
    {
      assetId: TRIAL_ASSET,
      blockchain: 'eth',
      contractAddress: TRIAL_CONTRACT,
      decimals: 18,
      price: 1,
      symbol: 'TRIAL'
    },
    {
      assetId: USDC_ASSET,
      blockchain: 'eth',
      contractAddress: ETHEREUM_USDC_CONTRACT,
      decimals: 6,
      price: 1,
      sources: ['nearintents'],
      symbol: 'USDC'
    },
    {
      assetId: BASE_USDC_ASSET,
      blockchain: 'base',
      contractAddress: BASE_USDC_CONTRACT,
      decimals: 6,
      price: 1,
      sources: ['nearintents'],
      symbol: 'USDC'
    },
    {
      assetId: 'nep141:eth-dai.omft.near',
      blockchain: 'eth',
      contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f',
      decimals: 18,
      price: 1,
      symbol: 'DAI'
    },
    {
      assetId: POL_ASSET,
      blockchain: 'polygon',
      contractAddress: null,
      decimals: 18,
      price: 0.5,
      symbol: 'POL'
    },
    {
      assetId: BNB_ASSET,
      blockchain: 'bsc',
      contractAddress: null,
      decimals: 18,
      price: 600,
      symbol: 'BNB'
    },
    {
      assetId: POLYGON_USDC_ASSET,
      blockchain: 'polygon',
      contractAddress: POLYGON_USDC_CONTRACT,
      decimals: 6,
      price: 1,
      symbol: 'USDC'
    },
    {
      assetId: BTC_ASSET,
      blockchain: 'btc',
      contractAddress: null,
      decimals: 8,
      price: 60000,
      symbol: 'BTC'
    },
    {
      assetId: NEAR_ASSET,
      blockchain: 'near',
      contractAddress: null,
      decimals: 24,
      price: 3,
      symbol: 'NEAR'
    },
    {
      assetId: 'nep141:eth.bridge.near',
      blockchain: 'near',
      contractAddress: 'eth.bridge.near',
      decimals: 18,
      price: 2500,
      symbol: 'ETH'
    }
  ].map(token => ({
    ...token,
    address: token.contractAddress ?? token.assetId,
    chainId: rheaTokenListChainIds[token.blockchain],
    isNative: token.contractAddress === null,
    priceUpdatedAt
  }))
  await context.route('**/get_multichain_lending_tokens_data**', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(rheaTokenRows) })
  )
  if (options.mockRheaCatalog !== false) {
    await context.route('https://api.rhea.finance/get_chain_prices**', route => {
      const chainId = Number(new URL(route.request().url()).searchParams.get('chain'))
      const rows = rheaTokenRows.filter(token => token.chainId === chainId)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: 'success',
          data: Object.fromEntries(rows.map((token, index) => [`${token.assetId}:${index}`, token]))
        })
      })
    })
    await context.route('https://api.rhea.finance/api/swap/supported_to_tokens**', route => {
      const chainId = Number(new URL(route.request().url()).searchParams.get('chain'))
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: 'success',
          data: { tokens: rheaTokenRows.filter(token => token.chainId === chainId) }
        })
      })
    })
  }
  await context.route(LENDING_METADATA_URL, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        'zec.omft.near': {
          decimals: 8,
          icon: '',
          name: 'Zcash',
          symbol: 'ZEC'
        },
        ...(options.includeMultichainMarkets
          ? {
              'eth.bridge.near': {
                decimals: 18,
                icon: '',
                name: 'Ether',
                symbol: 'ETH'
              },
              '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
                decimals: 6,
                icon: '',
                name: 'USD Coin',
                symbol: 'USDC'
              },
              'nbtc.bridge.near': {
                decimals: 8,
                icon: '',
                name: 'Bitcoin',
                symbol: 'NBTC'
              },
              '6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near': {
                decimals: 18,
                icon: '',
                name: 'Dai Stablecoin',
                symbol: 'DAI'
              }
            }
          : {})
      })
    })
  )
  const nearRpcHandler = async (route: Route) => {
    if (!nearOnline) {
      await route.abort('failed')
      return
    }
    const request = route.request().postDataJSON() as {
      id: string | number
      method?: string
      params?: { method_name?: string; block_id?: unknown }
    }
    const near = NEAR_NETWORKS.mainnet
    const attestationResult =
      request.method === 'status'
        ? {
            chain_id: near.network,
            sync_info: { latest_block_hash: near.genesisHash }
          }
        : request.method === 'genesis_config'
          ? {
              chain_id: near.network,
              genesis_height: near.genesisHeight,
              genesis_time: near.genesisTime
            }
          : request.method === 'block' && request.params?.block_id === near.genesisHeight
            ? {
                header: {
                  height: near.genesisHeight,
                  hash: near.genesisHash
                }
              }
            : undefined
    if (attestationResult !== undefined) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result: attestationResult })
      })
      return
    }
    const methodName = request.params?.method_name
    const emptyPortfolio = options.mcaId
      ? {
          booster_staking: null,
          booster_stakings: [],
          farms: [],
          has_non_farmed_assets: false,
          positions: {},
          supplied: options.includeMultichainMarkets
            ? [
                {
                  token_id: 'eth.bridge.near',
                  apr: '0',
                  balance: '15000000000000000000000000000',
                  shares: '15000000000000000000000000000'
                }
              ]
            : []
        }
      : null
    const result =
      methodName === 'current_salt'
        ? '12345678'
        : methodName === 'get_mca_by_wallet'
          ? options.mcaId || null
          : methodName === 'batch_views'
            ? [
                emptyPortfolio,
                null,
                [
                  {
                    token_id: 'zec.omft.near',
                    config: { extra_decimals: 10 },
                    farms: [],
                    supplied: { balance: '0' },
                    supply_apr: '0.05',
                    borrow_apr: '0'
                  },
                  ...(options.includeMultichainMarkets
                    ? [
                        {
                          token_id: 'eth.bridge.near',
                          config: { extra_decimals: 10 },
                          farms: [],
                          supplied: { balance: '420000000000000000000000000000' },
                          supply_apr: '0.03',
                          borrow_apr: '0'
                        },
                        {
                          token_id:
                            '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
                          config: { extra_decimals: 10 },
                          farms: [],
                          supplied: { balance: '1000000000000000000' },
                          supply_apr: '9',
                          borrow_apr: '0'
                        },
                        {
                          token_id: 'nbtc.bridge.near',
                          config: { extra_decimals: 10 },
                          farms: [],
                          supplied: { balance: '3000000000000000000' },
                          supply_apr: '0.2',
                          borrow_apr: '0'
                        },
                        {
                          token_id: '6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near',
                          config: { extra_decimals: 10 },
                          farms: [],
                          supplied: { balance: '50000000000000000000000000000' },
                          supply_apr: '0.04',
                          borrow_apr: '0'
                        }
                      ]
                    : [])
                ],
                { enable_pyth_oracle: false },
                null,
                null,
                null,
                {}
              ]
            : methodName === 'get_price_data'
              ? {
                  prices: [
                    {
                      asset_id: 'zec.omft.near',
                      price: { multiplier: '40', decimals: 8 }
                    },
                    ...(options.includeMultichainMarkets
                      ? [
                          {
                            asset_id: 'eth.bridge.near',
                            price: { multiplier: '2500', decimals: 18 }
                          },
                          {
                            asset_id:
                              '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
                            price: { multiplier: '1', decimals: 6 }
                          },
                          {
                            asset_id: 'nbtc.bridge.near',
                            price: { multiplier: '60000', decimals: 8 }
                          },
                          {
                            asset_id:
                              '6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near',
                            price: { multiplier: '1', decimals: 18 }
                          }
                        ]
                      : [])
                  ]
                }
              : methodName === 'ft_balance_of'
                ? '0'
                : methodName === 'storage_balance_of'
                  ? null
                  : methodName === 'get_booster_tokens' || methodName === 'get_asset_farms_paged'
                    ? []
                    : methodName === 'get_create_mca_fee_paged' ||
                        methodName === 'get_near_values_paged'
                      ? {}
                      : methodName === 'get_create_mca_fee' || methodName === 'get_near_value'
                        ? '0'
                        : undefined
    if (result === undefined) {
      throw new Error(`Unhandled NEAR method in protocol UI test: ${methodName || 'unknown'}`)
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          block_hash: 'near-test-block',
          block_height: 1,
          logs: [],
          result: [...Buffer.from(JSON.stringify(result))]
        }
      })
    })
  }
  for (const url of NEAR_RPC_URLS) await context.route(url, nearRpcHandler)
  let confidentialBalanceReads = 0
  let confidentialDepositAmount = '0'
  let formalWithdrawQuoteCount = 0
  const submittedConfidentialAddresses = new Set<string>()
  const confidentialFormalQuotes = new Map<
    string,
    { readonly correlationId: string; readonly deadline: string; readonly signerId: string }
  >()
  await context.route(`${CONFIDENTIAL_API_URL}/quote`, async route => {
    const request = route.request().postDataJSON() as {
      originAsset: string
      destinationAsset: string
      amount: string
      refundTo: string
      recipient: string
      dry: boolean
      confidentiality: 'basic'
      depositType: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
      refundType: 'ORIGIN_CHAIN' | 'CONFIDENTIAL_INTENTS'
      recipientType: 'CONFIDENTIAL_INTENTS' | 'DESTINATION_CHAIN'
      deadline: string
    }
    quoteRequests.push({
      originAsset: request.originAsset,
      destinationAsset: request.destinationAsset,
      amount: request.amount,
      refundTo: request.refundTo,
      recipient: request.recipient,
      dry: request.dry,
      confidentiality: request.confidentiality,
      depositType: request.depositType,
      refundType: request.refundType,
      recipientType: request.recipientType
    })
    const deposit = request.depositType === 'ORIGIN_CHAIN'
    if (deposit) confidentialDepositAmount = request.amount
    if (!deposit && !request.dry) formalWithdrawQuoteCount += 1
    const correlationId = `confidential-${quoteRequests.length}`
    const depositAddress = deposit
      ? '0x2222222222222222222222222222222222222222'
      : request.dry
        ? undefined
        : `withdraw-${formalWithdrawQuoteCount}.near`
    if (depositAddress && !deposit) {
      confidentialFormalQuotes.set(depositAddress, {
        correlationId,
        deadline: request.deadline,
        signerId: request.refundTo
      })
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        correlationId,
        quoteRequest: request,
        quote: {
          amountIn: request.amount,
          amountOut: request.amount,
          minAmountOut: request.amount,
          deadline: request.deadline,
          ...(depositAddress ? { depositAddress } : {})
        }
      })
    })
  })
  await context.route(`${CONFIDENTIAL_API_URL}/auth/authenticate`, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        accessToken: 'protocol-confidential-access',
        refreshToken: 'protocol-confidential-refresh',
        expiresIn: 3600,
        refreshExpiresIn: 7200
      })
    })
  )
  await context.route(CONFIDENTIAL_BALANCES_URL, route => {
    confidentialBalanceReads += 1
    const available = confidentialBalanceReads > 1 ? confidentialDepositAmount : '0'
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        balances: [{ tokenId: ETH_ASSET, available, source: 'confidential' }]
      })
    })
  })
  await context.route(`${CONFIDENTIAL_API_URL}/generate-intent`, route => {
    const request = route.request().postDataJSON() as { depositAddress: string }
    const quote = confidentialFormalQuotes.get(request.depositAddress)
    if (!quote) throw new Error('Intent requested outside the formal confidential quotes')
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        correlationId: `generated-${request.depositAddress}`,
        intent: {
          standard: 'erc191',
          payload: JSON.stringify({
            signer_id: quote.signerId,
            verifying_contract: 'intents.near',
            deadline: quote.deadline,
            receiver_id: request.depositAddress
          })
        }
      })
    })
  })
  await context.route(`${CONFIDENTIAL_API_URL}/submit-intent`, route => {
    const request = route.request().postDataJSON() as { signedData: { payload: string } }
    const payload = JSON.parse(request.signedData.payload) as { receiver_id: string }
    submittedConfidentialAddresses.add(payload.receiver_id)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        intentHash: 'protocol-confidential-intent',
        correlationId: 'protocol-confidential-submit'
      })
    })
  })
  await context.route(`${CONFIDENTIAL_API_URL}/status**`, route => {
    const address = new URL(route.request().url()).searchParams.get('depositAddress')
    const successful =
      address === '0x2222222222222222222222222222222222222222' ||
      (address !== null && submittedConfidentialAddresses.has(address))
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: successful ? 'SUCCESS' : 'PENDING_DEPOSIT',
        swapDetails: successful
          ? { destinationChainTxHashes: [{ hash: `0x${'a'.repeat(64)}` }] }
          : {}
      })
    })
  })
  await context.route(LENDING_QUOTE_URL, async route => {
    const request = route.request().postDataJSON() as {
      originAsset: string
      amount: string
      deadline: string
    }
    const depositAddress =
      request.originAsset === BTC_ASSET
        ? BITCOIN_DEPOSIT_ADDRESS
        : '0x2222222222222222222222222222222222222222'
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        quote: {
          amountIn: request.amount,
          amountOut: request.amount,
          minAmountOut: request.amount,
          amountInFormatted: request.amount,
          amountOutFormatted: request.amount,
          depositAddress,
          deadline: request.deadline
        }
      })
    })
  })
  if (options.mockRheaQuote !== false) {
    await context.route(QUOTE_URL, async route => {
      const request = route.request().postDataJSON() as {
        fromChain: string
        toChain: string
        tokenIn: string
        tokenOut: string
        amountIn: string
        sender: string
        recipient: string
        confidentiality?: 'basic'
      }
      const originAsset = request.fromChain === 'btc' ? BTC_ASSET : request.tokenIn
      const destinationAsset =
        request.toChain === 'btc'
          ? BTC_ASSET
          : request.toChain === 'near'
            ? NEAR_ASSET
            : request.tokenOut
      quoteRequests.push({
        originAsset,
        destinationAsset,
        amount: request.amountIn,
        refundTo: request.sender,
        recipient: request.recipient,
        dry: false,
        ...(request.confidentiality === undefined
          ? {}
          : { confidentiality: request.confidentiality })
      })
      if (options.quoteResponseDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.quoteResponseDelayMs))
      }
      const amountOut =
        request.tokenOut === ETH_ASSET
          ? request.amountIn
          : request.toChain === 'near'
            ? '5000000000000000000000000'
            : request.toChain === 'btc'
              ? '500000'
              : '500000'
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          msg: 'success',
          data: {
            isCrossChain: request.fromChain !== request.toChain,
            chainType: request.fromChain === 'btc' ? 'bitcoin' : 'evm',
            bestQuote: {
              router: 'nearintents',
              amountOut,
              minAmountOut: amountOut,
              preSwap: null,
              bridge: null,
              expiresAt: Date.now() + 30 * 60_000
            },
            allQuotes: []
          }
        })
      })
    })
  }
  await context.route(BUILD_SWAP_URL, async route => {
    const request = route.request().postDataJSON() as {
      fromChain: string
      toChain: string
      tokenIn: string
      tokenOut: string
      amountIn: string
      sender: string
      expectedOut: string
      minAmountOut: string
      router: string
    }
    const tokenIn =
      request.fromChain === 'btc'
        ? { address: request.tokenIn, symbol: 'BTC', decimals: 8 }
        : request.fromChain === '137'
          ? { address: request.tokenIn, symbol: 'POL', decimals: 18 }
          : request.tokenIn.toLowerCase() === ETHEREUM_USDC_CONTRACT
            ? { address: request.tokenIn, symbol: 'USDC', decimals: 6 }
            : { address: request.tokenIn, symbol: 'ETH', decimals: 18 }
    const tokenOut =
      request.toChain === 'btc'
        ? { address: request.tokenOut, symbol: 'BTC', decimals: 8 }
        : request.toChain === 'near'
          ? { address: request.tokenOut, symbol: 'NEAR', decimals: 24 }
          : request.toChain === 'zcash'
            ? { address: request.tokenOut, symbol: 'ZEC', decimals: 8 }
            : { address: request.tokenOut, symbol: 'USDC', decimals: 6 }
    const tx =
      request.fromChain === 'btc'
        ? {
            kind: 'btc_transfer',
            amount: request.amountIn,
            depositAddress: BITCOIN_DEPOSIT_ADDRESS
          }
        : {
            chainId: Number(request.fromChain),
            from: request.sender,
            to: '0x4444444444444444444444444444444444444444',
            data: '0x1234',
            value: options.evmApproval ? '0' : request.amountIn
          }
    const spender = '0x4444444444444444444444444444444444444444'
    const approve =
      options.evmApproval && request.fromChain === '1'
        ? {
            spender,
            tx: {
              chainId: 1,
              from: request.sender,
              to: request.tokenIn,
              data: `0x095ea7b3${spender.slice(2).padStart(64, '0')}${BigInt(request.amountIn).toString(16).padStart(64, '0')}`,
              value: '0'
            }
          }
        : null
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data: {
          isCrossChain: request.fromChain !== request.toChain,
          chainType: request.fromChain === 'btc' ? 'bitcoin' : 'evm',
          router: request.router,
          fromChain: request.fromChain,
          toChain: request.toChain,
          tokenIn,
          tokenOut,
          amountIn: request.amountIn,
          estimatedOut: request.expectedOut,
          minAmountOut: request.minAmountOut,
          tx,
          approve,
          orderId: 'protocol-private-order',
          statusRouter: 'nearintents'
        }
      })
    })
  })
  await context.route(REPORT_SWAP_URL, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, msg: 'success', data: {} })
    })
  )
  await context.route(`${ORDER_STATUS_URL}**`, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data:
          orderStatus === 'pending'
            ? { status: 'pending' }
            : { status: 'completed', to_hash: `0x${'f'.repeat(64)}` }
      })
    })
  )
  return Object.freeze({
    setTokenOnline: (online: boolean) => {
      tokenOnline = online
    },
    setNearOnline: (online: boolean) => {
      nearOnline = online
    },
    setOrderStatus: (status: 'pending' | 'completed') => {
      orderStatus = status
    },
    getQuoteRequests: () => [...quoteRequests]
  })
}

async function expectNoOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth,
        height: document.documentElement.clientHeight
      }))
    )
    .toEqual({ width: 375, contentWidth: 375, height: 600 })
}

test('renders usable Swap assets while unrelated chain catalogs are pending', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  const pageErrors: string[] = []
  popup.on('pageerror', error => pageErrors.push(error.message))
  let releaseSources: (() => void) | undefined
  const sourcesPending = new Promise<void>(resolve => {
    releaseSources = resolve
  })
  let releaseDestinations: (() => void) | undefined
  const destinationsPending = new Promise<void>(resolve => {
    releaseDestinations = resolve
  })
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => {
    release = resolve
  })
  let pendingRequests = 0
  const catalogChains: number[] = []
  const delayCatalog = async (route: Route) => {
    const chainId = Number(new URL(route.request().url()).searchParams.get('chain'))
    catalogChains.push(chainId)
    if (route.request().url().includes('supported_to_tokens')) {
      await destinationsPending
    } else {
      await sourcesPending
    }
    if (chainId !== 1 && chainId !== 900010) {
      pendingRequests += 1
      await pending
    }
    await route.fallback()
  }
  await context.route('https://api.rhea.finance/get_chain_prices**', delayCatalog)
  await context.route('https://api.rhea.finance/api/swap/supported_to_tokens**', delayCatalog)
  try {
    await waitForBackgroundWalletInitialization(popup)
    await importTestWallet(popup)
    await popup.goto(`chrome-extension://${extensionId}/index.html`)
    await popup.getByRole('button', { name: 'Swap', exact: true }).click()
    await expect(popup.getByRole('status', { name: 'Loading swap assets' })).toBeVisible()
    await captureScreenshot(popup, 'protocol-swap-initial-skeleton.png')
    releaseSources?.()
    await expect(popup.getByRole('button', { name: 'From asset' })).toBeVisible()
    await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('ZEC')
    expect([...new Set(catalogChains)].sort((left, right) => left - right)).toEqual([1, 900010])
    expect(pendingRequests).toBe(0)
    await popup.getByRole('button', { name: 'From asset' }).click()
    const selector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
    await expect(selector.getByRole('button', { name: /^ETH on Ethereum/ })).toBeVisible()
    await selector.getByRole('button', { name: 'Close', exact: true }).click()
    // Keep destination requests blocked across React commits to exercise the former update loop.
    await popup.evaluate(async () => {
      for (let frame = 0; frame < 20; frame++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    })
    expect(pageErrors).toEqual([])
    await expect(popup.getByRole('button', { name: 'From asset' })).toBeVisible()
    releaseDestinations?.()
    await expect(popup.getByRole('button', { name: 'To asset' })).toBeEnabled()
    await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('ETH')
    await expect(popup.getByRole('status', { name: 'Loading swap assets' })).toHaveCount(0)
    await expect.poll(() => pendingRequests).toBeGreaterThan(0)
    await popup.locator('input[placeholder="0"]').fill('1')
    await expectNoOverflow(popup)
    await captureScreenshot(popup, 'protocol-swap-progressive-loading.png')
    await popup.getByRole('button', { name: 'Switch assets', exact: true }).click()
    await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('ETH')
    await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('ZEC')
    await popup.getByRole('button', { name: 'From asset' }).click()
    const nextSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
    await nextSelector.getByPlaceholder('Search tokens').fill('NOTLISTED')
    await expect(
      nextSelector.getByText('Searching more networks...', { exact: true })
    ).toBeVisible()
    await expect(nextSelector.getByText('No tokens found')).toHaveCount(0)
    await nextSelector.getByPlaceholder('Search tokens').fill('USDC')
    const usdcSource = nextSelector.getByRole('button', {
      name: /^USDC on Ethereum, balance 10 USDC$/
    })
    await expect(usdcSource).toBeVisible()
    await usdcSource.click()
    await expect(nextSelector).toHaveCount(0)
    await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('USDC')
    await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('ZEC')
    expect(pageErrors).toEqual([])
  } finally {
    releaseSources?.()
    releaseDestinations?.()
    release?.()
  }
})

test('shows a page-level retry state when RHEA token catalogs are unavailable', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)

  let failedCatalogRequests = 0
  const failCatalogRequest = async (route: Route) => {
    failedCatalogRequests += 1
    await new Promise(resolve => setTimeout(resolve, 300))
    await route.abort('failed')
  }
  await context.route('https://api.rhea.finance/get_chain_prices**', failCatalogRequest)
  await context.route('https://api.rhea.finance/api/swap/supported_to_tokens**', failCatalogRequest)

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()

  const catalogSkeleton = popup.getByRole('status', { name: 'Loading swap assets' })
  await expect(catalogSkeleton).toBeVisible()
  await expect(popup.getByRole('button', { name: 'From asset' })).toHaveCount(0)
  await expect(popup.getByText('Unavailable', { exact: true })).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-rhea-catalog-skeleton.png')

  const unavailableHeading = popup.getByRole('heading', {
    name: 'Unable to load assets'
  })
  await expect(unavailableHeading).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByRole('button', { name: 'From asset' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'To asset' })).toHaveCount(0)
  await expect(popup.getByText('Receive address', { exact: true })).toHaveCount(0)
  await expect(
    popup.getByText('RHEA Swap is unavailable in this build or network', { exact: true })
  ).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-rhea-catalog-unavailable.png')

  const requestsBeforeRetry = failedCatalogRequests
  await popup.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(() => failedCatalogRequests).toBeGreaterThan(requestsBeforeRetry)
  await expect(unavailableHeading).toBeVisible({ timeout: 30_000 })
})

test('loads live RHEA source and destination catalogs in the real MV3 popup', async ({
  context,
  popup,
  extensionId
}) => {
  test.skip(
    process.env.LIVE_RHEA_SWAP_CATALOG !== '1',
    'Set LIVE_RHEA_SWAP_CATALOG=1 to call the public RHEA token-list APIs'
  )
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, { mockRheaCatalog: false })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  const entryStartedAt = Date.now()
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()

  const fromAsset = popup.getByRole('button', { name: 'From asset' })
  await expect(fromAsset).toBeEnabled({ timeout: 60_000 })
  const entryDurationMs = Date.now() - entryStartedAt
  await expect(popup.getByRole('heading', { name: 'Unable to load assets' })).toHaveCount(0)
  console.info('RHEA initial catalog pair', {
    source: await fromAsset.innerText(),
    destination: await popup.getByRole('button', { name: 'To asset' }).innerText()
  })
  await expect(popup.getByRole('button', { name: 'To asset' })).toBeEnabled({ timeout: 60_000 })
  await popup.getByRole('button', { name: 'To asset' }).click()
  const destinationSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await expect(destinationSelector.getByRole('button', { name: / on / }).first()).toBeVisible({
    timeout: 30_000
  })
  await destinationSelector.getByPlaceholder('Search tokens').fill('USDC')
  const polygonUsdc = destinationSelector.getByRole('button', { name: /^USDC on Polygon/ })
  await expect(polygonUsdc).toBeVisible({ timeout: 45_000 })
  const destinationSelectionStartedAt = Date.now()
  await polygonUsdc.click()
  await expect(destinationSelector).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('USDC')
  console.info('RHEA live destination selection', {
    selectionDurationMs: Date.now() - destinationSelectionStartedAt
  })
  const openStartedAt = Date.now()
  await fromAsset.click()
  const sourceSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await expect(sourceSelector.getByPlaceholder('Search tokens')).toBeVisible()
  const openDurationMs = Date.now() - openStartedAt
  const searchStartedAt = Date.now()
  await sourceSelector.getByPlaceholder('Search tokens').fill('ETH')
  const searchDurationMs = Date.now() - searchStartedAt
  const ethereumToken = sourceSelector.getByRole('button', { name: /^ETH on Ethereum/ }).first()
  await expect(ethereumToken).toBeVisible({ timeout: 45_000 })
  const ethereumCatalogDurationMs = Date.now() - openStartedAt
  const selectionStartedAt = Date.now()
  await ethereumToken.click()
  await expect(sourceSelector).toHaveCount(0)
  await expect(fromAsset).toContainText('ETH')
  const selectionDurationMs = Date.now() - selectionStartedAt
  console.info('RHEA live selector timings', {
    entryDurationMs,
    openDurationMs,
    searchDurationMs,
    ethereumCatalogDurationMs,
    selectionDurationMs
  })
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-rhea-live-token-catalogs.png')
})

test('quotes a live confidential RHEA route from the Private account', async ({
  context,
  popup,
  extensionId
}) => {
  test.skip(
    process.env.LIVE_RHEA_SWAP_QUOTE !== '1',
    'Set LIVE_RHEA_SWAP_QUOTE=1 to call the public RHEA quote API'
  )
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, { mockRheaCatalog: false, mockRheaQuote: false })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()

  const fromAsset = popup.getByRole('button', { name: 'From asset' })
  await expect(fromAsset).toBeEnabled({ timeout: 60_000 })
  await fromAsset.click()
  const sourceSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await sourceSelector.getByPlaceholder('Search tokens').fill('ETH')
  const walletEth = sourceSelector.getByRole('button', {
    name: /^ETH on Ethereum, balance 1 ETH$/
  })
  await expect(walletEth.first()).toBeVisible({ timeout: 45_000 })
  await walletEth.first().click()
  await expect(sourceSelector).toHaveCount(0)
  await expect(fromAsset).toContainText('ETH')

  await popup
    .getByRole('button', { name: /^Choose source account, current (main|private)$/ })
    .click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current private' })
  ).toBeVisible()

  await popup.getByRole('button', { name: 'To asset' }).click()
  const destinationSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await destinationSelector.getByPlaceholder('Search tokens').fill('USDC')
  const baseUsdc = destinationSelector.getByRole('button', { name: /^USDC on Base/ })
  await expect(baseUsdc).toHaveCount(1, { timeout: 45_000 })
  await baseUsdc.click()
  await expect(destinationSelector).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('USDC')

  const liveQuoteRequest = context.waitForEvent('request', {
    predicate: request => request.url() === QUOTE_URL && request.method() === 'POST',
    timeout: 60_000
  })
  const liveQuoteResponse = context.waitForEvent('response', {
    predicate: response => response.url() === QUOTE_URL && response.request().method() === 'POST',
    timeout: 60_000
  })
  void liveQuoteRequest.catch(() => undefined)
  void liveQuoteResponse.catch(() => undefined)
  await popup.locator('input[placeholder="0"]').fill('0.01')
  const quoteRequest = await liveQuoteRequest
  const quoteInput = quoteRequest.postDataJSON() as { toChain?: unknown; tokenOut?: unknown }
  expect(quoteInput.toChain).toBe('8453')
  expect(typeof quoteInput.tokenOut === 'string' ? quoteInput.tokenOut.toLowerCase() : null).toBe(
    BASE_USDC_CONTRACT.toLowerCase()
  )
  const quoteResponse = await liveQuoteResponse
  expect(quoteResponse.ok(), `RHEA quote HTTP ${quoteResponse.status()}`).toBe(true)
  const quoteBody = (await quoteResponse.json()) as { code?: unknown }
  if (typeof quoteBody.code === 'number') {
    expect(quoteBody.code, 'RHEA quote response code').toBe(0)
  }
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 60_000
  })
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'private-defi-live-confidential-quote.png')
})

test('routes a dApp Private transfer through Confidential and returns the destination hash', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  const evmNetwork = await mockEvmNetwork(context, { allowBroadcast: true })
  const protocolApis = await mockProtocolApis(context)

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })

  const dapp = await connectEvmDApp(context)
  await popup.bringToFront()
  await popup.getByRole('button', { name: 'dApp address: Public' }).click()
  await popup
    .getByRole('dialog', { name: 'dApp address' })
    .getByRole('radio', { name: 'Use Confidential address for dApps' })
    .click()
  const privateSetupDialog = popup.getByRole('dialog', { name: 'Turn on dApp privacy?' })
  if (await privateSetupDialog.isVisible()) {
    await privateSetupDialog.getByRole('button', { name: 'Turn on' }).click()
  }
  await expect
    .poll(async () => (await readEvmAccounts(dapp.page))[0], { timeout: 30_000 })
    .not.toBe(dapp.address)
  const [resolvedPrivateAddress] = await readEvmAccounts(dapp.page)
  expect(resolvedPrivateAddress).toMatch(/^0x[0-9a-f]{40}$/)
  evmNetwork.setAddressBalanceRaw(resolvedPrivateAddress, 1_000_000_000_000_000_000n)

  await dapp.page.bringToFront()
  const approvalPromise = context.waitForEvent('page')
  const transactionPromise = dapp.page.evaluate(
    async ({ from, to }) => {
      const provider = (
        window as typeof window & {
          noirwallet: {
            ethereum: {
              request: (input: { method: string; params?: unknown[] }) => Promise<unknown>
            }
          }
        }
      ).noirwallet.ethereum
      try {
        return {
          result: await provider.request({
            method: 'eth_sendTransaction',
            params: [{ from, to, value: '0x1' }]
          })
        }
      } catch (error) {
        const providerError = error as { code?: unknown; message?: unknown }
        return { error: { code: providerError.code, message: providerError.message } }
      }
    },
    { from: resolvedPrivateAddress, to: '0x1111111111111111111111111111111111111111' }
  )
  void transactionPromise.catch(() => undefined)
  const approval = await approvalPromise
  await approval.waitForURL(/#approval\?requestId=/)
  await approval.setViewportSize({ width: 375, height: 632 })
  await expect(approval.getByRole('heading', { name: 'Confidential transfer' })).toBeVisible({
    timeout: 30_000
  })
  await expect(approval.getByText('Confidential → Intents → Recipient')).toBeVisible()
  await expect(approval.getByText('Minimum received', { exact: true })).toBeVisible()
  await expect(approval.getByText('0.000000000000000001 ETH').first()).toBeVisible()
  expect(evmNetwork.getBroadcastCount()).toBe(0)

  await expect.poll(() => protocolApis.getQuoteRequests().length).toBeGreaterThan(0)
  const quote = protocolApis.getQuoteRequests().at(-1)
  expect(quote).toMatchObject({
    originAsset: ETH_ASSET,
    destinationAsset: ETH_ASSET,
    amount: '1',
    confidentiality: 'basic'
  })
  expect(quote?.refundTo.toLowerCase()).toBe(resolvedPrivateAddress.toLowerCase())
  expect(quote?.recipient).toBe('0x1111111111111111111111111111111111111111')
  await expect
    .poll(() =>
      approval.evaluate(() => [
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth
      ])
    )
    .toEqual([375, 375])
  await captureScreenshot(approval, 'THU-DEMO-dApp-Private-Confidential-transfer.png')

  await approval.getByRole('button', { name: 'Send privately', exact: true }).click()
  await expect(transactionPromise).resolves.toEqual({ result: `0x${'f'.repeat(64)}` })
  await expect.poll(evmNetwork.getBroadcastCount, { timeout: 30_000 }).toBe(1)
})

test('reviews a funded Private EVM send before broadcasting through Intents', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  const evmNetwork = await mockEvmNetwork(context, { allowBroadcast: true })
  await mockBitcoinNetwork(context)
  const protocolApis = await mockProtocolApis(context)

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
    timeout: 30_000
  })

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()

  const privateSourceAddress = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const activeAccount = response?.result?.accounts?.find(
      (account: { active?: unknown }) => account.active === true
    )
    const ethereum = activeAccount?.networks?.find(
      (network: { chainId?: unknown; privateExecutionAddress?: unknown }) =>
        network.chainId === 'eip155:1' && typeof network.privateExecutionAddress === 'string'
    )
    if (typeof ethereum?.privateExecutionAddress !== 'string') {
      throw new Error('Ethereum Private Execution Address is unavailable')
    }
    return ethereum.privateExecutionAddress
  })
  const recipient = '0x9C73842d02D1Fe00000000000000000000000000'
  await popup.getByLabel('Send To').fill(recipient)
  await popup.getByLabel('ETH amount').fill('0.01')
  await expect(popup.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
  await popup.getByRole('button', { name: 'Continue', exact: true }).click()

  await expect(popup.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await expect(popup.getByText('Recipient', { exact: true })).toBeVisible()
  await expect(popup.getByText(recipient, { exact: true })).toBeVisible()

  await expect.poll(() => protocolApis.getQuoteRequests().length).toBeGreaterThan(0)
  const quote = protocolApis.getQuoteRequests().at(-1)
  expect(quote).toMatchObject({
    originAsset: ETH_ASSET,
    destinationAsset: ETH_ASSET,
    amount: '10000000000000000',
    confidentiality: 'basic'
  })
  expect(quote?.refundTo.toLowerCase()).toBe(privateSourceAddress.toLowerCase())
  expect(quote?.recipient.toLowerCase()).toBe(recipient.toLowerCase())
  expect(evmNetwork.getBroadcastCount()).toBe(0)
  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'private-send-confidential-review-route.png')
  await popup.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(evmNetwork.getBroadcastCount, { timeout: 30_000 }).toBe(1)
  await expect(popup.getByRole('region', { name: 'Transaction progress' })).toBeVisible()
})

test('keeps transfer input free of warnings while route readiness is pending', async ({
  context,
  popup,
  extensionId
}) => {
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible()

  let releaseCatalog: () => void = () => {}
  const catalogPending = new Promise<void>(resolve => {
    releaseCatalog = resolve
  })
  await context.route('https://api.rhea.finance/get_chain_prices?chain=1', async route => {
    await catalogPending
    await route.fallback()
  })
  try {
    await popup.getByRole('button', { name: 'View ETH details on Ethereum' }).click()
    await popup
      .getByRole('button', { name: 'Transfer ETH between Public and Confidential' })
      .click()
    const dialog = popup.getByRole('dialog', { name: 'Transfer ETH' })
    const amount = dialog.getByLabel('Transfer amount')
    const review = dialog.getByRole('button', { name: 'Review transfer' })
    await expect(review).toBeDisabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await amount.fill('0.')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await amount.fill('0.01')
    await expect(review).toBeDisabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await captureScreenshot(popup, 'balance-transfer-route-loading.png')
    releaseCatalog()
    await expect(review).toBeEnabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await amount.fill('999')
    await expect(dialog.getByRole('alert')).toContainText('Amount exceeds')
    await expect(review).toBeDisabled()
    await amount.fill('0.01')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(review).toBeEnabled()
    await expectNoOverflow(popup)
    await captureScreenshot(popup, 'balance-transfer-clean-input.png')
  } finally {
    releaseCatalog()
  }
})

for (const direction of ['main-to-private', 'private-to-main'] as const) {
  test(`deducts native gas from Available and Max in ${direction} balance transfer`, async ({
    context,
    popup,
    extensionId
  }) => {
    test.setTimeout(120_000)
    const rpc = await mockEvmNetwork(context, {
      balanceRaw: 2_976_040_456_329_000n,
      contractGas: '0x249f0'
    })
    await mockBitcoinNetwork(context)
    const api = await mockProtocolApis(context)
    await waitForBackgroundWalletInitialization(popup)
    await importTestWallet(popup)
    await popup.goto(`chrome-extension://${extensionId}/index.html`)
    const ethDetails = popup.getByRole('button', { name: 'View ETH details on Ethereum' })
    await expect(ethDetails).toBeVisible({ timeout: 30_000 })
    await ethDetails.click()
    await popup
      .getByRole('button', { name: 'Transfer ETH between Public and Confidential' })
      .click()
    const sheet = popup.getByRole('dialog', { name: 'Transfer ETH' })
    if (direction === 'private-to-main')
      await sheet.getByRole('button', { name: 'Switch transfer direction' }).click()
    await expect(sheet.getByTestId('private-balance-transfer-amount')).toContainText(
      'Balance 0.002976 ETH',
      { timeout: 30_000 }
    )
    await sheet.getByLabel('Transfer amount').fill('0.002976040456329')
    await sheet.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(sheet.getByLabel('Transfer amount')).toHaveValue('0.002301040456329', {
      timeout: 30_000
    })
    await expect(sheet.getByTestId('private-balance-transfer-amount')).toContainText(
      'Available 0.002301 ETH'
    )
    await expectNoOverflow(popup)
    await captureScreenshot(popup, `transfer-native-max-${direction}-available.png`)
    await sheet.getByRole('button', { name: 'Review transfer' }).click()
    await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({
      timeout: 60_000
    })
    await expect(popup.getByText('0.00054 ETH', { exact: true })).toBeVisible()
    expect(api.getQuoteRequests().at(-1)?.amount).toBe('2301040456329000')
    await captureScreenshot(popup, `transfer-native-max-${direction}-review.png`)
    await popup.getByRole('button', { name: 'Edit network fee' }).click()
    await popup
      .getByRole('dialog', { name: 'Network Fee' })
      .getByRole('radio', { name: /Fast/ })
      .click()
    await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({
      timeout: 60_000
    })
    await expect(popup.getByText('0.00072 ETH', { exact: true })).toBeVisible({ timeout: 60_000 })
    expect(api.getQuoteRequests().at(-1)?.amount).toBe('2076040456329000')
    expect(rpc.getBroadcastCount()).toBe(0)
    await captureScreenshot(popup, `transfer-native-max-${direction}-fast.png`)
  })
}

test('keeps a Main USDC send to the owned private address in Main Activity and allows cancellation', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  const rpc = await mockEvmNetwork(context, { allowBroadcast: true, pendingBroadcast: true })
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)

  const privateAddress = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const active = response?.result?.accounts?.find(
      (account: { active?: unknown }) => account.active === true
    )
    const ethereum = active?.networks?.find(
      (entry: { chainId?: unknown }) => entry.chainId === 'eip155:1'
    )
    if (typeof ethereum?.privateExecutionAddress !== 'string')
      throw new Error('Private EVM address is unavailable')
    return ethereum.privateExecutionAddress as string
  })
  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send USDC on Ethereum' }).click()
  await popup.getByLabel('Send To').fill(privateAddress)
  await popup.getByLabel('USDC amount').fill('5')
  await expect(popup.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Continue', exact: true }).click()
  await popup
    .getByRole('dialog', { name: 'Review Send' })
    .getByRole('button', { name: 'Send', exact: true })
    .click()
  await expect.poll(rpc.getBroadcastCount, { timeout: 30_000 }).toBe(1)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const row = popup.getByRole('button', { name: 'View Sent USDC details' })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).not.toHaveAttribute('data-activity-account-mode', 'private')
  await captureScreenshot(popup, 'main-usdc-to-private-public-activity.png')
  await row.click()
  await popup.getByRole('button', { name: 'Cancel transaction' }).click()
  await expect(
    popup.getByRole('dialog', { name: 'Cancel transaction' }).last().getByText('Nonce', {
      exact: true
    })
  ).toBeVisible()
  expect(rpc.getBroadcastCount()).toBe(1)
  await captureScreenshot(popup, 'main-usdc-to-private-cancel-review.png')
  await popup
    .getByRole('dialog', { name: 'Cancel transaction' })
    .last()
    .getByRole('button', { name: 'Confirm cancel', exact: true })
    .click()
  await expect(popup.getByText('Cancellation submitted', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  await expect.poll(rpc.getBroadcastCount, { timeout: 30_000 }).toBe(2)
  const [originalRaw, cancellationRaw] = rpc.getBroadcastRawTransactions()
  const original = parseTransaction(originalRaw as Hex)
  const cancellation = parseTransaction(cancellationRaw as Hex)
  expect(cancellation.nonce).toBe(original.nonce)
  expect(cancellation.value ?? 0n).toBe(0n)
  expect(cancellation.maxFeePerGas).toBeGreaterThan(original.maxFeePerGas ?? 0n)
  expect(cancellation.maxPriorityFeePerGas).toBeGreaterThan(original.maxPriorityFeePerGas ?? 0n)
  await captureScreenshot(popup, 'main-usdc-to-private-cancel-submitted.png')
})

for (const sourceMode of ['main', 'private'] as const) {
  test(`deducts native gas from Available and Max in ${sourceMode} Send`, async ({
    context,
    popup,
    extensionId
  }) => {
    test.setTimeout(120_000)
    const rpc = await mockEvmNetwork(context, {
      allowBroadcast: sourceMode === 'private',
      balanceRaw: 2_976_040_456_329_000n,
      contractGas: '0x249f0'
    })
    await mockBitcoinNetwork(context)
    await mockProtocolApis(context)
    await waitForBackgroundWalletInitialization(popup)
    await importTestWallet(popup)
    await popup.goto(`chrome-extension://${extensionId}/index.html`)
    await popup.getByRole('button', { name: 'Send', exact: true }).click()
    await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
    await popup.getByLabel('Send To').fill('0x2222222222222222222222222222222222222222')
    if (sourceMode === 'private') {
      await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
      await popup
        .getByRole('dialog', { name: 'Choose source account' })
        .getByRole('radio', { name: /Confidential account/ })
        .click()
    }
    const amount = sourceMode === 'main' ? '0.002897290456329' : '0.002301040456329'
    await expect(popup.getByRole('button', { name: 'Max', exact: true })).toBeEnabled({
      timeout: 30_000
    })
    await popup.getByRole('button', { name: 'Max', exact: true }).click()
    await expect(popup.getByLabel('ETH amount')).toHaveValue(amount, { timeout: 30_000 })
    await expect(popup.getByTestId('send-amount-card')).toContainText(
      sourceMode === 'main' ? 'Available 0.002897 ETH' : 'Available 0.002301 ETH'
    )
    await expect(popup.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({
      timeout: 30_000
    })
    await expectNoOverflow(popup)
    await captureScreenshot(popup, `send-native-max-${sourceMode}-available.png`)
    await popup.getByRole('button', { name: 'Continue', exact: true }).click()
    if (sourceMode === 'main') {
      await expect(
        popup
          .getByRole('dialog', { name: 'Review Send' })
          .getByRole('button', { name: 'Send', exact: true })
      ).toBeEnabled({ timeout: 30_000 })
      expect(rpc.getBroadcastCount()).toBe(0)
      await captureScreenshot(popup, `send-native-max-${sourceMode}-review.png`)
    } else {
      await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({
        timeout: 30_000
      })
      expect(rpc.getBroadcastCount()).toBe(0)
      await captureScreenshot(popup, 'send-native-max-private-review.png')
      await popup.getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect
        .poll(() => rpc.getBroadcastValues().at(-1), { timeout: 30_000 })
        .toBe(2_301_040_456_329_000n)
      await expect(popup.getByRole('region', { name: 'Transaction progress' })).toBeVisible()
      await captureScreenshot(popup, 'send-native-max-private-result.png')
    }
  })
}

test('reviews and submits Main to Confidential from the unified transfer sheet', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  const evmNetwork = await mockEvmNetwork(context, { allowBroadcast: true })
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, { orderStatus: 'pending' })
  let releasePreparation: () => void = () => {}
  let preparationFails = true
  const preparationPending = new Promise<void>(resolve => {
    releasePreparation = resolve
  })
  await context.route(BUILD_SWAP_URL, async route => {
    await preparationPending
    if (preparationFails) {
      await route.fulfill({ status: 502, body: 'Unavailable' })
      return
    }
    await route.fallback()
  })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible({
    timeout: 30_000
  })
  await popup
    .getByRole('button', {
      name: /(?:Estimated total assets|Total assets) .*show Public and Confidential totals/
    })
    .hover()
  await expect(popup.getByRole('tooltip')).toContainText('Public')
  await expect(popup.getByRole('tooltip')).toContainText('Confidential')
  await expect(popup.getByRole('tooltip')).toContainText('$')
  await expect(popup.getByText('Total Assets', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'home-total-assets-amount-hover.png', {
    preservePointer: true
  })
  await popup.getByRole('button', { name: 'View ETH details on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Transfer ETH between Public and Confidential' }).click()
  const transferDialog = popup.getByRole('dialog', { name: 'Transfer ETH' })
  await expect(transferDialog.locator('p[title^="0x"]')).toHaveCount(2)
  await captureScreenshot(popup, 'balance-transfer-public-confidential-addresses.png')
  await transferDialog.getByLabel('Transfer amount').fill('0.01')
  await expect(transferDialog.getByRole('button', { name: 'Review transfer' })).toBeEnabled({
    timeout: 30_000
  })
  await transferDialog.getByRole('button', { name: 'Review transfer' }).click()

  try {
    await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled({
      timeout: 30_000
    })
    await expect(popup.getByText('0.01 ETH', { exact: true })).toBeVisible()
    await expect(popup.getByText('Network fee', { exact: true })).toBeVisible()
    await expect(popup.getByText('Preparing transfer', { exact: true })).toHaveCount(0)
    expect(evmNetwork.getBroadcastCount()).toBe(0)
    await expectNoOverflow(popup)
    await captureScreenshot(popup, 'balance-transfer-main-to-confidential-preparing.png')
  } finally {
    releasePreparation()
  }
  await expect(popup.getByRole('alert')).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
  expect(evmNetwork.getBroadcastCount()).toBe(0)
  await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport({
    ratio: 1
  })
  await captureScreenshot(popup, 'balance-transfer-main-to-confidential-preparation-error.png')
  preparationFails = false
  await popup.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await expect(popup.getByRole('heading')).toHaveCount(1)
  await expect(popup.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(popup.getByText('From', { exact: true })).toBeVisible()
  await expect(popup.getByText('Receive in', { exact: true })).toBeVisible()
  await expect(popup.getByText('Send To', { exact: true })).toBeVisible()
  await expect(popup.getByText('You receive', { exact: true })).toBeVisible()
  await expect(popup.getByText('Estimated time', { exact: true })).toBeVisible()
  await expect(popup.getByText('3-5 min', { exact: true })).toBeVisible()
  await expect(popup.getByText('Public', { exact: true })).toBeVisible()
  await expect(popup.getByText('Confidential', { exact: true })).toBeVisible()
  await expect(popup.getByText('Price Impact', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Slippage Tolerance', { exact: true })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Confirm' })).toBeEnabled({
    timeout: 30_000
  })
  expect(evmNetwork.getBroadcastCount()).toBe(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'balance-transfer-main-to-confidential-review.png')

  await popup.getByRole('button', { name: 'Confirm' }).click()
  await expect.poll(() => evmNetwork.getBroadcastCount(), { timeout: 30_000 }).toBeGreaterThan(0)
  await expect(popup.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(popup.getByRole('region', { name: 'Transaction progress' })).toBeVisible()
  await expect(popup.getByRole('heading', { name: 'Confirming transfer' })).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'balance-transfer-main-to-confidential-progress.png')

  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const accountTransferRow = popup.locator('[data-activity-kind="transfer"]')
  await expect(accountTransferRow).toHaveCount(1)
  await expect(accountTransferRow).toContainText('Account Transfer')
  await expect(accountTransferRow).toContainText('Public → Confidential')
  await expect(
    accountTransferRow.locator('[data-activity-avatar="swap"] [data-slot="token-icon"]')
  ).toHaveCount(1)
  const transferIconLeft = await accountTransferRow
    .locator('[data-activity-avatar="swap"] [data-slot="token-icon"]')
    .evaluate(icon => icon.getBoundingClientRect().left)
  const transferRowLeft = await accountTransferRow.evaluate(row => row.getBoundingClientRect().left)
  expect(transferIconLeft - transferRowLeft).toBe(20)
  await expect(popup.getByRole('button', { name: /^View Sent ETH/ })).toHaveCount(0)
  await captureScreenshot(popup, 'activity-public-to-confidential-transfer.png')
})

test('reviews and submits Confidential to Main from the unified transfer sheet', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  const evmNetwork = await mockEvmNetwork(context, { allowBroadcast: true })
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, { orderStatus: 'pending' })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'View ETH details on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Transfer ETH between Public and Confidential' }).click()
  const transferDialog = popup.getByRole('dialog', { name: 'Transfer ETH' })
  await transferDialog.getByRole('button', { name: 'Switch transfer direction' }).click()
  await transferDialog.getByLabel('Transfer amount').fill('0.01')
  await expect(transferDialog.getByRole('button', { name: 'Review transfer' })).toBeEnabled({
    timeout: 30_000
  })
  await transferDialog.getByRole('button', { name: 'Review transfer' }).click()

  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await expect(popup.getByRole('heading')).toHaveCount(1)
  await expect(popup.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(popup.getByText('From', { exact: true })).toBeVisible()
  await expect(popup.getByText('Receive in', { exact: true })).toBeVisible()
  await expect(popup.getByText('Send To', { exact: true })).toBeVisible()
  await expect(popup.getByText('You receive', { exact: true })).toBeVisible()
  await expect(popup.getByText('Estimated time', { exact: true })).toBeVisible()
  await expect(popup.getByText('3-5 min', { exact: true })).toBeVisible()
  await expect(popup.getByText('Confidential', { exact: true })).toBeVisible()
  await expect(popup.getByText('Public', { exact: true })).toBeVisible()
  await expect(popup.getByText('Price Impact', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Slippage Tolerance', { exact: true })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Confirm' })).toBeEnabled({
    timeout: 30_000
  })
  expect(evmNetwork.getBroadcastCount()).toBe(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'balance-transfer-confidential-to-main-review.png')

  await popup.getByRole('button', { name: 'Confirm' }).click()
  await expect.poll(() => evmNetwork.getBroadcastCount(), { timeout: 30_000 }).toBeGreaterThan(0)
  await expect(popup.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(popup.getByRole('region', { name: 'Transaction progress' })).toBeVisible()
  await expect(popup.getByRole('heading', { name: 'Confirming transfer' })).toHaveCount(0)
  await expect(popup.getByText('Refund', { exact: true })).toHaveCount(0)
  const transferActivity = (await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_ACTIVITY' })
  )) as {
    result?: {
      items?: Array<{
        kind: string
        source: string
        segments: Array<{ role: string; evidence?: { transactionHash?: string } }>
      }>
    }
  }
  const transferRecord = transferActivity.result?.items?.find(
    item => item.source === 'wallet-v2' && item.segments.some(segment => segment.role === 'relay')
  )
  expect(transferRecord?.kind).toBe('transfer')
  const outgoingHash = transferRecord?.segments.find(segment => segment.role === 'origin')?.evidence
    ?.transactionHash
  expect(outgoingHash).toMatch(/^0x[0-9a-fA-F]{64}$/)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'balance-transfer-confidential-to-main-progress.png')

  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'dApp address: Public' }).click()
  await popup
    .getByRole('dialog', { name: 'dApp address' })
    .getByRole('radio', { name: 'Use Confidential address for dApps' })
    .click()
  const privacyDialog = popup.getByRole('dialog', { name: 'Turn on dApp privacy?' })
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: 'Turn on', exact: true }).click()
  }
  await expect(popup.getByRole('button', { name: 'dApp address: Confidential' })).toBeVisible()
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const accountTransferRow = popup.locator('[data-activity-kind="transfer"]')
  await expect(accountTransferRow).toHaveCount(1)
  await expect(accountTransferRow).toContainText('Account Transfer')
  await expect(accountTransferRow).toContainText('Confidential → Public')
  await expect(
    accountTransferRow.locator('[data-activity-avatar="swap"] [data-slot="token-icon"]')
  ).toHaveCount(1)
  await expect(popup.getByRole('button', { name: /^View Sent ETH/ })).toHaveCount(0)
  await captureScreenshot(popup, 'activity-confidential-to-public-transfer.png')
  const privateRow = popup.locator('[data-activity-account-mode="private"]').first()
  await expect(privateRow).toBeVisible()
  const privateIcon = privateRow.locator('[aria-label="Confidential"]')
  await expect(privateIcon).toBeVisible()
  await expect(privateIcon).toHaveText('')
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'activity-confidential-icon.png')
  await privateIcon.hover()
  await expect(popup.getByRole('tooltip')).toContainText('Confidential')
  await captureScreenshot(popup, 'activity-confidential-icon-hover.png', {
    preservePointer: true
  })
  await privateRow.click()
  const transferDetail = popup.locator('[data-activity-detail-id]')
  await expect(transferDetail).toBeVisible()
  await expect(transferDetail.getByRole('heading', { name: 'Account Transfer' })).toBeVisible()
  await expect(
    transferDetail.locator('[data-activity-swap-detail] [data-slot="token-icon"]')
  ).toHaveCount(1)
  await expect(transferDetail.getByText('Network', { exact: true })).toBeVisible()
  await expect(transferDetail.getByText('Route', { exact: true })).toHaveCount(0)
  await captureScreenshot(popup, 'activity-confidential-to-public-transfer-detail.png')
  await expect(transferDetail.getByText('Outgoing Hash', { exact: true })).toHaveCount(0)
  await expect(
    transferDetail.locator(`[data-progress-step] a[title="${outgoingHash}"]`)
  ).toBeVisible()
  await expect(transferDetail.getByText('Refund', { exact: true })).toHaveCount(0)
})

test('shows only the header title on the Swap review page in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  for (const [direction, symbol, network] of [
    ['To', 'USDC', 'Polygon'],
    ['From', 'ETH', 'Ethereum']
  ] as const) {
    await popup.getByRole('button', { name: `${direction} asset` }).click()
    const assets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
    await assets.getByPlaceholder('Search tokens').fill(symbol)
    await assets
      .getByRole('button', { name: new RegExp(`^${symbol} on ${network}`) })
      .first()
      .click()
  }
  await popup.getByRole('textbox', { name: 'From amount' }).fill('0.01')
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled()
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Review Swap', exact: true })).toBeVisible()
  await expect(popup.getByRole('heading')).toHaveCount(1)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-review-single-header.png')
})

test('reviews a same-token cross-chain Send with the destination address in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  const api = await mockProtocolApis(context, { evmApproval: true })
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send USDC on Ethereum' }).click()
  await expect(popup.getByRole('group', { name: 'Send mode' })).toHaveCount(0)
  await expect(popup.getByText('To Ethereum', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'cross-chain-send-network-entry.png')
  await popup.getByRole('button', { name: 'Send route, current On-chain' }).click()
  await popup.getByRole('menuitemradio', { name: 'Cross-chain' }).click()
  await expect(popup.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Send route, current Cross-chain' })).toBeVisible()
  await expect(popup.getByRole('dialog', { name: 'SELECT NETWORK' })).toHaveCount(0)
  await popup.getByRole('button', { name: 'To asset' }).click()
  const destinations = popup.getByRole('dialog', { name: 'SELECT NETWORK' })
  await destinations.getByPlaceholder('Search tokens').fill('USDC')
  await destinations.getByRole('button', { name: /^USDC on Polygon/ }).click()
  await expect(popup.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
  await expect(popup.getByRole('group', { name: 'Send mode' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'From asset' })).toBeDisabled()
  await popup.getByRole('textbox', { name: 'From amount' }).fill('1')
  await expect(popup.getByRole('button', { name: 'Review Send' })).toBeEnabled()
  const walletRecipient = api.getQuoteRequests().at(-1)?.recipient
  expect(walletRecipient).toMatch(/^0x[0-9a-fA-F]{40}$/)
  const externalRecipient = `0x${'12'.repeat(20)}`
  await popup.getByRole('button', { name: 'Change', exact: true }).click()
  await popup.getByRole('textbox', { name: 'Destination address' }).fill(externalRecipient)
  await expect.poll(() => api.getQuoteRequests().at(-1)?.recipient).toBe(externalRecipient)
  expect(walletRecipient).not.toBe(externalRecipient)
  await expect(popup.getByRole('button', { name: 'Review Send' })).toBeEnabled()
  await captureScreenshot(popup, 'cross-chain-send-input.png')
  await popup.getByRole('button', { name: 'Review Send' }).click()

  await expect(popup.getByRole('heading', { name: 'Review Send' })).toBeVisible()
  await expect(popup.getByText('Polygon', { exact: true })).toBeVisible()
  await expect(popup.getByText('Recipient', { exact: true })).toBeVisible()
  await expect(popup.locator('span[title^="0x"]', { hasText: externalRecipient })).toBeVisible()
  const recipientBounds = await popup
    .locator('span[title^="0x"]', { hasText: /^0x[0-9a-fA-F]{40}$/ })
    .boundingBox()
  if (!recipientBounds) throw new Error('Recipient address is missing from the review')
  expect(recipientBounds.y + recipientBounds.height).toBeLessThan(535)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'cross-chain-send-review.png')

  await popup.getByRole('button', { name: 'Back' }).click()
  await popup.getByRole('button', { name: 'Send route, current Cross-chain' }).click()
  await popup.getByRole('menuitemradio', { name: 'On-chain' }).click()
  await expect(popup.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Send route, current On-chain' })).toBeVisible()
  await expect(popup.getByText('To Ethereum', { exact: true })).toBeVisible()
  await expect(popup.getByRole('group', { name: 'Send mode' })).toHaveCount(0)
})

test('returns to the selected Send asset after switching to the cross-chain route', async ({
  context,
  popup,
  extensionId
}) => {
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Send route, current On-chain' }).click()
  await popup.getByRole('menuitemradio', { name: 'Cross-chain' }).click()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('button', { name: 'Send route, current On-chain' })).toBeVisible()
  await expect(popup.getByText('To Ethereum', { exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('button', { name: 'Send ETH on Ethereum' })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
})

test('shows the provider quote error on cross-chain Send', async ({
  context,
  popup,
  extensionId
}) => {
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await context.route(QUOTE_URL, route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 422,
        msg: 'Temporary swap limits: minimum swap amount is $1,000',
        data: null
      })
    })
  )
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send USDC on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Send route, current On-chain' }).click()
  await popup.getByRole('menuitemradio', { name: 'Cross-chain' }).click()
  await popup.getByRole('button', { name: 'To asset' }).click()
  const destinations = popup.getByRole('dialog', { name: 'SELECT NETWORK' })
  await destinations.getByPlaceholder('Search tokens').fill('USDC')
  await destinations.getByRole('button', { name: /^USDC on Polygon/ }).click()
  await popup.getByRole('textbox', { name: 'From amount' }).fill('1')

  await expect(
    popup.getByText('Temporary swap limits: minimum swap amount is $1,000', { exact: true })
  ).toBeVisible()
})

test('formats long Send balances and reviews without a redundant Confidential route card in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  const rpc = await mockEvmNetwork(context, { balanceRaw: 4_744_096_852_704_854n })
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  await popup.getByLabel('Send To').fill('0x2222222222222222222222222222222222222222')
  await popup.getByLabel('ETH amount').fill('0.001234567890123456')
  const amountCard = popup.getByTestId('send-amount-card')
  await expect(amountCard).toContainText('Balance 0.004744 ETH')
  await expect(amountCard.locator('[title^="0.004744096852704854 ETH"]')).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'send-formatted-main-amount.png')
  await popup.getByRole('button', { name: 'Continue', exact: true }).click()
  const review = popup.getByRole('dialog')
  await expect(review.getByText('0.001234567890123456', { exact: true })).toBeVisible()
  await expect(review.locator('[title="0.001234567890123456"]')).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'send-formatted-amount-review.png')
  await review.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(popup.getByLabel('ETH amount')).toHaveValue('0.001234567890123456')
  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()
  await popup.getByLabel('ETH amount').fill('0.001')
  await expect(popup.getByText('Confidential route', { exact: true })).toHaveCount(0)
  await expect(popup.getByTestId('send-network-fee')).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'send-formatted-confidential-amount.png')
  expect(rpc.getBroadcastCount()).toBe(0)
})

for (const sourceMode of ['main', 'private'] as const) {
  test(`reserves actual contract gas for native Swap Max from ${sourceMode} in real MV3`, async ({
    context,
    popup,
    extensionId
  }) => {
    test.setTimeout(120_000)
    const rpc = await mockEvmNetwork(context, { contractGas: '0x249f0' })
    await mockBitcoinNetwork(context)
    const api = await mockProtocolApis(context)
    await waitForBackgroundWalletInitialization(popup)
    await importTestWallet(popup)
    await popup.goto(`chrome-extension://${extensionId}/index.html`)
    await popup.getByRole('button', { name: 'Swap', exact: true }).click()
    for (const [direction, symbol, network] of [
      ['To', 'USDC', sourceMode === 'private' ? 'Base' : 'Polygon'],
      ['From', 'ETH', 'Ethereum']
    ] as const) {
      await popup.getByRole('button', { name: `${direction} asset` }).click()
      const assets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
      await assets.getByPlaceholder('Search tokens').fill(symbol)
      await assets
        .getByRole('button', { name: new RegExp(`^${symbol} on ${network}`) })
        .first()
        .click()
    }
    if (sourceMode === 'private') {
      await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
      await popup
        .getByRole('dialog', { name: 'Choose source account' })
        .getByRole('radio', { name: /Confidential account/ })
        .click()
    }
    await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('USDC')
    await popup.getByRole('button', { name: /^Use maximum balance:/ }).click()
    await expect(popup.getByRole('textbox', { name: 'From amount' })).toHaveValue('0.999325', {
      timeout: 30_000
    })
    await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled()
    await popup.getByRole('button', { name: 'Swap', exact: true }).click()
    await expect(popup.getByRole('heading', { name: 'Review Swap', exact: true })).toBeVisible({
      timeout: 60_000
    })
    await expect(popup.getByText('0.00054 ETH', { exact: true })).toBeVisible()
    expect(api.getQuoteRequests().at(-1)?.amount).toBe('999325000000000000')
    expect(rpc.getContractGasEstimateCount()).toBeGreaterThanOrEqual(2)
    expect(rpc.getBroadcastCount()).toBe(0)
    await expectNoOverflow(popup)
    await captureScreenshot(popup, `swap-native-max-${sourceMode}-contract-gas.png`)
    await popup.getByRole('button', { name: 'Edit network fee' }).click()
    await popup
      .getByRole('dialog', { name: 'Network Fee' })
      .getByRole('radio', { name: /Fast/ })
      .click()
    await expect(popup.getByRole('heading', { name: 'Review Swap', exact: true })).toBeVisible({
      timeout: 60_000
    })
    await expect(popup.getByText('0.00072 ETH', { exact: true })).toBeVisible({ timeout: 60_000 })
    expect(api.getQuoteRequests().at(-1)?.amount).toBe('999100000000000000')
    expect(rpc.getBroadcastCount()).toBe(0)
    await captureScreenshot(popup, `swap-native-max-${sourceMode}-fast-gas.png`)
  })
}

test('recalculates ETH Swap Max when the source balance changes', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  const rpc = await mockEvmNetwork(context, { contractGas: '0x249f0' })
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  for (const [direction, symbol, network] of [
    ['To', 'USDC', 'Polygon'],
    ['From', 'ETH', 'Ethereum']
  ] as const) {
    await popup.getByRole('button', { name: `${direction} asset` }).click()
    const assets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
    await assets.getByPlaceholder('Search tokens').fill(symbol)
    await assets
      .getByRole('button', { name: new RegExp(`^${symbol} on ${network}`) })
      .first()
      .click()
  }
  const amount = popup.getByRole('textbox', { name: 'From amount' })
  await popup.getByRole('button', { name: /^Use maximum balance:/ }).click()
  await expect(amount).toHaveValue('0.999325', { timeout: 30_000 })

  const mainAddress = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const account = response?.result?.accounts?.find(
      (item: { active?: unknown }) => item.active === true
    )
    const network = account?.networks?.find(
      (item: { chainId?: unknown }) => item.chainId === 'eip155:1'
    )
    const address = network?.addresses?.find(
      (item: { preferredForReceive?: unknown }) => item.preferredForReceive
    )?.value
    if (typeof address !== 'string') throw new Error('Ethereum Main address unavailable')
    return address
  })
  rpc.setAddressBalanceRaw(mainAddress, 800_000_000_000_000_000n)
  await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_PORTFOLIO',
      action: 'refresh',
      chainIds: ['eip155:1']
    })
    if (response?.error) throw new Error('Portfolio refresh failed')
  })

  await expect(amount).toHaveValue('0.799325', { timeout: 30_000 })
  await expect(popup.getByText('Insufficient ETH balance', { exact: true })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled()
  expect(rpc.getBroadcastCount()).toBe(0)
})

test('recovers expired Swap review and shows preparation loading in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  const rpc = await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  const api = await mockProtocolApis(context)
  let markBuildStarted = () => {}
  const buildStarted = new Promise<void>(resolve => {
    markBuildStarted = resolve
  })
  let releaseBuild = () => {}
  const buildGate = new Promise<void>(resolve => {
    releaseBuild = resolve
  })
  await context.route(BUILD_SWAP_URL, async route => {
    markBuildStarted()
    await buildGate
    await route.fallback()
  })
  let maxQuoteRequests = 0
  await context.route(QUOTE_URL, route => {
    const amount = String(route.request().postDataJSON().amountIn)
    if (amount !== '500000000000000000') {
      return route.fallback()
    }
    maxQuoteRequests += 1
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 1, msg: 'Price moved too much, please re-quote', data: null })
    })
  })
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'To asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('USDC')
  await popup
    .getByRole('button', { name: /^USDC on Ethereum/ })
    .first()
    .click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  const sourceSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await sourceSelector.getByPlaceholder('Search tokens').fill('ETH')
  await sourceSelector
    .getByRole('button', { name: /^ETH on Ethereum, balance 1 ETH$/ })
    .first()
    .click()
  expect(maxQuoteRequests).toBe(0)
  const maxButton = popup.getByRole('button', { name: 'Use maximum balance: 1' })
  await expect(maxButton).toBeEnabled({ timeout: 30_000 })
  await maxButton.click()
  await expect.poll(() => maxQuoteRequests).toBe(1)
  await expect(popup.getByRole('textbox', { name: 'From amount', exact: true })).toHaveValue('0.95')
  await expect(popup.getByText('Could not calculate Max amount.')).toHaveCount(0)
  await popup.getByRole('textbox', { name: 'From amount', exact: true }).fill('0.002')
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await popup.getByRole('textbox', { name: 'From amount', exact: true }).fill('0.001')
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-max-estimate-error-recovery.png')
  const swapButton = popup.getByRole('button', { name: 'Swap', exact: true })
  await swapButton.click()
  try {
    await buildStarted
    await expect(swapButton).toBeDisabled()
    await expect(swapButton.locator('svg.animate-spin')).toBeVisible()
  } finally {
    releaseBuild()
  }
  await expect(popup.getByRole('heading', { name: 'Review Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })
  const inputQuoteCount = () =>
    api.getQuoteRequests().filter(request => request.amount === '1000000000000000').length
  const quotesBeforeRefresh = inputQuoteCount()
  await popup.clock.setFixedTime(new Date(Date.now() + 6 * 60_000))
  await popup.getByRole('button', { name: 'Confirm Swap', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Review Swap', exact: true })).toHaveCount(0)
  await expect(popup.getByText('Swap review expired. Getting a new quote.')).toBeVisible()
  await expect(popup.getByRole('textbox', { name: 'From amount', exact: true })).toHaveValue(
    '0.001'
  )
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await expect.poll(inputQuoteCount).toBeGreaterThan(quotesBeforeRefresh)
  expect(rpc.getBroadcastCount()).toBe(0)
})

test('retries a failed quote below the destination asset card in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  let quoteUnavailable = true
  const requests: Record<string, unknown>[] = []
  await context.route(QUOTE_URL, route => {
    requests.push(route.request().postDataJSON())
    if (!quoteUnavailable) return route.fallback()
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 1, msg: 'Request timed out', data: null })
    })
  })
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'To asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('USDC')
  await popup
    .getByRole('button', { name: /^USDC on Polygon/ })
    .first()
    .click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('ETH')
  await popup
    .getByRole('button', { name: /^ETH on Ethereum/ })
    .first()
    .click()
  await popup.getByRole('textbox', { name: 'From amount', exact: true }).fill('0.01')
  const error = popup.getByRole('alert')
  await expect(error.getByText('Request timed out', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
  const destinationCard = popup
    .locator('section')
    .filter({ has: popup.getByRole('button', { name: 'To asset' }) })
  await expect(destinationCard.getByRole('alert')).toHaveCount(0)
  const cardBounds = await destinationCard.boundingBox()
  const errorBounds = await error.boundingBox()
  expect(cardBounds).not.toBeNull()
  expect(errorBounds).not.toBeNull()
  if (cardBounds && errorBounds) {
    expect(errorBounds.y).toBeGreaterThanOrEqual(cardBounds.y + cardBounds.height)
  }
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-quote-error-below-card.png')
  const inputQuotes = () => requests.filter(request => request.amountIn === '10000000000000000')
  expect(inputQuotes()).toHaveLength(1)
  expect(inputQuotes()[0]).toMatchObject({
    tokenIn: ETH_ASSET,
    tokenOut: POLYGON_USDC_CONTRACT
  })
  quoteUnavailable = false
  await error.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(error).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  expect(inputQuotes()).toHaveLength(2)
  expect(inputQuotes()[1]).toMatchObject({
    fromChain: inputQuotes()[0].fromChain,
    toChain: inputQuotes()[0].toChain,
    tokenIn: inputQuotes()[0].tokenIn,
    tokenOut: inputQuotes()[0].tokenOut,
    amountIn: inputQuotes()[0].amountIn,
    sender: inputQuotes()[0].sender,
    recipient: inputQuotes()[0].recipient
  })
  await expect(popup.getByRole('textbox', { name: 'From amount', exact: true })).toHaveValue('0.01')
  await captureScreenshot(popup, 'swap-quote-retry-success.png')
})

test('reviews dApp gas funding from same-chain Main without the Swap input page', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  const network = await mockEvmNetwork(context, { allowBroadcast: true })
  await mockBitcoinNetwork(context)
  const api = await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  const dapp = await connectEvmDApp(context)
  await popup.getByRole('button', { name: 'dApp address: Public' }).click()
  await popup
    .getByRole('dialog', { name: 'dApp address' })
    .getByRole('radio', { name: 'Use Confidential address for dApps' })
    .click()
  const setup = popup.getByRole('dialog', { name: 'Turn on dApp privacy?' })
  if (await setup.isVisible()) await setup.getByRole('button', { name: 'Turn on' }).click()
  await expect.poll(async () => (await readEvmAccounts(dapp.page))[0]).not.toBe(dapp.address)
  const [privateAddress] = await readEvmAccounts(dapp.page)
  network.setAddressBalanceRaw(privateAddress, 1n)
  const approvalPromise = context.waitForEvent('page')
  const transactionPromise = dapp.page.evaluate(async from => {
    const provider = (
      window as typeof window & {
        noirwallet: {
          ethereum: { request: (input: { method: string; params: unknown[] }) => Promise<unknown> }
        }
      }
    ).noirwallet.ethereum
    try {
      await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from,
            to: '0x3333333333333333333333333333333333333333',
            data: '0x12345678'
          }
        ]
      })
      return { code: null }
    } catch (error) {
      return { code: (error as { code?: unknown }).code }
    }
  }, privateAddress)
  const approval = await approvalPromise
  await approval.setViewportSize({ width: 375, height: 632 })
  await expect(approval.getByRole('button', { name: 'Fund gas', exact: true })).toBeVisible()
  await approval.getByRole('button', { name: 'Fund gas', exact: true }).click()
  await expect(approval.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  await expect(approval.getByRole('heading')).toHaveCount(1)
  await expect(approval.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(approval.getByRole('button', { name: 'From asset' })).toHaveCount(0)
  await expect(approval.getByRole('button', { name: 'To asset' })).toHaveCount(0)
  await expect(approval.getByText('Add to Confidential', { exact: true })).toHaveCount(0)
  await expect.poll(() => api.getQuoteRequests().at(-1)?.originAsset).toBe(ETH_ASSET)
  expect(api.getQuoteRequests().at(-1)?.destinationAsset).toBe(ETH_ASSET)
  expect(api.getQuoteRequests().at(-1)?.refundTo.toLowerCase()).toBe(dapp.address.toLowerCase())
  expect(api.getQuoteRequests().at(-1)?.recipient.toLowerCase()).toBe(privateAddress.toLowerCase())
  await captureScreenshot(approval, 'dapp-same-chain-gas-transfer-review.png')
  expect(network.getBroadcastCount()).toBe(0)
  await approval.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(() => network.getBroadcastCount()).toBeGreaterThan(0)
  await expect(approval.getByRole('button', { name: 'Done', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await approval.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(approval.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  await captureScreenshot(approval, 'dapp-gas-funded-resume-approval.png')
  await approval.getByRole('button', { name: 'Reject', exact: true }).click()
  expect((await transactionPromise).code).toBe(4001)
})

test('selects the current wallet alternate address in Send in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Send ETH on Ethereum' })).toBeVisible()
  await expect(popup.getByRole('button', { name: /^Choose source account/ })).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'send-asset-selection.png')
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  const addresses = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const account = response?.result?.accounts?.find(
      (item: { active?: unknown }) => item.active === true
    )
    const network = account?.networks?.find(
      (item: { chainId?: unknown }) => item.chainId === 'eip155:1'
    )
    const main = network?.addresses?.find(
      (item: { preferredForReceive?: unknown }) => item.preferredForReceive
    )?.value
    if (typeof main !== 'string' || typeof network?.privateExecutionAddress !== 'string') {
      throw new Error('Ethereum addresses unavailable')
    }
    return { main, private: network.privateExecutionAddress }
  })
  const source = popup.getByRole('button', { name: 'Choose source account, current main' })
  await expect(source).toHaveCount(1)
  await expect(source).not.toContainText('Public')
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'send-public-from-address.png')
  await popup.getByRole('button', { name: 'Select Recipient', exact: true }).click()
  const recipients = popup.getByRole('dialog', { name: 'Select Recipient' })
  await expect(recipients.getByText('Current', { exact: true })).toBeVisible()
  await expect(recipients.getByRole('button', { name: /Send to .*Public$/ })).toHaveCount(0)
  const privateRecipient = recipients.getByRole('button', { name: /Send to .*Confidential$/ })
  await expect(privateRecipient).toBeVisible()
  await captureScreenshot(popup, 'send-current-wallet-confidential-recipient.png')
  await privateRecipient.click()
  await expect(popup.getByLabel('Send To')).toHaveValue(addresses.private)
  await source.click()
  const sources = popup.getByRole('dialog', { name: 'Choose source account' })
  await captureScreenshot(popup, 'send-source-address-selector.png')
  await sources.getByRole('radio', { name: /Confidential account/ }).click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current private' })
  ).toBeVisible()
  await captureScreenshot(popup, 'send-confidential-from-address.png')
  await popup.getByRole('button', { name: 'Select Recipient', exact: true }).click()
  await expect(recipients.getByRole('button', { name: /Send to .*Confidential$/ })).toHaveCount(0)
  await recipients.getByRole('button', { name: /Send to .*Public$/ }).click()
  await expect(popup.getByLabel('Send To')).toHaveValue(addresses.main)
  await expectNoOverflow(popup)
  await popup.getByRole('button', { name: 'Choose source account, current private' }).click()
  await popup.getByRole('button', { name: 'Transfer to Confidential', exact: true }).click()
  const transfer = popup.getByRole('dialog', { name: 'Transfer ETH' })
  await expect(transfer).toBeVisible()
  await expect(transfer.getByRole('button', { name: 'Switch transfer direction' })).toHaveCount(0)
  await captureScreenshot(popup, 'send-topup-transfer-amount.png')
  await transfer.getByRole('textbox', { name: 'Transfer amount' }).fill('0.01')
  await transfer.getByRole('button', { name: 'Review transfer', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()
  await expect(popup.getByRole('heading')).toHaveCount(1)
  await expect(popup.getByRole('heading', { name: 'Transfer', exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'From asset' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'To asset' })).toHaveCount(0)
  await expect(popup.getByText('Add to Confidential', { exact: true })).toHaveCount(0)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'send-topup-transfer-review.png')
})

test('selects independent source and destination accounts in Swap in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  const api = await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  for (const [direction, symbol] of [
    ['To', 'USDC'],
    ['From', 'ETH']
  ] as const) {
    await popup.getByRole('button', { name: `${direction} asset` }).click()
    const assets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
    await assets.getByPlaceholder('Search tokens').fill(symbol)
    await assets
      .getByRole('button', { name: new RegExp(`^${symbol} on Ethereum`) })
      .first()
      .click()
  }
  const addresses = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const account = response?.result?.accounts?.find(
      (item: { active?: unknown }) => item.active === true
    )
    const network = account?.networks?.find(
      (item: { chainId?: unknown }) => item.chainId === 'eip155:1'
    )
    const mainAddress = network?.addresses?.find(
      (item: { preferredForReceive?: unknown }) => item.preferredForReceive
    )?.value
    if (typeof mainAddress !== 'string' || typeof network?.privateExecutionAddress !== 'string') {
      throw new Error('Ethereum execution addresses unavailable')
    }
    return { main: mainAddress, private: network.privateExecutionAddress }
  })
  await popup.getByRole('textbox', { name: 'From amount' }).fill('0.01')
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.recipient.toLowerCase())
    .toBe(addresses.main.toLowerCase())
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.refundTo.toLowerCase())
    .toBe(addresses.main.toLowerCase())
  await popup.getByRole('button', { name: 'Choose destination account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose destination account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current main' })
  ).toBeVisible()
  await popup.getByRole('textbox', { name: 'From amount' }).fill('0.01')
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.recipient.toLowerCase())
    .toBe(addresses.private.toLowerCase())
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-main-to-confidential.png')

  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()
  await popup.getByRole('textbox', { name: 'From amount' }).fill('0.01')
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.recipient.toLowerCase())
    .toBe(addresses.private.toLowerCase())
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.refundTo.toLowerCase())
    .toBe(addresses.private.toLowerCase())
  await popup.getByRole('button', { name: 'Choose destination account, current private' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose destination account' })
    .getByRole('radio', { name: /Public account/ })
    .click()
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.recipient.toLowerCase())
    .toBe(addresses.main.toLowerCase())
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.refundTo.toLowerCase())
    .toBe(addresses.private.toLowerCase())
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-confidential-to-main.png')

  await popup.getByRole('button', { name: 'Choose destination account, current main' }).click()
  await captureScreenshot(popup, 'swap-destination-account-selector.png')
  await popup
    .getByRole('dialog', { name: 'Choose destination account' })
    .getByRole('button', { name: 'Custom address', exact: true })
    .click()
  const customAddress = '0x1111111111111111111111111111111111111111'
  await popup.getByRole('textbox', { name: 'Destination address' }).fill(customAddress)
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.recipient.toLowerCase())
    .toBe(customAddress)
  await captureScreenshot(popup, 'swap-custom-destination.png')
  await popup.getByRole('button', { name: 'Choose destination account, current custom' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose destination account' })
    .getByRole('radio', { name: /Public account/ })
    .click()
  await expect
    .poll(() => api.getQuoteRequests().at(-1)?.recipient.toLowerCase())
    .toBe(addresses.main.toLowerCase())
  for (const confidential of [true, false]) {
    await popup.goto(`chrome-extension://${extensionId}/index.html`)
    await popup
      .getByRole('button', { name: `dApp address: ${confidential ? 'Public' : 'Confidential'}` })
      .click()
    await popup
      .getByRole('dialog', { name: 'dApp address' })
      .getByRole('radio', {
        name: `Use ${confidential ? 'Confidential' : 'Public'} address for dApps`
      })
      .click()
    const setup = popup.getByRole('dialog', { name: 'Turn on dApp privacy?' })
    if (await setup.isVisible()) await setup.getByRole('button', { name: 'Turn on' }).click()
    await expect(
      popup.getByRole('button', {
        name: `dApp address: ${confidential ? 'Confidential' : 'Public'}`
      })
    ).toBeVisible()
    await popup.getByRole('button', { name: 'Swap', exact: true }).click()
    for (const [direction, symbol] of [
      ['From', 'ETH'],
      ['To', 'USDC']
    ] as const) {
      await popup.getByRole('button', { name: `${direction} asset` }).click()
      const assets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
      await assets.getByPlaceholder('Search tokens').fill(symbol)
      await assets
        .getByRole('button', { name: new RegExp(`^${symbol} on Ethereum`) })
        .first()
        .click()
    }
    const mode = confidential ? 'private' : 'main'
    await expect(
      popup.getByRole('button', { name: `Choose source account, current ${mode}` })
    ).toBeVisible()
    await expect(
      popup.getByRole('button', { name: `Choose destination account, current ${mode}` })
    ).toBeVisible()
    const notification = popup.getByRole('button', { name: 'Dismiss notification' })
    if (await notification.isVisible()) await notification.click()
    await captureScreenshot(popup, `swap-global-${mode}-defaults.png`)
  }
})

test('shows compact account icons in Swap and Confidential labels in address views in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'To asset' }).click()
  const destinationAssets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await destinationAssets.getByPlaceholder('Search tokens').fill('USDC')
  await destinationAssets
    .getByRole('button', { name: /^USDC on Ethereum/ })
    .first()
    .click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  const assets = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await assets.getByPlaceholder('Search tokens').fill('ETH')
  const ethereumEth = assets.getByRole('button', { name: /^ETH on Ethereum/ }).first()
  await expect(ethereumEth).toBeVisible({ timeout: 30_000 })
  await ethereumEth.click()
  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()
  const icon = popup.getByRole('button', { name: 'Choose source account, current private' })
  await expect(icon).toBeVisible()
  await expect(icon).not.toContainText('Confidential')
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-confidential-icon.png')
  await icon.hover()
  await expect(popup.getByRole('tooltip')).toContainText('Confidential')
  await captureScreenshot(popup, 'swap-confidential-icon-hover.png', { preservePointer: true })

  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Show account addresses' }).click()
  const addresses = popup.getByLabel('Account address menu')
  await expect(
    addresses.getByRole('button', { name: 'Copy EVM Confidential address' })
  ).toContainText('Confidential')
  await captureScreenshot(popup, 'account-address-confidential-label.png')
  await addresses.getByRole('button', { name: 'View all' }).click()
  await expect(
    popup.getByRole('button', { name: 'Copy Confidential address' }).first()
  ).toBeVisible()
  await expect(popup.getByText('Confidential', { exact: true }).first()).toBeVisible()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'address-list-confidential-label.png')
})

test('shows Swap asset icons, sent amount, and route clearly in Activity', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(150_000)
  const evmNetwork = await mockEvmNetwork(context, { allowBroadcast: true })
  await mockBitcoinNetwork(context)
  const protocolApis = await mockProtocolApis(context, { orderStatus: 'pending' })
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'View USDC details on Ethereum' })).toBeVisible({
    timeout: 30_000
  })

  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('status', { name: 'Loading additional networks' })).toHaveCount(0, {
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'To asset' }).click()
  const destinationSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await destinationSelector.getByPlaceholder('Search tokens').fill('USDC')
  await destinationSelector
    .getByRole('button', { name: /^USDC on Polygon/ })
    .first()
    .click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  const sourceSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  await sourceSelector.getByPlaceholder('Search tokens').fill('ETH')
  const ethereumSource = sourceSelector.getByRole('button', { name: /^ETH on Ethereum/ }).first()
  await expect(ethereumSource).toBeVisible({ timeout: 30_000 })
  await ethereumSource.click()
  await popup.locator('input[placeholder="0"]').fill('0.01')
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Review Swap' })).toBeVisible({ timeout: 60_000 })
  await popup.getByRole('button', { name: 'Confirm Swap', exact: true }).click()
  await expect.poll(evmNetwork.getBroadcastCount, { timeout: 30_000 }).toBe(1)

  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const row = popup.locator('[data-activity-kind="swap"]').first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toContainText('Swap ETH → USDC')
  await expect(row).toContainText('Ethereum → Polygon')
  await expect(row).toContainText('−0.01 ETH')
  await expect(row).not.toContainText('Quoted')
  await expect(row.locator('[data-activity-avatar="swap"] [data-slot="token-icon"]')).toHaveCount(2)
  const tokenPositions = await row
    .locator('[data-activity-avatar="swap"] [data-slot="token-icon"]')
    .evaluateAll(icons => icons.map(icon => icon.getBoundingClientRect().left))
  const swapRowLeft = await row.evaluate(element => element.getBoundingClientRect().left)
  expect(tokenPositions[0] - swapRowLeft).toBe(20)
  expect(tokenPositions[1] - tokenPositions[0]).toBeLessThan(30)
  await expect(row).toContainText(/Source submitted|Waiting for Intents/)
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-activity-route-row.png')

  await row.click()
  const detail = popup.locator('[data-activity-swap-detail]')
  await expect(detail.locator('[data-slot="token-icon"]')).toHaveCount(2)
  await expect(detail).toContainText('−0.01 ETH')
  await expect(popup.getByText('Route', { exact: true })).toBeVisible()
  await expect(popup.getByText('From network', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('To network', { exact: true })).toHaveCount(0)
  await expect(popup.locator('[data-activity-status-value]')).toHaveText(
    /^(Source submitted|Waiting for Intents)$/
  )
  await expect(popup.getByText('To', { exact: true })).toBeVisible()
  await expect(popup.getByTitle(/^0x[0-9a-fA-F]{40}$/).first()).toBeVisible()
  await expect(popup.getByTitle('0x4444444444444444444444444444444444444444')).toHaveCount(0)
  await expect(popup.getByText('Outgoing Hash', { exact: true })).toHaveCount(0)
  await expect(popup.locator('[data-progress-step] a[title^="0x"]')).toBeVisible()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-activity-route-detail.png')

  const swapActivityId = await row.getAttribute('data-activity-id')
  await popup.evaluate(async () => {
    await chrome.alarms.create('evm-transaction-monitor-alarm', { when: Date.now() + 100 })
  })
  await expect
    .poll(
      async () => {
        const response = (await popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: 'GET_ACTIVITY', action: 'read' })
        )) as {
          result?: {
            items?: Array<{ id: string; segments: Array<{ role: string; status: string }> }>
          }
        }
        return response.result?.items
          ?.find(item => item.id === swapActivityId)
          ?.segments.find(segment => segment.role === 'origin')?.status
      },
      { timeout: 30_000 }
    )
    .toBe('final')
  protocolApis.setOrderStatus('completed')
  await popup.evaluate(async () => {
    await chrome.alarms.create('rhea-swap-transaction-monitor-alarm', { when: Date.now() + 100 })
  })
  await expect(popup.locator('[data-activity-status-value]')).toHaveText('Confirmed', {
    timeout: 30_000
  })
  const destinationHash = popup.locator('[data-progress-step] a[title^="0x"]').last()
  await expect(destinationHash).toHaveAttribute('title', `0x${'f'.repeat(64)}`)
  await destinationHash.scrollIntoViewIfNeeded()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'swap-activity-route-final-detail.png')
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const completedRow = popup.locator('[data-activity-kind="swap"]').first()
  await expect(completedRow).toHaveAttribute('data-activity-status', 'final', { timeout: 30_000 })
  await expect(completedRow).toContainText('−0.01 ETH')
  await expect(completedRow).not.toContainText('Confirmed')
  await captureScreenshot(popup, 'swap-activity-route-final-row.png')
})

test('prepares and rejects wallet-owned EVM Swap reviews in real MV3', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(240_000)
  const evmNetwork = await mockEvmNetwork(context)
  const protocolApis = await mockProtocolApis(context, { quoteResponseDelayMs: 300 })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('button', { name: 'Transfer to Confidential' })
    .click()
  const fundingDialog = popup.getByRole('dialog', { name: 'Transfer ETH' })
  await expect(fundingDialog).toBeVisible()
  await fundingDialog.getByRole('textbox', { name: 'Transfer amount' }).fill('0.01')
  await expect(fundingDialog.getByRole('button', { name: 'Review transfer' })).toBeEnabled()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'private-defi-add-funds-input.png')
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })

  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByText('Swap', { exact: true }).first()).toBeVisible()
  const fromAsset = popup.getByRole('button', { name: 'From asset' })
  await expect(fromAsset).toBeEnabled({ timeout: 30_000 })
  await fromAsset.click()
  const sourceSelector = popup.getByRole('dialog', { name: 'SELECT ASSET' })
  const zecSwapSource = sourceSelector.getByRole('button', {
    name: /^ZEC on Zcash, balance 0 ZEC$/
  })
  const usdcSwapSource = sourceSelector.getByRole('button', {
    name: 'USDC on Ethereum, balance 10 USDC'
  })
  await expect(
    sourceSelector.getByRole('button', { name: 'USDC on Polygon, balance 10 USDC' })
  ).toBeVisible()
  const polSwapSource = sourceSelector.getByRole('button', {
    name: /^POL on Polygon, balance 1 POL$/
  })
  const trialSwapSource = sourceSelector.getByRole('button', {
    name: /^TRIAL on Ethereum$/
  })
  await zecSwapSource.click()
  await expect(fromAsset).toContainText('ZEC')
  await fromAsset.click()
  await expect(zecSwapSource).toContainText('0 ZEC')
  await expect(usdcSwapSource).toContainText('10 USDC')
  await expect(polSwapSource).toContainText('1 POL')
  const bitcoinSource = sourceSelector.getByRole('button', { name: /^BTC on Bitcoin/ })
  if (bitcoinEnabled) {
    await expect(bitcoinSource).toBeVisible()
  } else {
    await expect(bitcoinSource).toHaveCount(0)
  }
  await expect(trialSwapSource).toBeVisible()
  await expect(sourceSelector.getByText('Powered by CoinGecko', { exact: true })).toHaveCount(0)
  const [tokenSearchBox, networkFilterBox] = await Promise.all([
    sourceSelector.getByPlaceholder('Search tokens').boundingBox(),
    sourceSelector
      .getByRole('button', { name: 'Filter assets by network: All Networks' })
      .boundingBox()
  ])
  if (!tokenSearchBox || !networkFilterBox) {
    throw new Error('Swap asset selector controls do not have layout boxes')
  }
  expect(tokenSearchBox.y).toBeLessThan(networkFilterBox.y)
  await expect
    .poll(() =>
      usdcSwapSource
        .getByRole('img', { name: 'USDC', exact: true })
        .evaluate(image => (image as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0)
  for (const [row, symbol] of [
    [zecSwapSource, 'ZEC'],
    [sourceSelector.getByRole('button', { name: /^BNB on BNB Chain/ }), 'BNB'],
    [polSwapSource, 'POL']
  ] as const) {
    const icon = row.getByRole('img', { name: symbol, exact: true })
    await expect
      .poll(() => icon.evaluate(image => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
  }
  await expect(sourceSelector.getByText('Ethereum', { exact: true }).first()).toBeVisible()
  await expect(zecSwapSource).toHaveAttribute('aria-pressed', 'true')
  await expect(usdcSwapSource).toHaveAttribute('aria-pressed', 'false')
  await expect(sourceSelector.locator('[data-token-selection-indicator]')).toHaveCount(0)
  const swapNetworkFilter = sourceSelector.getByRole('button', {
    name: 'Filter assets by network: All Networks'
  })
  await swapNetworkFilter.click()
  const networkFilterContent = popup.getByRole('menu')
  await expect(networkFilterContent).toBeVisible()
  await expect
    .poll(async () => (await networkFilterContent.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(12)
  const bitcoinFilter = popup.getByRole('menuitemradio', { name: 'Bitcoin', exact: true })
  if (bitcoinEnabled) {
    await expect(bitcoinFilter).toBeVisible()
  } else {
    await expect(bitcoinFilter).toHaveCount(0)
  }
  await popup.getByRole('menuitemradio', { name: 'Polygon', exact: true }).click()
  await expect(zecSwapSource).toHaveCount(0)
  await expect(polSwapSource).toBeVisible()
  await sourceSelector.getByRole('button', { name: 'Filter assets by network: Polygon' }).click()
  await popup.getByRole('menuitemradio', { name: 'All Networks', exact: true }).click()
  await expect(zecSwapSource).toBeVisible()
  await captureScreenshot(popup, 'protocol-wallet-swap-source-selector.png')
  await sourceSelector.getByRole('button', { name: 'Close', exact: true }).click()
  await popup.getByRole('button', { name: 'Switch assets', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('ETH')
  const swapSourceButton = popup.getByRole('button', {
    name: 'Choose source account, current main'
  })
  await expect(swapSourceButton).toBeVisible()
  await captureScreenshot(popup, 'private-defi-swap-account-main.png')
  await swapSourceButton.click()
  let swapSourceDialog = popup.getByRole('dialog', { name: 'Choose source account' })
  await expect(swapSourceDialog.getByText('Selected', { exact: true })).toHaveCount(0)
  await captureScreenshot(popup, 'private-defi-swap-account-selector.png')
  await swapSourceDialog.getByRole('radio', { name: /Confidential account/ }).click()
  const privateSwapSourceButton = popup.getByRole('button', {
    name: 'Choose source account, current private'
  })
  await expect(privateSwapSourceButton).toBeVisible()
  await captureScreenshot(popup, 'private-defi-swap-account-private.png')
  const privateSwapSourceAddress = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    const activeAccount = response?.result?.accounts?.find(
      (account: { active?: unknown }) => account.active === true
    )
    const evmNetwork = activeAccount?.networks?.find(
      (network: { chainId?: unknown; privateExecutionAddress?: unknown }) =>
        network.chainId === 'eip155:1' && typeof network.privateExecutionAddress === 'string'
    )
    if (typeof evmNetwork?.privateExecutionAddress !== 'string') {
      throw new Error('Ethereum Private Execution Address is unavailable')
    }
    return evmNetwork.privateExecutionAddress
  })
  await popup.getByRole('button', { name: 'To asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('USDC')
  await popup.getByRole('button', { name: /USDC.*Base/i }).click()
  const privateQuoteCount = protocolApis.getQuoteRequests().length
  await popup.locator('input[placeholder="0"]').fill('0.01')
  await expect.poll(() => protocolApis.getQuoteRequests().length).toBe(privateQuoteCount + 1)
  const privateSwapQuote = protocolApis.getQuoteRequests().at(-1)
  expect(privateSwapQuote).toMatchObject({
    originAsset: ETH_ASSET,
    destinationAsset: BASE_USDC_CONTRACT,
    amount: '10000000000000000',
    confidentiality: 'basic'
  })
  expect(privateSwapQuote?.refundTo.toLowerCase()).toBe(privateSwapSourceAddress.toLowerCase())
  expect(privateSwapQuote?.recipient).toMatch(/^0x[0-9a-fA-F]{40}$/)
  await popup.locator('input[placeholder="0"]').fill('')
  await privateSwapSourceButton.click()
  swapSourceDialog = popup.getByRole('dialog', { name: 'Choose source account' })
  await swapSourceDialog.getByRole('radio', { name: /Public account/ }).click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current main' })
  ).toBeVisible()
  await popup.getByRole('button', { name: 'To asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('USDC')
  await popup.getByRole('button', { name: /USDC.*Polygon/i }).click()
  await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('USDC')
  const swapAmountInput = popup.locator('input[placeholder="0"]')
  const quoteCountBeforeInsufficientAmount = protocolApis.getQuoteRequests().length
  await swapAmountInput.fill('2')
  const fromCard = popup.locator('section').filter({ hasText: /^From/ }).first()
  await expect(fromCard.getByText('Insufficient ETH balance', { exact: true })).toBeVisible()
  await expect
    .poll(() => protocolApis.getQuoteRequests().length)
    .toBe(quoteCountBeforeInsufficientAmount + 1)
  expect(protocolApis.getQuoteRequests().at(-1)).toMatchObject({
    originAsset: ETH_ASSET,
    destinationAsset: POLYGON_USDC_CONTRACT,
    amount: '2000000000000000000',
    dry: false
  })
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeDisabled()
  const quoteCountBeforeUntrackedSource = protocolApis.getQuoteRequests().length
  await popup.getByRole('button', { name: 'From asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('TRIAL')
  await popup.getByRole('button', { name: /^TRIAL on Ethereum$/ }).click()
  await swapAmountInput.fill('2')
  await expect(fromCard.getByText('Insufficient TRIAL balance', { exact: true })).toBeVisible()
  await expect
    .poll(() => protocolApis.getQuoteRequests().length)
    .toBe(quoteCountBeforeUntrackedSource + 1)
  expect(protocolApis.getQuoteRequests().at(-1)).toMatchObject({
    originAsset: TRIAL_CONTRACT,
    destinationAsset: POLYGON_USDC_CONTRACT,
    amount: '2000000000000000000',
    dry: false
  })
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeDisabled()
  await popup.getByRole('button', { name: 'From asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('ETH')
  await popup.getByRole('button', { name: /^ETH on Ethereum/ }).click()
  await swapAmountInput.fill('0.009')
  await swapAmountInput.fill('0.01')
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 30_000
  })
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-wallet-source-evm-input.png')
  await popup.locator('button[aria-expanded]').click()
  await expect(popup.getByText('Refund to this wallet', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  const liveQuote = protocolApis.getQuoteRequests().at(-1)
  expect(liveQuote).toMatchObject({
    originAsset: ETH_ASSET,
    destinationAsset: POLYGON_USDC_CONTRACT,
    amount: '10000000000000000',
    dry: false
  })
  expect(liveQuote?.refundTo).toMatch(/^0x[0-9a-f]{40}$/i)
  expect(liveQuote?.recipient).toMatch(/^0x[0-9a-f]{40}$/i)
  const quoteCountBeforeReview = protocolApis.getQuoteRequests().length
  await popup.evaluate(() => {
    const target = window as typeof window & { restoreQuoteClock?: () => void }
    const realNow = Date.now
    const staleNow = realNow() + 30 * 60_000 + 1
    target.restoreQuoteClock = () => {
      Date.now = realNow
      delete target.restoreQuoteClock
    }
    Date.now = () => staleNow
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect.poll(() => protocolApis.getQuoteRequests().length).toBe(quoteCountBeforeReview + 1)
  // Keep the replacement quote on the background's clock; review still requires confirmation.
  await popup.evaluate(() => {
    ;(window as typeof window & { restoreQuoteClock?: () => void }).restoreQuoteClock?.()
  })
  await expect(popup.getByRole('heading', { name: 'Review Swap' })).toBeVisible({
    timeout: 60_000
  })
  expect(protocolApis.getQuoteRequests()).toHaveLength(quoteCountBeforeReview + 1)
  await expect(popup.getByText('Network Fee', { exact: true })).toBeVisible()
  await expect(
    popup
      .getByText('Source Wallet', { exact: true })
      .locator('..')
      .getByRole('img', { name: 'Ethereum', exact: true })
  ).toBeVisible()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-wallet-source-evm-review.png')
  await popup.getByRole('button', { name: 'Back' }).click()

  await popup.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const activity = popup.getByRole('region', { name: 'Multichain activity' })
  await expect(activity).toBeVisible()
  await expect(activity.locator('[data-activity-kind="swap"]')).toHaveCount(0)
  await captureScreenshot(popup, 'protocol-wallet-swap-activity-list.png')

  await expect
    .poll(() =>
      popup.evaluate(async () => {
        const value = (await chrome.storage.local.get('swap_token_catalog_cache_v1'))
          .swap_token_catalog_cache_v1
        return Array.isArray(value?.tokens) ? value.tokens.length : 0
      })
    )
    .toBeGreaterThan(0)
  protocolApis.setTokenOnline(false)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  await expect(
    popup.getByRole('dialog', { name: 'SELECT ASSET' }).getByRole('button', {
      name: /^ETH on Ethereum, balance 1 ETH$/
    })
  ).toBeVisible({ timeout: 5_000 })
  await captureScreenshot(popup, 'protocol-wallet-swap-cached-catalog.png')

  expect(evmNetwork.getBroadcastCount()).toBe(0)
})

test('waits for ERC-20 approval confirmation before preparing the Swap call', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  const evmNetwork = await mockEvmNetwork(context, { allowBroadcast: true, pendingBroadcast: true })
  await mockBitcoinNetwork(context)
  const protocolApis = await mockProtocolApis(context, { evmApproval: true })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('button', { name: 'View USDC details on Ethereum' })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('USDC')
  await popup
    .getByRole('dialog', { name: 'SELECT ASSET' })
    .getByRole('button', { name: 'USDC on Ethereum, balance 10 USDC' })
    .click()
  await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('USDC')
  await popup.getByRole('button', { name: 'To asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('USDC')
  await popup.getByRole('button', { name: /USDC.*Polygon/i }).click()
  await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('USDC')
  await popup.locator('input[placeholder="0"]').fill('2')
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeEnabled({
    timeout: 60_000
  })
  expect(protocolApis.getQuoteRequests().at(-1)).toMatchObject({
    originAsset: ETHEREUM_USDC_CONTRACT,
    destinationAsset: POLYGON_USDC_CONTRACT
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Review Swap' })).toBeVisible({
    timeout: 60_000
  })
  await expect(popup.getByRole('button', { name: 'Approve USDC' })).toBeVisible()
  expect(evmNetwork.getContractGasEstimateCount()).toBe(0)

  await popup.getByRole('button', { name: 'Approve USDC' }).click()
  await expect(popup.getByRole('heading', { name: 'Token approval', exact: true })).toBeVisible({
    timeout: 60_000
  })
  await expect(popup.getByText('Token approval submitted')).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View Activity' })).toBeVisible()
  await expectNoOverflow(popup)
  expect(evmNetwork.getBroadcastCount()).toBe(1)
  expect(evmNetwork.getContractGasEstimateCount()).toBe(0)
  const approval = parseTransaction(evmNetwork.getBroadcastRawTransactions()[0] as Hex)
  expect(approval.to?.toLowerCase()).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  expect(approval.data).toMatch(/^0x095ea7b3/)
  expect(BigInt(`0x${approval.data?.slice(-64)}`)).toBe(2_000_000n)
  await captureScreenshot(popup, 'swap-approval-pending.png')
  await popup.getByRole('button', { name: 'View Activity' }).click()
  await expect(popup.getByRole('region', { name: 'Multichain activity' })).toBeVisible()
  await captureScreenshot(popup, 'swap-approval-view-activity.png')
})

test('renders RHEA multi-asset lending positions on Home', async ({ context, popup }) => {
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, {
    mcaId: 'rhea00000x.multica.near',
    includeMultichainMarkets: true
  })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.getByRole('tab', { name: 'Lending' }).click()
  await expect(popup.locator('[data-home-lending-position="eth.bridge.near"]')).toContainText(
    '1.5 ETH',
    {
      timeout: 30_000
    }
  )
  await expect(popup.getByText('$3,750.00', { exact: true }).first()).toBeVisible()
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-wallet-home-lending-multichain-positions.png')
})

test('uses the active Polygon wallet source and POL fees in Swap', async ({ context, popup }) => {
  test.setTimeout(300_000)
  const evmNetwork = await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, {
    mcaId: 'rhea00000x.multica.near',
    includeMultichainMarkets: true
  })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const activeAccount = await popup.evaluate(async () => {
    const stored = (await chrome.storage.local.get('wallet_state')).wallet_state
    const state = typeof stored === 'string' ? JSON.parse(stored).state : stored?.state
    return { walletId: state?.currentWalletId, accountId: state?.currentAccountId }
  })
  expect(activeAccount).toEqual({ walletId: expect.any(String), accountId: expect.any(String) })
  if (!activeAccount.walletId || !activeAccount.accountId) {
    throw new Error('Active Account fixture is missing')
  }
  const addedAccount = await popup.evaluate(walletId => {
    return chrome.runtime.sendMessage({ type: 'ADD_ACCOUNT', walletId })
  }, activeAccount.walletId)
  expect(addedAccount).toMatchObject({ success: true, accountId: expect.any(String) })
  const addedAccountId = (addedAccount as { accountId: string }).accountId

  const switchResult = await popup.evaluate(async () => {
    const current = await chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' })
    if (!current?.result) throw new Error('Chain endpoint settings are unavailable')
    return chrome.runtime.sendMessage({
      type: 'APPLY_CHAIN_ENDPOINT_SETTINGS',
      settings: { ...current.result, activeEvmChainId: 'eip155:137' }
    })
  })
  expect(switchResult).toMatchObject({ result: { activeEvmChainId: 'eip155:137' } })

  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('POL')
  const polSwapSource = popup
    .getByRole('button')
    .filter({ hasText: /POL.*Polygon/i })
    .first()
  await expect(polSwapSource).toBeVisible()
  await polSwapSource.click()
  await expect
    .poll(() => readPersistedSwapSource(popup), {
      message: 'selected Swap source should persist for the active Wallet Account'
    })
    .toBe(POL_ASSET)

  await popup.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('POL', {
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'To asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('ZEC')
  await popup.getByRole('button', { name: /ZEC.*Zcash/i }).click()
  const swapAmountInput = popup.locator('input[placeholder="0"]')
  await popup.getByRole('button', { name: /^Use maximum balance:/ }).click()
  await expect(swapAmountInput).toHaveValue('0.9999055', { timeout: 30_000 })
  await expectNoOverflow(popup)
  const submitSwap = popup.getByRole('button', { name: 'Swap', exact: true })
  await expect(submitSwap).toBeEnabled({ timeout: 60_000 })
  await submitSwap.click()
  await expect(popup.getByRole('heading', { name: 'Review Swap' })).toBeVisible({
    timeout: 60_000
  })
  await expect(popup.getByRole('button', { name: 'Show full amount' }).first()).toHaveText(
    '0.9999055'
  )
  await expect(popup.getByRole('button', { name: 'Show full POL amount' })).toHaveText(
    '0.0000756 POL'
  )
  for (const alt of ['POL', 'Polygon', 'ZEC', 'Zcash']) {
    await expect
      .poll(() =>
        popup
          .getByAltText(alt, { exact: true })
          .first()
          .evaluate(image => (image as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0)
  }
  await expectNoOverflow(popup)
  await captureScreenshot(popup, 'protocol-wallet-source-polygon-review.png')
  await popup.getByRole('button', { name: 'Back' }).click()

  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Review Swap' })).toBeVisible({
    timeout: 60_000
  })
  const pendingSwapId = await popup.evaluate(async () => {
    const session = await chrome.storage.session.get(null)
    const keys = Object.keys(session).filter(key => key.startsWith('evm_pending_transfer:'))
    if (keys.length !== 1) return undefined
    const candidate = session[keys[0]] as { transactionId?: unknown; phase?: unknown }
    return candidate.phase === 'awaiting-approval' && typeof candidate.transactionId === 'string'
      ? candidate.transactionId
      : undefined
  })
  expect(pendingSwapId).toEqual(expect.any(String))

  await expect(
    popup.evaluate(
      ({ walletId, accountId }) =>
        chrome.runtime.sendMessage({ type: 'SWITCH_ACCOUNT', walletId, accountId }),
      { walletId: activeAccount.walletId, accountId: addedAccountId }
    )
  ).resolves.toMatchObject({ success: true })
  await expect(popup.getByRole('heading', { name: 'Review Swap' })).toBeHidden({ timeout: 30_000 })
  await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('ZEC', {
    timeout: 5_000
  })
  await expect(popup.locator('input[placeholder="0"]')).toHaveValue('')
  await expect(
    popup.evaluate(transactionId => {
      return chrome.runtime.sendMessage({ type: 'GET_PENDING_EVM_TRANSFER', transactionId })
    }, pendingSwapId)
  ).resolves.toEqual({ result: null })
  await captureScreenshot(popup, 'protocol-wallet-source-account-switch-reset.png')

  await expect(
    popup.evaluate(
      ({ walletId, accountId }) =>
        chrome.runtime.sendMessage({ type: 'SWITCH_ACCOUNT', walletId, accountId }),
      { walletId: activeAccount.walletId, accountId: activeAccount.accountId }
    )
  ).resolves.toMatchObject({ success: true })
  await expect
    .poll(async () => {
      const response = (await popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_ACTIVITY' })
      )) as { result?: { items?: Array<{ id?: string }> } }
      return response.result?.items?.find(item => item.id === pendingSwapId)
    })
    .toBeUndefined()
  expect(evmNetwork.getBroadcastCount()).toBe(0)
})

test('restores the account-scoped Swap source after a popup reload', async ({ context, popup }) => {
  test.setTimeout(180_000)
  await mockEvmNetwork(context)
  await mockBitcoinNetwork(context)
  await mockProtocolApis(context, { tokenResponseDelayMs: 1_500 })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await expect(popup.getByRole('status', { name: 'Loading total assets' })).toBeVisible()
  await captureScreenshot(popup, 'protocol-wallet-home-total-assets-skeleton.png')
  await expect(popup.getByRole('button', { name: 'View POL details on Polygon' })).toBeVisible({
    timeout: 60_000
  })

  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await popup.getByRole('button', { name: 'From asset' }).click()
  await popup.getByPlaceholder('Search tokens').fill('POL')
  const polygonSource = popup
    .getByRole('button')
    .filter({ hasText: /POL.*Polygon/i })
    .first()
  await expect(polygonSource).toBeVisible({ timeout: 60_000 })
  await polygonSource.click()

  await expect.poll(() => readPersistedSwapSource(popup)).toBe(POL_ASSET)
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible()
  await expect(popup.getByRole('status', { name: 'Loading total assets' })).toHaveCount(0)
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()

  await popup.reload()
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'From asset' })).toContainText('POL', {
    timeout: 30_000
  })
  await expectNoOverflow(popup)
})
