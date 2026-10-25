import { chromium, type BrowserContext, type Page, type Route } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { keccak256, type Hex } from 'viem'
import {
  captureScreenshot,
  e2eEnabledChainFeatureFlags,
  extensionDir,
  expect,
  mockUnknownZcashAccountHistory,
  selectImportedZcashHistory,
  selectNewZcashAccountHistory,
  test as extensionTest,
  terminateExtensionServiceWorker,
  waitForBackgroundWalletInitialization
} from './extension-fixtures'
import {
  BUILTIN_EVM_NETWORKS as EVM_NETWORK_CONFIGS,
  NEAR_NETWORKS,
  SOLANA_NETWORKS
} from '../../src/config/networks'
import { ASSET_PRICE_SOURCE_ASSETS } from '../../src/config/asset-market-assets'
import { DEFAULT_HISTORY_API_ORIGIN } from '../../scripts/lib/extension-build-config'
import { RPC_REGISTRY } from '../../../rpc-registry/src/registry'
import { findChainEndpointOverride } from '../../src/core/chains/chain-endpoint-settings'
import {
  createAssetRegistry,
  createInitialProductChainRegistry,
  getBundledInitialProductAssetDefinitions
} from '../../src/core/chains/registry'
import type { ZcashBalance } from '../../src/types'

const TEST_MNEMONIC_12 = `${'abandon '.repeat(11)}about`
const TEST_PASSWORD = 'release-default-password'
const TEST_BETA_INVITE_CODE = 'RELEASE-DEFAULT-INVITE'
const bitcoinEnabled = e2eEnabledChainFeatureFlags.includes('chain.bitcoin')
const solanaEnabled = e2eEnabledChainFeatureFlags.includes('chain.solana')
const nearEnabled = e2eEnabledChainFeatureFlags.includes('chain.near')
const ZCASH_MAINNET_CHAIN_ID = 'bip122:00040fe8ec8471911baa1db1266ea15d'
const ZCASH_TESTNET_CHAIN_ID = 'bip122:05a60a92d99d85997cce3b87616c089f'
const BITCOIN_MAINNET_CHAIN_ID = 'bip122:000000000019d6689c085ae165831e93'
const BITCOIN_TESTNET_CHAIN_ID = 'bip122:000000000933ea01ad0ee984209779ba'
const BUILTIN_EVM_NETWORKS = [
  'Ethereum',
  'BNB Chain',
  'Arbitrum',
  'Base',
  'Optimism',
  'Polygon',
  'Avalanche'
] as const
const CUSTOM_TOKEN_CONTRACT = '0x3333333333333333333333333333333333333333'
const GNOSIS_USDC_CONTRACT = '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0'
const EVM_HISTORY_PROXY_ORIGINS = new Set(['https://evm-history.test', DEFAULT_HISTORY_API_ORIGIN])
const SDK_EXAMPLE_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../sdk/example/dist'
)
const TEST_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#00d18a"/></svg>'
const PROVIDER_ICON_DATA_URL = `data:image/png;base64,${(
  await readFile(new URL('../../public/icons/icon128.png', import.meta.url))
).toString('base64')}`

const test = extensionTest.extend<{ readonly offlineRpcRegistry: void }>({
  offlineRpcRegistry: [
    async ({ context }, use) => {
      await context.route('https://rpc.zknoir.com/v1/rpc-endpoints?scope=multichain', route =>
        route.abort()
      )
      await mockBetaInviteApi(context)
      await use()
    },
    { auto: true }
  ]
})

async function mockBetaInviteApi(context: BrowserContext): Promise<void> {
  const path = `/v1/invite-codes/${encodeURIComponent(TEST_BETA_INVITE_CODE)}`
  await context.route('https://api.zknoir.com/v1/invite-codes/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === `${path}/check` && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { exists: true, bound: false } })
      })
      return
    }
    if (url.pathname === `${path}/bind` && request.method() === 'POST') {
      const body = request.postDataJSON() as { wallet_address?: unknown }
      expect(body.wallet_address).toMatch(/^0x[0-9a-fA-F]{40}$/)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { code: TEST_BETA_INVITE_CODE, bound: true }
        })
      })
      return
    }
    await route.fulfill({ status: 404, body: 'Unknown invite request' })
  })
}

async function verifyBetaInviteCode(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Enter invite code' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Invite code' }).fill(TEST_BETA_INVITE_CODE)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Enter invite code' })).toHaveCount(0)
}

async function mockExternalAssetIcons(context: BrowserContext): Promise<void> {
  const fulfillIcon = (route: Route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: TEST_ICON_SVG })
  await context.route('https://assets.zknoir.com/chain/**', fulfillIcon)
  await context.route('https://assets-cdn.trustwallet.com/**', fulfillIcon)
}

async function serveSdkExample(route: import('@playwright/test').Route): Promise<void> {
  const url = new URL(route.request().url())
  const prefix = '/example/'
  const requested = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
  const relativePath = requested || 'index.html'
  if (!/^[a-zA-Z0-9._/-]+$/.test(relativePath) || relativePath.includes('..')) {
    await route.fulfill({ status: 404, body: 'Not found' })
    return
  }
  const filePath = path.resolve(SDK_EXAMPLE_DIST, relativePath)
  if (!filePath.startsWith(`${SDK_EXAMPLE_DIST}${path.sep}`)) {
    await route.fulfill({ status: 404, body: 'Not found' })
    return
  }
  const contentType = filePath.endsWith('.html')
    ? 'text/html'
    : filePath.endsWith('.js')
      ? 'text/javascript'
      : filePath.endsWith('.css')
        ? 'text/css'
        : filePath.endsWith('.svg')
          ? 'image/svg+xml'
          : filePath.endsWith('.png')
            ? 'image/png'
            : filePath.endsWith('.ico')
              ? 'image/x-icon'
              : 'application/octet-stream'
  let body: Buffer | string = await readFile(filePath)
  if (filePath.endsWith('index.html')) {
    const favicon = await readFile(path.join(SDK_EXAMPLE_DIST, 'favicon.ico'))
    body = body
      .toString('utf8')
      .replace(
        'href="/example/favicon.ico"',
        `href="data:image/x-icon;base64,${favicon.toString('base64')}"`
      )
  }
  await route.fulfill({ contentType, body })
}

async function expectDAppTabFavicon(page: Page, extensionPage: Page): Promise<void> {
  await expect
    .poll(() =>
      extensionPage.evaluate(async pageUrl => {
        const tabs = await chrome.tabs.query({})
        return tabs.find(tab => tab.url === pageUrl)?.favIconUrl
      }, page.url())
    )
    .toMatch(/^data:image\/x-icon;base64,/)
}

async function readEvmProviderChainIds(page: Page) {
  return page.evaluate(async () => {
    const provider = (
      window as typeof window & {
        noirwallet: {
          ethereum: {
            chainId: string | null
            request: (input: { method: string }) => Promise<unknown>
          }
        }
      }
    ).noirwallet.ethereum
    return {
      property: provider.chainId,
      request: await provider.request({ method: 'eth_chainId' })
    }
  })
}

async function expectDAppRequestHeader(
  page: Page,
  options: {
    readonly action: string
    readonly domain: string
    readonly pageUrl: string
    readonly hiddenChain?: string
  }
): Promise<void> {
  await expect(
    page.getByTestId('approval-scroll-region').getByText(options.action, { exact: true })
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: options.domain, exact: true })).toBeVisible()
  const requestId = new URL(page.url()).hash.match(/requestId=([^&]+)/)?.[1]
  expect(requestId).toBeTruthy()
  const pendingFavicon = await page.evaluate(async id => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_PENDING_REQUEST',
      requestId: id
    })
    return {
      favicon: response?.request?.data?.favicon,
      pageUrl: response?.request?.data?.faviconPageUrl
    }
  }, requestId)
  expect(pendingFavicon.favicon).toMatch(/^data:image\/x-icon;base64,/)
  expect(pendingFavicon.pageUrl).toBe(options.pageUrl)
  const favicon = page.getByTestId('dapp-favicon')
  const faviconSource = await favicon.getAttribute('src')
  expect(faviconSource).toBeTruthy()
  const parsedFaviconSource = new URL(faviconSource as string)
  expect(parsedFaviconSource.protocol).toBe('chrome-extension:')
  expect(parsedFaviconSource.pathname).toBe('/_favicon/')
  expect(parsedFaviconSource.searchParams.get('pageUrl')).toBe(options.pageUrl)
  expect(parsedFaviconSource.searchParams.get('size')).toBe('64')
  await expect
    .poll(() => favicon.evaluate(image => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  if (options.hiddenChain) {
    await expect(page.getByText(options.hiddenChain, { exact: true })).toHaveCount(0)
  }
}

async function expectDAppConnectionHeader(
  page: Page,
  options: { readonly domain: string; readonly pageUrl: string; readonly hiddenChain?: string }
): Promise<void> {
  await expectDAppRequestHeader(page, { ...options, action: 'Connect to' })
}

function abiWord(value: number | bigint): string {
  return value.toString(16).padStart(64, '0')
}

function abiString(value: string): string {
  const encoded = Buffer.from(value, 'utf8').toString('hex')
  return `0x${abiWord(32)}${abiWord(encoded.length / 2)}${encoded.padEnd(Math.ceil(encoded.length / 64) * 64, '0')}`
}

async function mockReleasedEvmRpc(
  context: BrowserContext,
  networkMode: 'mainnet' | 'testnet' = 'mainnet',
  options: {
    readonly nativeBalanceRaw?: bigint
    readonly bundledUsdcBalanceRaw?: bigint
  } = {}
): Promise<string[]> {
  const requests: string[] = []
  for (const network of EVM_NETWORK_CONFIGS[networkMode]) {
    const rpcUrl = new URL(network.rpcUrl).href
    let transactionHash: string | null = null
    await context.route(
      url => url.href === rpcUrl,
      async route => {
        const request = route.request().postDataJSON() as {
          id?: unknown
          method?: unknown
          params?: readonly unknown[]
        }
        requests.push(`${network.chainId}:${String(request.method)}`)
        let result: unknown = '0x0'
        if (request.method === 'eth_chainId') {
          result = `0x${network.numericChainId.toString(16)}`
        } else if (request.method === 'eth_getBalance') {
          const nativeBalanceRaw =
            options.nativeBalanceRaw ??
            (network.numericChainId === 137 ? 1_234n * 10n ** 18n : 10n ** 18n)
          result = `0x${nativeBalanceRaw.toString(16)}`
        } else if (request.method === 'eth_getCode') {
          const address = request.params?.[0]
          const bundledUsdc =
            typeof address === 'string' &&
            ((typeof network.usdcContract === 'string' &&
              address.toLowerCase() === network.usdcContract.toLowerCase()) ||
              (network.chainId === 'eip155:100' && address.toLowerCase() === GNOSIS_USDC_CONTRACT))
          result =
            (typeof address === 'string' && address.toLowerCase() === CUSTOM_TOKEN_CONTRACT) ||
            bundledUsdc
              ? '0x60006000'
              : '0x'
        } else if (request.method === 'eth_call') {
          const call = request.params?.[0] as { to?: unknown; data?: unknown } | undefined
          const custom =
            typeof call?.to === 'string' && call.to.toLowerCase() === CUSTOM_TOKEN_CONTRACT
          const bundledUsdc =
            typeof call?.to === 'string' &&
            ((typeof network.usdcContract === 'string' &&
              call.to.toLowerCase() === network.usdcContract.toLowerCase()) ||
              (network.chainId === 'eip155:100' && call.to.toLowerCase() === GNOSIS_USDC_CONTRACT))
          const selector =
            typeof call?.data === 'string' ? call.data.slice(0, 10).toLowerCase() : ''
          result =
            custom && selector === '0x06fdde03'
              ? abiString('Example Token')
              : custom && selector === '0x95d89b41'
                ? abiString('USDC')
                : custom && selector === '0x313ce567'
                  ? `0x${abiWord(18)}`
                  : custom && selector === '0x70a08231'
                    ? `0x${abiWord(10n ** 18n)}`
                    : bundledUsdc && selector === '0x06fdde03'
                      ? abiString('USD Coin')
                      : bundledUsdc && selector === '0x95d89b41'
                        ? abiString('USDC')
                        : bundledUsdc && selector === '0x313ce567'
                          ? `0x${abiWord(6)}`
                          : bundledUsdc && selector === '0x70a08231'
                            ? `0x${abiWord(options.bundledUsdcBalanceRaw ?? 1n)}`
                            : custom && selector === '0xa9059cbb'
                              ? `0x${abiWord(1)}`
                              : `0x${abiWord(0)}`
        } else if (request.method === 'eth_getTransactionCount') {
          result = '0x0'
        } else if (request.method === 'eth_estimateGas') {
          result = '0x11170'
        } else if (request.method === 'eth_maxPriorityFeePerGas') {
          result = '0x3b9aca00'
        } else if (request.method === 'eth_getBlockByNumber') {
          result = { number: '0x101', baseFeePerGas: '0x3b9aca00' }
        } else if (request.method === 'eth_sendRawTransaction') {
          const rawTransaction = request.params?.[0]
          if (typeof rawTransaction !== 'string' || !/^0x[0-9a-f]+$/.test(rawTransaction)) {
            throw new Error('Expected a canonical signed EVM transaction')
          }
          transactionHash = keccak256(rawTransaction as Hex)
          result = transactionHash
        } else if (request.method === 'eth_getTransactionByHash') {
          const requestedHash = request.params?.[0]
          result =
            typeof requestedHash === 'string' && requestedHash === transactionHash
              ? {
                  hash: requestedHash,
                  blockHash: `0x${'b'.repeat(64)}`,
                  blockNumber: '0x100'
                }
              : null
        } else if (request.method === 'eth_getTransactionReceipt') {
          const requestedHash = request.params?.[0]
          result =
            typeof requestedHash === 'string' && requestedHash === transactionHash
              ? {
                  transactionHash: requestedHash,
                  blockHash: `0x${'b'.repeat(64)}`,
                  blockNumber: '0x100',
                  status: '0x1'
                }
              : null
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
        })
      }
    )
  }
  await mockReleasedSolanaNearRpc(context, networkMode)
  return requests
}

async function mockReleasedSolanaNearRpc(
  context: BrowserContext,
  networkMode: 'mainnet' | 'testnet'
): Promise<void> {
  const solana = networkMode === 'mainnet' ? SOLANA_NETWORKS.mainnet : SOLANA_NETWORKS.devnet
  await context.route(
    url => url.href === new URL(solana.rpcUrl).href,
    async route => {
      const request = route.request().postDataJSON() as { id?: unknown; method?: unknown }
      const result =
        request.method === 'getGenesisHash'
          ? solana.genesisHash
          : request.method === 'getBlockHeight'
            ? 1_000
            : request.method === 'getLatestBlockhash'
              ? {
                  context: { slot: 123 },
                  value: { blockhash: solana.genesisHash, lastValidBlockHeight: 1_100 }
                }
              : request.method === 'getBalance'
                ? { context: { slot: 123 }, value: 0 }
                : request.method === 'getMultipleAccounts'
                  ? {
                      context: { slot: 123 },
                      value: Array.isArray(
                        (request as { params?: readonly [readonly unknown[]] }).params?.[0]
                      )
                        ? (request as { params: readonly [readonly unknown[]] }).params[0].map(
                            () => null
                          )
                        : []
                    }
                  : request.method === 'getTokenAccountsByOwner'
                    ? { context: { slot: 123 }, value: [] }
                    : request.method === 'getSignaturesForAddress'
                      ? []
                      : null
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
      })
    }
  )

  if (networkMode === 'mainnet') {
    await context.route('https://transfers.main.fastnear.com/v0/transfers', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ resume_token: null, transfers: [] })
      })
    )
    await context.route('https://api.fastnear.com/v0/public_key/**', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ account_ids: [] })
      })
    )
    await context.route('https://api.fastnear.com/v1/account/**/ft', async route => {
      const accountId = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').at(-2)!
      )
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ account_id: accountId, tokens: [] })
      })
    })
  }

  const near = NEAR_NETWORKS[networkMode]
  await context.route(
    url => url.href === new URL(near.rpcUrl).href,
    async route => {
      const request = route.request().postDataJSON() as {
        id?: unknown
        method?: unknown
        params?: Record<string, unknown>
      }
      let result: unknown = null
      if (request.method === 'status') {
        result = { chain_id: near.network, sync_info: { latest_block_hash: near.genesisHash } }
      } else if (request.method === 'genesis_config') {
        result = {
          chain_id: near.network,
          genesis_height: near.genesisHeight,
          genesis_time: near.genesisTime
        }
      } else if (request.method === 'block') {
        result = {
          header: {
            height: near.genesisHeight,
            hash: near.genesisHash
          }
        }
      } else if (request.method === 'query' && request.params?.request_type === 'view_account') {
        result = {
          amount: '0',
          locked: '0',
          storage_usage: 0,
          code_hash: '11111111111111111111111111111111',
          block_hash: near.genesisHash,
          block_height: near.genesisHeight
        }
      } else if (request.method === 'query' && request.params?.request_type === 'view_access_key') {
        result = {
          nonce: 1,
          permission: 'FullAccess',
          block_hash: near.genesisHash,
          block_height: near.genesisHeight
        }
      } else if (
        request.method === 'query' &&
        request.params?.request_type === 'call_function' &&
        request.params.method_name === 'ft_balance_of'
      ) {
        result = {
          block_hash: near.genesisHash,
          block_height: near.genesisHeight,
          logs: [],
          result: [...new TextEncoder().encode('"0"')]
        }
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result })
      })
    }
  )
}

interface HistoryProxyRequest {
  readonly method: string
  readonly address: string
  readonly blockchains: readonly string[]
}

const historyWorkerRuntimes = new Set<{ dispose(): Promise<void> }>()
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'wait' })
  const runtimes = [...historyWorkerRuntimes]
  historyWorkerRuntimes.clear()
  await Promise.all(runtimes.map(runtime => runtime.dispose()))
})

async function mockEvmHistoryProxy(
  context: BrowserContext,
  responseDelayMs = 0,
  crowdedSharedPage = false,
  collidingChainHashes = false
): Promise<HistoryProxyRequest[]> {
  const requests: HistoryProxyRequest[] = []
  // Exercise the production Worker in workerd; only the authenticated Ankr upstream is simulated.
  const workerRequire = createRequire(
    new URL('../../../evm-history-worker/package.json', import.meta.url)
  )
  const wranglerRequire = createRequire(workerRequire.resolve('wrangler'))
  const {
    Miniflare,
    convertV4MiniflareOptions,
    Response: RuntimeResponse
  } = wranglerRequire('miniflare')
  const { build } = wranglerRequire('esbuild')
  const { outputFiles } = await build({
    entryPoints: [
      fileURLToPath(new URL('../../../evm-history-worker/src/index.ts', import.meta.url))
    ],
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2022'
  })
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: outputFiles[0].text,
      compatibilityDate: '2026-08-01',
      bindings: { ANKR_API_KEYS: 'mv3-test-key', ALLOWED_ORIGIN: '*' },
      ratelimits: {
        HISTORY_RATE_LIMITER: { namespace_id: '1', simple: { limit: 120, period: 60 } }
      },
      outboundService: async (request: Request) => {
        if (responseDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, responseDelayMs))
        }
        expect(new URL(request.url).hostname).toBe('rpc.ankr.com')
        expect(request.method).toBe('POST')
        const body = (await request.json()) as {
          id: number | string
          jsonrpc: string
          method: string
          params: { address: string | string[]; blockchain: string[] }
        }
        expect(body.jsonrpc).toBe('2.0')
        const address = Array.isArray(body.params.address)
          ? body.params.address[0]
          : body.params.address
        requests.push({ method: body.method, address, blockchains: body.params.blockchain })
        if (
          body.method === 'ankr_getTransactionsByAddress' &&
          (body.params.blockchain.includes('eth') ||
            (crowdedSharedPage &&
              body.params.blockchain.length === 1 &&
              body.params.blockchain[0] === 'base'))
        ) {
          const transaction = (suffix: string, value: string, timestamp: string) => ({
            blockchain: body.params.blockchain.includes('eth') ? 'eth' : 'base',
            blockNumber: '0xfa',
            timestamp: `0x${BigInt(timestamp).toString(16)}`,
            hash: `0x${suffix.repeat(64)}`,
            nonce: suffix === 'a' ? '0x1' : '0x2',
            blockHash: `0x${'c'.repeat(64)}`,
            from: '0x2222222222222222222222222222222222222222',
            to: address,
            value: `0x${BigInt(value).toString(16)}`,
            gasPrice: '0x3b9aca00',
            gasUsed: '0x5208',
            gas: '0x5208',
            cumulativeGasUsed: '0x5208',
            transactionIndex: '0x0',
            input: '0x',
            status: '0x1'
          })
          return new RuntimeResponse(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                transactions: body.params.blockchain.includes('eth')
                  ? [
                      transaction('a', '5871510000000000', '1760000000'),
                      transaction('b', '1', '1750000000')
                    ]
                  : [
                      transaction(
                        collidingChainHashes ? 'a' : 'f',
                        '1000000000000000',
                        '1755000000'
                      )
                    ],
                ...(crowdedSharedPage && body.params.blockchain.length > 1
                  ? { nextPageToken: 'more-ethereum-history' }
                  : {})
              }
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
        }
        return new RuntimeResponse(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result:
              body.method === 'ankr_getTokenTransfers' ? { transfers: [] } : { transactions: [] }
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      }
    })
  )
  historyWorkerRuntimes.add(runtime)
  await context.route(
    url => EVM_HISTORY_PROXY_ORIGINS.has(url.origin) && url.pathname === '/',
    async route => {
      const response = await runtime.dispatchFetch('http://history-worker.local/', {
        method: route.request().method(),
        headers: { 'Content-Type': 'application/json' },
        body: route.request().postData()
      })
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text()
      })
    }
  )
  return requests
}

async function mockReleasedBitcoinEsplora(context: BrowserContext): Promise<string[]> {
  const requests: string[] = []
  let delayedFirstHistoryRequest = false
  const emptyStats = {
    tx_count: 0,
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0
  }
  for (const origin of ['https://mempool.space/api/', 'https://blockstream.info/api/']) {
    await context.route(`${origin}**`, async route => {
      const url = new URL(route.request().url())
      const basePath = new URL(origin).pathname
      const path = url.pathname.slice(basePath.length)
      requests.push(`${url.origin}${basePath}${path}`)
      if (path === 'block-height/0') {
        await route.fulfill({
          contentType: 'text/plain',
          body: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
        })
        return
      }
      if (path === 'blocks/tip/height') {
        await route.fulfill({ contentType: 'text/plain', body: '900000' })
        return
      }
      const addressMatch = /^address\/([^/]+)$/.exec(path)
      if (addressMatch) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            address: decodeURIComponent(addressMatch[1]),
            chain_stats: emptyStats,
            mempool_stats: emptyStats
          })
        })
        return
      }
      if (/^address\/[^/]+\/txs$/.test(path) && !delayedFirstHistoryRequest) {
        delayedFirstHistoryRequest = true
        await new Promise(resolve => setTimeout(resolve, 350))
      }
      if (/^address\/[^/]+\/utxo$/.test(path) || /^address\/[^/]+\/txs$/.test(path)) {
        await route.fulfill({ contentType: 'application/json', body: '[]' })
        return
      }
      await route.abort()
    })
  }
  return requests
}

async function mockAssetMarketHistory(context: BrowserContext): Promise<string[]> {
  const requests: string[] = []
  await context.route('https://api.geckoterminal.com/**', async route => {
    const url = new URL(route.request().url())
    requests.push(url.href)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 24), 90)
    const now = Date.parse('2026-08-18T08:00:00.000Z') / 1_000
    const ohlcvList = Array.from({ length: limit }, (_, index) => {
      const price = 3_100 + index * 4 + Math.sin(index / 2) * 18
      return [now - index * 60 * 60, price - 2, price + 3, price - 4, price, 1_000 + index]
    })
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { attributes: { ohlcv_list: ohlcvList } } })
    })
  })
  await context.route('https://pro-api.coinmarketcap.com/**', async route => {
    const url = new URL(route.request().url())
    requests.push(url.href)
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 24), 60)
    const now = Date.parse('2026-08-18T08:00:00.000Z')
    const data = Array.from({ length: limit }, (_, index) => [
      3_100 + index * 4 + Math.sin(index / 2) * 18,
      1_000 + index,
      now - (limit - index) * 60 * 60 * 1_000
    ])
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: { error_code: '0' }, data })
    })
  })
  return requests
}

async function importTestWallet(page: Page): Promise<void> {
  await verifyBetaInviteCode(page)
  await page.getByRole('button', { name: 'Import wallet' }).click()
  await page.getByRole('radio', { name: '12 words' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.locator('input[type="text"]').first().fill(TEST_MNEMONIC_12)
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
}

async function seedFreshAssetPrices(page: Page): Promise<void> {
  const fetchedAt = Date.now()
  const pricesBySymbol: Readonly<Record<string, string>> = Object.freeze({
    ZEC: '42.75',
    ETH: '3200',
    USDC: '1',
    BNB: '585',
    POL: '0.24',
    AVAX: '21.5',
    MON: '0.05',
    xDAI: '1',
    XPL: '0.3',
    OKB: '200',
    BERA: '2.1',
    BTC: '63014',
    SOL: '145',
    NEAR: '5.25'
  })
  const releaseAssets = createAssetRegistry(
    createInitialProductChainRegistry('mainnet'),
    getBundledInitialProductAssetDefinitions('mainnet')
  )
  const assetQuotes = releaseAssets.list().map(entry => ({
    assetId: entry.asset.id,
    priceUsd: pricesBySymbol[entry.metadata.symbol],
    sourceUpdatedAt: fetchedAt
  }))
  if (assetQuotes.some(quote => quote.priceUsd === undefined)) {
    throw new Error('Release screenshot price fixture is incomplete')
  }
  await page.evaluate(
    ({ quotes, timestamp }) =>
      chrome.storage.local.set({
        asset_price_cache_v1: {
          version: 1,
          fetchedAt: timestamp,
          quotes
        },
        asset_market_change_cache_v1: {
          version: 1,
          fetchedAt: timestamp,
          quotes: [
            {
              marketAssetId: 'zcash',
              percent24h: '-0.35',
              observedPriceUsd: '42.75',
              fetchedAt: timestamp
            },
            {
              marketAssetId: 'ethereum',
              percent24h: '0.42',
              observedPriceUsd: '3200',
              fetchedAt: timestamp
            },
            {
              marketAssetId: 'bnb',
              percent24h: '0.18',
              observedPriceUsd: '585',
              fetchedAt: timestamp
            },
            {
              marketAssetId: 'polygon-ecosystem-token',
              percent24h: '-0.24',
              observedPriceUsd: '0.24',
              fetchedAt: timestamp
            },
            {
              marketAssetId: 'avalanche',
              percent24h: '0.65',
              observedPriceUsd: '21.5',
              fetchedAt: timestamp
            },
            {
              marketAssetId: 'bitcoin',
              percent24h: '1.25',
              observedPriceUsd: '63014',
              fetchedAt: timestamp
            }
          ]
        }
      }),
    { quotes: assetQuotes, timestamp: fetchedAt }
  )
}

async function seedSettledZcashBalance(page: Page, balance: ZcashBalance): Promise<void> {
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ABORT_SYNC' }))
  await expect
    .poll(async () => {
      const state = (await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_SYNC_STATE' })
      )) as { isSyncing?: boolean }
      return state.isSyncing
    })
    .toBe(false)

  await page.evaluate(async accountBalance => {
    const local = await chrome.storage.local.get(['wallet_state', 'account_data'])
    const walletState =
      typeof local.wallet_state === 'string' ? JSON.parse(local.wallet_state) : local.wallet_state
    const accountData =
      typeof local.account_data === 'string' ? JSON.parse(local.account_data) : local.account_data
    const walletId = walletState?.state?.currentWalletId
    const accountId = walletState?.state?.currentAccountId
    if (typeof walletId !== 'string' || typeof accountId !== 'string') {
      throw new Error('Active Wallet fixture is missing')
    }
    const accountKey = `mainnet_${walletId}_${accountId}`
    const walletKey = `mainnet_${walletId}`
    const next = {
      ...(accountData ?? {}),
      state: {
        ...(accountData?.state ?? {}),
        balances: { ...(accountData?.state?.balances ?? {}), [accountKey]: accountBalance },
        syncStates: {
          ...(accountData?.state?.syncStates ?? {}),
          [walletKey]: {
            isSyncing: false,
            syncProgress: 100,
            currentHeight: 3_000_000,
            latestHeight: 3_000_000,
            lastSyncTime: Date.now(),
            etaMs: null,
            syncReason: null
          }
        }
      }
    }
    await chrome.storage.local.set({
      account_data: typeof local.account_data === 'string' ? JSON.stringify(next) : next
    })
  }, balance)
}

async function expectPopupWidth(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth
      }))
    )
    .toEqual({ viewportWidth: 375, contentWidth: 375 })
}

async function expectVisibleImagesLoaded(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('img:visible').evaluateAll(images =>
        images.flatMap(image => {
          const icon = image as HTMLImageElement
          return icon.complete && icon.naturalWidth > 0
            ? []
            : [{ alt: icon.alt, src: icon.src, naturalWidth: icon.naturalWidth }]
        })
      )
    )
    .toEqual([])
}

async function readLocalTransactions(page: Page, accountKey: string): Promise<unknown[]> {
  return page.evaluate(
    key =>
      new Promise<unknown[]>((resolve, reject) => {
        const request = indexedDB.open('zcash-wallet-db')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const database = request.result
          const transaction = database.transaction('transactions', 'readonly')
          const stored = transaction.objectStore('transactions').get(key)
          stored.onerror = () => reject(stored.error)
          stored.onsuccess = () => resolve(Array.isArray(stored.result) ? stored.result : [])
          transaction.oncomplete = () => database.close()
        }
      }),
    accountKey
  )
}

async function readPersistedEndpointModes(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const raw = (await chrome.storage.local.get('wallet_settings')).wallet_settings
    const state = typeof raw === 'string' ? JSON.parse(raw).state : raw?.state
    return Object.keys(state?.chainEndpointSettingsByNetwork ?? {}).sort()
  })
}

async function mockCustomRpcEndpoints(context: BrowserContext): Promise<string[]> {
  const requests: string[] = []
  await context.route('https://endpoint-release.noir.test/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    requests.push(`${request.method()} ${url.pathname}`)
    if (url.pathname.endsWith('/bitcoin/block-height/0')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        body: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
      })
      return
    }
    if (['/ethereum', '/arbitrum', '/arbitrum-wrong'].includes(url.pathname)) {
      const payload = request.postDataJSON() as { id?: unknown; method?: unknown }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result: url.pathname === '/arbitrum' ? '0xa4b1' : '0x1'
        })
      })
      return
    }
    if (url.pathname.endsWith('/GetLightdInfo')) {
      const name = Buffer.from(url.pathname.startsWith('/zcash-wrong/') ? 'test' : 'main')
      const protobuf = Buffer.concat([Buffer.from([0x22, name.length]), name])
      const header = Buffer.alloc(5)
      header.writeUInt32BE(protobuf.length, 1)
      await route.fulfill({
        status: 200,
        contentType: 'application/grpc-web+proto',
        body: Buffer.concat([header, protobuf])
      })
      return
    }
    if (url.pathname === '/solana') {
      const payload = request.postDataJSON() as { id?: unknown; method?: unknown }
      const result =
        payload.method === 'getBlockHeight'
          ? 100
          : payload.method === 'getLatestBlockhash'
            ? {
                context: { slot: 120 },
                value: {
                  blockhash: SOLANA_NETWORKS.mainnet.genesisHash,
                  lastValidBlockHeight: 250
                }
              }
            : SOLANA_NETWORKS.mainnet.genesisHash
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: payload.id,
          result
        })
      })
      return
    }
    if (url.pathname === '/near') {
      const payload = request.postDataJSON() as {
        id?: unknown
        method?: unknown
        params?: { block_id?: unknown }
      }
      const result =
        payload.method === 'status'
          ? {
              chain_id: 'mainnet',
              sync_info: { latest_block_hash: NEAR_NETWORKS.mainnet.genesisHash }
            }
          : payload.method === 'genesis_config'
            ? {
                chain_id: 'mainnet',
                genesis_height: NEAR_NETWORKS.mainnet.genesisHeight,
                genesis_time: NEAR_NETWORKS.mainnet.genesisTime
              }
            : payload.method === 'block' &&
                payload.params?.block_id === NEAR_NETWORKS.mainnet.genesisHeight
              ? {
                  header: {
                    height: NEAR_NETWORKS.mainnet.genesisHeight,
                    hash: NEAR_NETWORKS.mainnet.genesisHash
                  }
                }
              : null
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', id: payload.id, result })
      })
      return
    }
    await route.abort()
  })
  return requests
}

test('attests custom endpoints for every released chain including Zcash', async ({
  context,
  popup
}) => {
  const requests = await mockCustomRpcEndpoints(context)

  await waitForBackgroundWalletInitialization(popup)
  const settings = {
    schemaVersion: 1,
    activeEvmChainId: 'eip155:1',
    customEvmNetworks: [],
    overrides: [
      {
        chainId: 'eip155:1',
        rpc: {
          protocol: 'evm-json-rpc',
          label: 'Custom Ethereum RPC',
          url: 'https://endpoint-release.noir.test/ethereum'
        },
        explorer: {
          label: 'Custom Ethereum Explorer',
          baseUrl: 'https://explorer-release.noir.test/ethereum',
          transactionPath: 'transaction'
        }
      },
      {
        chainId: ZCASH_MAINNET_CHAIN_ID,
        rpc: {
          protocol: 'zcash-lightwalletd',
          label: 'Custom Zcash RPC',
          url: 'https://endpoint-release.noir.test/zcash'
        },
        explorer: {
          label: 'Custom Zcash Explorer',
          baseUrl: 'https://explorer-release.noir.test/zcash',
          transactionPath: 'tx'
        }
      },
      {
        chainId: BITCOIN_MAINNET_CHAIN_ID,
        rpc: {
          protocol: 'bitcoin-esplora',
          label: 'Custom Bitcoin RPC',
          url: 'https://endpoint-release.noir.test/bitcoin/'
        },
        explorer: {
          label: 'Custom Bitcoin Explorer',
          baseUrl: 'https://explorer-release.noir.test/bitcoin',
          transactionPath: 'tx'
        }
      },
      {
        chainId: SOLANA_NETWORKS.mainnet.chainId,
        rpc: {
          protocol: 'solana-json-rpc',
          label: 'Custom Solana RPC',
          url: 'https://endpoint-release.noir.test/solana'
        }
      },
      {
        chainId: NEAR_NETWORKS.mainnet.chainId,
        rpc: {
          protocol: 'near-json-rpc',
          label: 'Custom NEAR RPC',
          url: 'https://endpoint-release.noir.test/near'
        }
      }
    ]
  }
  const disabledEndpointIds = new Set([
    ...(!bitcoinEnabled ? [BITCOIN_MAINNET_CHAIN_ID] : []),
    ...(!solanaEnabled ? [SOLANA_NETWORKS.mainnet.chainId] : []),
    ...(!nearEnabled ? [NEAR_NETWORKS.mainnet.chainId] : [])
  ])
  settings.overrides = settings.overrides.filter(
    override => !disabledEndpointIds.has(override.chainId)
  )
  const applied = await popup.evaluate(
    value => chrome.runtime.sendMessage({ type: 'APPLY_CHAIN_ENDPOINT_SETTINGS', settings: value }),
    settings
  )
  const expectedSettings = settings
  expect(applied).toEqual({ result: expectedSettings })
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' }))
    )
    .toEqual({ result: expectedSettings })
  expect(requests).toEqual(
    expect.arrayContaining([
      'POST /ethereum',
      ...(solanaEnabled ? ['POST /solana'] : []),
      ...(nearEnabled ? ['POST /near'] : []),
      ...(bitcoinEnabled ? ['GET /bitcoin/block-height/0'] : [])
    ])
  )
  expect(requests).toContain('POST /zcash/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo')
})

test('adds, persists, selects and removes custom RPCs through the real popup', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(180_000)
  await context.route('https://rpc.zknoir.com/v1/rpc-endpoints?scope=multichain', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(RPC_REGISTRY) })
  )
  await mockCustomRpcEndpoints(context)
  await mockExternalAssetIcons(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.getByRole('button', { name: 'Settings', exact: true }).click()
  await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'RPC Endpoints' })).toBeVisible()

  const releasedRpcChains = [
    ['Arbitrum', 'arbitrum'],
    ...(bitcoinEnabled ? [['Bitcoin', 'bitcoin/']] : []),
    ...(solanaEnabled ? [['Solana', 'solana']] : []),
    ...(nearEnabled ? [['NEAR', 'near']] : []),
    ['Zcash', 'zcash']
  ]
  for (const [index, [chain, path]] of releasedRpcChains.entries()) {
    const customUrl =
      chain === 'Zcash'
        ? 'https://zcashwebrpc.deltarpc.com'
        : `https://endpoint-release.noir.test/${path}`
    await popup.getByRole('button', { name: `Configure ${chain} RPC` }).click()
    const dialog = popup.getByRole('dialog')
    await expect(dialog.getByLabel(`${chain} RPC URL`)).toHaveCount(0)
    if (chain === 'Arbitrum') {
      for (const provider of ['dRPC', 'PublicNode', 'ZAN']) {
        await expect(dialog.getByRole('button', { name: `Use ${provider} RPC` })).toBeVisible()
      }
      await expect(dialog.getByRole('button', { name: 'Use automatic RPC' })).toContainText(
        'Starts with dRPC · arbitrum.drpc.org'
      )
      await captureScreenshot(popup, 'rpc-arbitrum-presets.png')
      await dialog.getByRole('button', { name: 'Use automatic RPC' }).click()
      await expect(dialog).toHaveCount(0)
      await popup.getByRole('button', { name: 'Configure Arbitrum RPC' }).click()
      await dialog.getByRole('button', { name: 'Use dRPC RPC' }).click()
      await expect(dialog).toHaveCount(0)
      await popup.getByRole('button', { name: 'Configure Arbitrum RPC' }).click()
      await expect(dialog.getByRole('button', { name: 'Use dRPC RPC' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await dialog.getByLabel('Custom RPC name').fill(`My ${chain}`)
    await dialog.getByLabel(`${chain} RPC URL`).fill(customUrl)
    if (chain === 'Arbitrum' || chain === 'Zcash') {
      await dialog
        .getByLabel(`${chain} RPC URL`)
        .fill(`https://endpoint-release.noir.test/${path}-wrong`)
      await dialog.getByRole('button', { name: 'Verify & Add' }).click()
      await expect(popup.getByText('RPC Validation Failed', { exact: true })).toBeVisible()
      const settings = await popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' })
      )
      expect(settings.result.savedRpcEndpoints ?? []).toHaveLength(index)
      await dialog.getByLabel(`${chain} RPC URL`).fill(customUrl)
    }
    await captureScreenshot(popup, `rpc-add-${chain.toLowerCase()}.png`)
    await dialog.getByRole('button', { name: 'Verify & Add' }).click()
    await expect(dialog).toHaveCount(0, { timeout: 30_000 })
  }

  await popup.reload()
  await popup.getByRole('button', { name: 'Settings', exact: true }).click()
  await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'RPC Endpoints' })).toBeVisible()
  const stored = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' })
  )
  expect(stored.result.savedRpcEndpoints).toHaveLength(releasedRpcChains.length)
  expect(await readPersistedEndpointModes(popup)).toEqual(['mainnet'])
  for (const [chain] of releasedRpcChains) {
    await popup.getByRole('button', { name: `Configure ${chain} RPC` }).click()
    const dialog = popup.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: `Use My ${chain} RPC` })).toBeVisible()
    await dialog.getByRole('button', { name: `Use My ${chain} RPC` }).click()
    if (chain === 'Zcash') {
      await expect(dialog.getByRole('button', { name: `Use My ${chain} RPC` })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    } else {
      await expect(dialog).toHaveCount(0, { timeout: 30_000 })
      await popup.getByRole('button', { name: `Configure ${chain} RPC` }).click()
    }
    await captureScreenshot(popup, `rpc-saved-${chain.toLowerCase()}.png`)
    if (chain === 'Arbitrum') {
      const offlinePrimary = (route: Route) => route.abort()
      await context.route('https://arbitrum.drpc.org/**', offlinePrimary)
      await dialog.getByRole('button', { name: 'Use automatic RPC' }).click()
      await expect(dialog).toHaveCount(0, { timeout: 30_000 })
      await context.unroute('https://arbitrum.drpc.org/**', offlinePrimary)
      const autoSettings = await popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' })
      )
      expect(findChainEndpointOverride(autoSettings.result, 'eip155:42161')?.rpc).toBeUndefined()
      await popup.getByRole('button', { name: 'Configure Arbitrum RPC' }).click()
      await expect(dialog.getByRole('button', { name: 'Use automatic RPC' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    }
    await expect
      .poll(() =>
        popup.evaluate(() =>
          document
            .getAnimations()
            .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
            .every(animation => animation.playState === 'finished')
        )
      )
      .toBe(true)
    await expect(dialog.getByRole('button', { name: 'Verify & Save' })).toHaveCount(0)
    const width = await popup.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(375)
    await popup
      .getByRole('dialog')
      .getByRole('button', { name: `Remove My ${chain}` })
      .click()
    await popup.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(popup.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })
  }
  const removed = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' })
  )
  expect(removed.result.savedRpcEndpoints).toEqual([])
  expect(removed.result.overrides).toEqual([])

  const sidePanel = await context.newPage()
  await sidePanel.setViewportSize({ width: 480, height: 900 })
  await sidePanel.goto(`chrome-extension://${extensionId}/index.html?surface=side-panel`)
  await sidePanel.getByRole('button', { name: 'Settings', exact: true }).click()
  await sidePanel.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
  await sidePanel.getByRole('button', { name: 'Configure Arbitrum RPC' }).click()
  const sidePanelDialog = sidePanel.getByRole('dialog')
  const presets = sidePanelDialog.getByTestId('provider-presets')
  await expect(sidePanelDialog.getByRole('button', { name: 'Use ZAN RPC' })).toBeInViewport()
  expect(await presets.evaluate(element => element.scrollHeight - element.clientHeight)).toBe(0)
  await captureScreenshot(sidePanel, 'rpc-arbitrum-presets-side-panel.png')
  await sidePanel.close()
})

test('exposes the released multichain provider surface by default', async ({ context }) => {
  await context.route('https://provider-release.noir.test/**', serveSdkExample)
  await context.route('https://assets.zknoir.com/chain/**', route =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: TEST_ICON_SVG
    })
  )
  const page = await context.newPage()
  await page.addInitScript(() => {
    const announcements: unknown[] = []
    Reflect.set(window, 'ethereum', Object.freeze({ isMetaMask: true }))
    window.addEventListener('eip6963:announceProvider', event => {
      announcements.push((event as CustomEvent).detail)
    })
    Reflect.set(window, '__noirInitialEip6963Announcements', announcements)
  })
  await page.goto('https://provider-release.noir.test/example/')
  await page.waitForFunction(() => 'noirwallet' in window)

  await expect(page.getByRole('heading', { name: 'Multichain SDK Playground' })).toBeVisible()
  await expect(page.getByText('SDK Example V2', { exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Provider examples' })).toBeVisible()
  await page.getByRole('button', { name: 'Ethereum', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'EVM provider' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'EVM provider' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect EVM' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Smart contract testing' })).toBeVisible()
  await expect(page.getByLabel('NoirTestBench address')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verify revert block' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Ethereum', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Avalanche', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Testnet' }).click()
  await expect(page.getByRole('button', { name: 'Sepolia', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Avalanche Fuji', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Solana Devnet', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NEAR Testnet', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Mainnet' }).click()
  await expect(page.getByRole('button', { name: 'Solana', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'NEAR', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Solana', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Solana dApp provider' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign serialized transaction' })).toBeVisible()
  await expect(
    page.getByText("Balance and token reads use the dApp's own Solana RPC client.")
  ).toBeVisible()
  await expect(page.getByLabel('CAIP-19 token asset ID')).toHaveCount(0)
  await page.getByRole('button', { name: 'NEAR', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'NEAR dApp provider' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign NEAR function call' })).toBeVisible()
  await expect(
    page.getByText("Balance and token reads use the dApp's own NEAR RPC client.")
  ).toBeVisible()
  await page.getByRole('button', { name: 'Ethereum', exact: true }).click()
  const providerNetworkButtons = page.locator('.provider-network-button')
  const providerNetworkButtonCount = await providerNetworkButtons.count()
  const providerNetworkIcons = page.locator('.provider-network-icon-frame img')
  expect(
    await providerNetworkIcons.evaluateAll(images =>
      images.every(image =>
        image.getAttribute('src')?.startsWith('https://assets.zknoir.com/chain/')
      )
    )
  ).toBe(true)
  expect(
    await providerNetworkButtons.evaluateAll(
      buttons => new Set(buttons.map(button => Math.round(button.getBoundingClientRect().top))).size
    )
  ).toBeLessThanOrEqual(2)
  const titleWidth = await page
    .getByRole('heading', { name: 'Multichain SDK Playground' })
    .evaluate(heading => ({ clientWidth: heading.clientWidth, scrollWidth: heading.scrollWidth }))
  expect(titleWidth.scrollWidth).toBeLessThanOrEqual(titleWidth.clientWidth)
  await expect
    .poll(
      () =>
        providerNetworkIcons.evaluateAll(
          images =>
            images.filter(image => {
              const element = image as HTMLImageElement
              return !element.hidden && element.complete && element.naturalWidth > 0
            }).length
        ),
      { timeout: 15_000 }
    )
    .toBe(providerNetworkButtonCount)
  await captureScreenshot(page, 'sdk-example-evm.png')
  await page.getByRole('button', { name: 'Bitcoin', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bitcoin provider' })).toBeVisible()
  if (bitcoinEnabled)
    await expect(page.getByRole('button', { name: 'Connect Bitcoin' })).toBeEnabled()
  else await expect(page.getByRole('button', { name: 'Connect Bitcoin' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Validate network' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Validate chain' })).toBeDisabled()
  await captureScreenshot(page, 'sdk-example-bitcoin.png')

  await page.setViewportSize({ width: 375, height: 812 })
  await expect
    .poll(() =>
      page.evaluate(() => ({
        viewportWidth: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth
      }))
    )
    .toEqual({ viewportWidth: 375, contentWidth: 375 })
  await expect(page.getByRole('button', { name: 'Connect Bitcoin' })).toBeVisible()

  const result = await page.evaluate(() => {
    const announcements: unknown[] = []
    const nearConnectWallets: unknown[] = []
    window.addEventListener('eip6963:announceProvider', event => {
      announcements.push((event as CustomEvent).detail)
    })
    window.addEventListener('near-wallet-injected', event => {
      nearConnectWallets.push((event as CustomEvent).detail)
    })
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    window.dispatchEvent(new Event('near-selector-ready'))
    const nearConnectWallet = nearConnectWallets[0] as
      | {
          manifest?: {
            id?: unknown
            name?: unknown
            icon?: unknown
            features?: { signInWithoutAddKey?: unknown; signAndSendTransaction?: unknown }
          }
          signIn?: unknown
        }
      | undefined
    const target = window as typeof window & {
      noirwallet?: {
        zcash?: { request?: unknown }
        ethereum?: unknown
        bitcoin?: unknown
        solana?: {
          getAccounts?: unknown
          getTokenBalance?: unknown
          sendTokenTransfer?: unknown
          signTransaction?: unknown
          signAllTransactions?: unknown
          signAndSendTransaction?: unknown
          signMessage?: unknown
        }
        near?: {
          getAccounts?: unknown
          getTokenBalance?: unknown
          sendTokenTransfer?: unknown
          requestSignIn?: unknown
          signTransaction?: unknown
          requestSignTransactions?: unknown
          signMessage?: unknown
        }
      }
      ethereum?: unknown
    }
    const originalEthereum = target.ethereum
    const laterWalletProvider = Object.freeze({ isMetaMask: true })
    const acceptsLaterWallet = Reflect.set(target, 'ethereum', laterWalletProvider)
    const laterWalletBecameDefault = target.ethereum === laterWalletProvider
    const noirProviderStayedAvailable = target.noirwallet?.ethereum !== undefined
    if (acceptsLaterWallet) Reflect.set(target, 'ethereum', originalEthereum)
    const initialAnnouncements = Reflect.get(window, '__noirInitialEip6963Announcements')
    const initialNoirAnnouncementObserved = Array.isArray(initialAnnouncements)
      ? initialAnnouncements.filter(
          detail =>
            typeof detail === 'object' &&
            detail !== null &&
            typeof Reflect.get(detail, 'info') === 'object' &&
            Reflect.get(Reflect.get(detail, 'info'), 'name') === 'Noir Wallet'
        ).length > 0
      : false
    return {
      zcashRequestType: typeof target.noirwallet?.zcash?.request,
      hasNoirEthereum: target.noirwallet?.ethereum !== undefined,
      hasNoirBitcoin: target.noirwallet?.bitcoin !== undefined,
      hasNoirSolana: target.noirwallet?.solana !== undefined,
      hasNoirNear: target.noirwallet?.near !== undefined,
      solanaGetAccountsType: typeof target.noirwallet?.solana?.getAccounts,
      solanaTokenBalanceType: typeof target.noirwallet?.solana?.getTokenBalance,
      solanaTokenTransferType: typeof target.noirwallet?.solana?.sendTokenTransfer,
      solanaSignTransactionType: typeof target.noirwallet?.solana?.signTransaction,
      solanaSignAllTransactionsType: typeof target.noirwallet?.solana?.signAllTransactions,
      solanaSignAndSendTransactionType: typeof target.noirwallet?.solana?.signAndSendTransaction,
      solanaSignMessageType: typeof target.noirwallet?.solana?.signMessage,
      nearTokenBalanceType: typeof target.noirwallet?.near?.getTokenBalance,
      nearGetAccountsType: typeof target.noirwallet?.near?.getAccounts,
      nearTokenTransferType: typeof target.noirwallet?.near?.sendTokenTransfer,
      nearRequestSignInType: typeof target.noirwallet?.near?.requestSignIn,
      nearSignTransactionType: typeof target.noirwallet?.near?.signTransaction,
      nearRequestSignTransactionsType: typeof target.noirwallet?.near?.requestSignTransactions,
      nearSignMessageType: typeof target.noirwallet?.near?.signMessage,
      nearConnectAnnouncementCount: nearConnectWallets.length,
      nearConnectWalletId: nearConnectWallet?.manifest?.id,
      nearConnectWalletName: nearConnectWallet?.manifest?.name,
      nearConnectWalletIcon:
        typeof nearConnectWallet?.manifest?.icon === 'string'
          ? nearConnectWallet.manifest.icon
          : null,
      nearConnectSignInType: typeof nearConnectWallet?.signIn,
      nearConnectSignInWithoutAddKey: nearConnectWallet?.manifest?.features?.signInWithoutAddKey,
      nearConnectSignAndSendTransaction:
        nearConnectWallet?.manifest?.features?.signAndSendTransaction,
      hasDefaultEthereum: target.ethereum !== undefined,
      acceptsLaterWallet,
      laterWalletBecameDefault,
      noirProviderStayedAvailable,
      initialNoirAnnouncementObserved,
      announcementCount: announcements.length
    }
  })

  expect(result).toEqual({
    zcashRequestType: 'function',
    hasNoirEthereum: true,
    hasNoirBitcoin: bitcoinEnabled,
    hasNoirSolana: solanaEnabled,
    hasNoirNear: nearEnabled,
    solanaGetAccountsType: solanaEnabled ? 'function' : 'undefined',
    solanaTokenBalanceType: 'undefined',
    solanaTokenTransferType: 'undefined',
    solanaSignTransactionType: solanaEnabled ? 'function' : 'undefined',
    solanaSignAllTransactionsType: solanaEnabled ? 'function' : 'undefined',
    solanaSignAndSendTransactionType: solanaEnabled ? 'function' : 'undefined',
    solanaSignMessageType: solanaEnabled ? 'function' : 'undefined',
    nearTokenBalanceType: 'undefined',
    nearGetAccountsType: nearEnabled ? 'function' : 'undefined',
    nearTokenTransferType: 'undefined',
    nearRequestSignInType: nearEnabled ? 'function' : 'undefined',
    nearSignTransactionType: nearEnabled ? 'function' : 'undefined',
    nearRequestSignTransactionsType: nearEnabled ? 'function' : 'undefined',
    nearSignMessageType: nearEnabled ? 'function' : 'undefined',
    nearConnectAnnouncementCount: nearEnabled ? 1 : 0,
    nearConnectWalletId: nearEnabled ? 'noir-wallet' : undefined,
    nearConnectWalletName: nearEnabled ? 'Noir Wallet' : undefined,
    nearConnectWalletIcon: nearEnabled ? PROVIDER_ICON_DATA_URL : null,
    nearConnectSignInType: nearEnabled ? 'function' : 'undefined',
    nearConnectSignInWithoutAddKey: nearEnabled ? true : undefined,
    nearConnectSignAndSendTransaction: nearEnabled ? true : undefined,
    hasDefaultEthereum: true,
    acceptsLaterWallet: true,
    laterWalletBecameDefault: true,
    noirProviderStayedAvailable: true,
    initialNoirAnnouncementObserved: true,
    announcementCount: 1
  })
  await page.close()
})

test('creates one CAIP-25 session for every released provider', async ({ context, popup }) => {
  test.skip(
    !bitcoinEnabled || !solanaEnabled || !nearEnabled,
    'Requires an explicit five-chain verification profile'
  )
  test.skip(
    process.env.APPROVAL_WINDOW_E2E !== '1',
    'Chrome popup windows require an explicit real-browser approval run'
  )
  test.setTimeout(180_000)
  const origin = 'https://provider-release.noir.test'
  await context.route(`${origin}/**`, serveSdkExample)
  await mockExternalAssetIcons(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const page = await context.newPage()
  await page.goto(`${origin}/example/`)
  await page.waitForFunction(() => 'noirwallet' in window)
  await expectDAppTabFavicon(page, popup)

  const approvalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect all networks' }).click()
  const approval = await approvalPromise
  await approval.waitForURL(/#approval\?requestId=/)
  await approval.setViewportSize({ width: 375, height: 632 })
  await expectDAppConnectionHeader(approval, {
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`
  })
  await expect(approval.locator('[data-caip25-scope]')).toHaveCount(5)
  await expect(approval.getByText('5 networks · 5 selected', { exact: true })).toBeVisible()
  await expect(approval.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
  await captureScreenshot(approval, 'caip25-multichain-session-approval.png')
  const firstScope = approval.locator('[data-caip25-scope]').first()
  await firstScope.locator(':scope > button').click()
  await expect(firstScope.locator('[data-caip25-account]')).toHaveCount(1)
  await approval.getByRole('button', { name: 'Connect', exact: true }).click()

  await expect(page.getByText('5 networks authorized', { exact: true })).toBeVisible()
  const storedSession = await popup.evaluate(async expectedOrigin => {
    const stored = await chrome.storage.local.get('connectedDApps')
    const connections = Array.isArray(stored.connectedDApps) ? stored.connectedDApps : []
    const connection = connections.find(
      candidate =>
        typeof candidate === 'object' &&
        candidate !== null &&
        Reflect.get(candidate, 'origin') === expectedOrigin
    )
    return connection ? Reflect.get(connection, 'caip25Session') : null
  }, origin)
  expect(storedSession).toEqual(expect.objectContaining({ scopes: expect.any(Array) }))
  await page.reload()
  await page.waitForFunction(() => 'noirwallet' in window)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const wallet = Reflect.get(window, 'noirwallet') as
          | { multichain?: { getSession(): Promise<{ scopes: Record<string, unknown> } | null> } }
          | undefined
        if (!wallet?.multichain) return { scopeCount: 0, error: 'Provider unavailable' }
        try {
          const session = await wallet.multichain.getSession()
          return { scopeCount: session ? Object.keys(session.scopes).length : 0, error: null }
        } catch (error) {
          return {
            scopeCount: 0,
            error: error instanceof Error ? error.message : String(error)
          }
        }
      })
    )
    .toEqual({ scopeCount: 5, error: null })
  await expect(page.getByText('5 networks authorized', { exact: true })).toBeVisible()
  const providerState = await page.evaluate(async () => {
    type Session = {
      scopes: Record<string, { accounts: readonly string[] }>
    }
    type RequestProvider = {
      request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>
    }
    type AccountsProvider = {
      getAccounts(): Promise<readonly string[]>
    }
    const wallet = Reflect.get(window, 'noirwallet') as
      | {
          multichain: {
            getSession(): Promise<Session | null>
            invokeMethod(params: {
              scope: string
              request: { method: string; params?: readonly unknown[] }
            }): Promise<unknown>
          }
          ethereum: RequestProvider
          bitcoin: AccountsProvider
          solana: AccountsProvider
          near: AccountsProvider
        }
      | undefined
    if (!wallet?.multichain) throw new Error('Multichain provider is unavailable.')
    const session = await wallet.multichain.getSession()
    const invokedAccounts = await wallet.multichain.invokeMethod({
      scope: 'eip155:1',
      request: { method: 'eth_accounts', params: [] }
    })
    let deniedCode: number | null = null
    try {
      await wallet.ethereum.request({ method: 'eth_blockNumber' })
    } catch (error) {
      deniedCode =
        typeof error === 'object' &&
        error !== null &&
        typeof Reflect.get(error, 'code') === 'number'
          ? Reflect.get(error, 'code')
          : null
    }
    return {
      scopeCount: session ? Object.keys(session.scopes).length : 0,
      scopeAccountCounts: session
        ? Object.values(session.scopes).map(scope => scope.accounts.length)
        : [],
      invokedAccounts,
      evmAccounts: await wallet.ethereum.request({ method: 'eth_accounts' }),
      bitcoinAccounts: await wallet.bitcoin.getAccounts(),
      solanaAccounts: await wallet.solana.getAccounts(),
      nearAccounts: await wallet.near.getAccounts(),
      deniedCode
    }
  })
  expect(providerState.scopeCount).toBe(5)
  expect(providerState.scopeAccountCounts).toEqual([1, 1, 1, 1, 1])
  expect(providerState.invokedAccounts).toEqual(providerState.evmAccounts)
  expect(providerState.bitcoinAccounts).toHaveLength(1)
  expect(providerState.solanaAccounts).toHaveLength(1)
  expect(providerState.nearAccounts).toHaveLength(1)
  expect(providerState.deniedCode).toBe(4100)

  await page.evaluate(async () => {
    const wallet = Reflect.get(window, 'noirwallet') as
      | { multichain?: { revokeSession(): Promise<null> } }
      | undefined
    if (!wallet?.multichain) throw new Error('Multichain provider is unavailable.')
    await wallet.multichain.revokeSession()
  })
  await expect(page.getByRole('button', { name: 'Connect all networks' })).toBeVisible()
  const revokedState = await page.evaluate(async () => {
    const wallet = Reflect.get(window, 'noirwallet') as
      | {
          multichain: { getSession(): Promise<unknown> }
          ethereum: { request(args: { method: string }): Promise<unknown> }
          bitcoin: { getAccounts(): Promise<readonly string[]> }
          solana: { getAccounts(): Promise<readonly string[]> }
          near: { getAccounts(): Promise<readonly string[]> }
        }
      | undefined
    if (!wallet) throw new Error('Noir Wallet provider is unavailable.')
    return {
      session: await wallet.multichain.getSession(),
      evmAccounts: await wallet.ethereum.request({ method: 'eth_accounts' }),
      bitcoinAccounts: await wallet.bitcoin.getAccounts(),
      solanaAccounts: await wallet.solana.getAccounts(),
      nearAccounts: await wallet.near.getAccounts()
    }
  })
  expect(revokedState).toEqual({
    session: null,
    evmAccounts: [],
    bitcoinAccounts: [],
    solanaAccounts: [],
    nearAccounts: []
  })
})

test('adds a Zcash account after the service worker restores an unlocked session', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()
  await expect(popup.getByRole('button', { name: 'Choose wallet' })).toBeVisible({
    timeout: 30_000
  })
  await expect(popup.getByRole('button', { name: 'Show account addresses' })).toBeVisible()
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  const removeZcashHistoryMock = await mockUnknownZcashAccountHistory(context)
  try {
    await popup.getByRole('button', { name: 'Add Account', exact: true }).click()
    await selectNewZcashAccountHistory(popup)
    await expect(popup.getByText('Account 2', { exact: true })).toBeVisible({ timeout: 60_000 })
    await expect(popup.getByText('Account setup incomplete')).toHaveCount(0)
  } finally {
    await removeZcashHistoryMock()
  }
})

test('wallet-side Connect restores an existing EVM site for the active account', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  const origin = 'https://wallet-connect.noir.test'
  await context.route(`${origin}/**`, route =>
    route.fulfill({ contentType: 'text/html', body: '<title>Wallet Connect</title>' })
  )
  await mockReleasedEvmRpc(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const previous = await popup.evaluate(async () => {
    const walletState = (await chrome.storage.local.get('wallet_state')).wallet_state as {
      state: { currentWalletId: string; currentAccountId: string }
    }
    return {
      walletId: walletState.state.currentWalletId,
      accountId: walletState.state.currentAccountId
    }
  })
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  const removeZcashHistoryMock = await mockUnknownZcashAccountHistory(context)
  await popup.getByRole('button', { name: 'Add Account', exact: true }).click()
  await selectNewZcashAccountHistory(popup)
  await expect(popup.getByText('Account 2', { exact: true })).toBeVisible({ timeout: 60_000 })
  await removeZcashHistoryMock()
  await popup.getByRole('button', { name: 'Switch to Account 2' }).click()
  await expect(popup.getByRole('button', { name: 'Choose wallet' })).toBeVisible()
  await expect
    .poll(() =>
      popup.evaluate(async () => {
        const walletState = (await chrome.storage.local.get('wallet_state')).wallet_state as {
          state: { currentAccountId: string }
        }
        return walletState.state.currentAccountId
      })
    )
    .not.toBe(previous.accountId)
  const active = await popup.evaluate(async () => {
    const walletState = (await chrome.storage.local.get('wallet_state')).wallet_state as {
      state: { currentWalletId: string; currentAccountId: string }
    }
    return {
      walletId: walletState.state.currentWalletId,
      accountId: walletState.state.currentAccountId
    }
  })
  expect(active.accountId).not.toBe(previous.accountId)
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  await popup.getByRole('button', { name: 'Switch to Account 1' }).click()
  await expect(popup.getByText('Account 1', { exact: true })).toBeVisible()
  await popup.evaluate(
    ({ site, account }) =>
      chrome.storage.local.set({
        connectedDApps: [
          {
            id: 'wallet-connect-existing-evm',
            name: 'Wallet Connect',
            host: 'wallet-connect.noir.test',
            origin: site,
            favicon: '',
            connectedAt: Date.now(),
            lastActiveAt: Date.now(),
            chainAuthorizations: [{ chainId: 'eip155:1', accounts: [account], binding: account }]
          }
        ]
      }),
    { site: origin, account: previous }
  )
  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()

  const page = await context.newPage()
  await page.goto(`${origin}/`)
  await page.waitForFunction(() => Boolean(Reflect.get(window, 'noirwallet')))
  await page.evaluate(() => {
    const provider = Reflect.get(Reflect.get(window, 'noirwallet'), 'ethereum') as {
      on(eventName: string, listener: (accounts: string[]) => void): void
    }
    ;(window as typeof window & { walletConnectEvents: string[][] }).walletConnectEvents = []
    provider.on('accountsChanged', accounts => {
      ;(window as typeof window & { walletConnectEvents: string[][] }).walletConnectEvents.push(
        accounts
      )
    })
  })
  const readAccounts = () =>
    page.evaluate(async () => {
      const provider = Reflect.get(Reflect.get(window, 'noirwallet'), 'ethereum') as {
        request(input: { method: string }): Promise<string[]>
      }
      return provider.request({ method: 'eth_accounts' })
    })
  const [previousAddress] = await readAccounts()
  expect(previousAddress).toMatch(/^0x[0-9a-f]{40}$/)
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  await popup.getByRole('button', { name: 'Switch to Account 2' }).click()
  await expect(popup.getByText('Account 2', { exact: true })).toBeVisible()
  await expect.poll(readAccounts).toEqual([previousAddress])
  await expect(popup.getByTestId('dapp-connect-prompt')).toBeVisible()
  await popup.getByTestId('dapp-connect-prompt').getByRole('button', { name: 'Connect' }).click()
  await expect(popup.getByTestId('dapp-connect-prompt')).toHaveCount(0)
  await expect
    .poll(readAccounts)
    .toEqual([expect.stringMatching(/^0x[0-9a-f]{40}$/), previousAddress])
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { walletConnectEvents: string[][] }).walletConnectEvents
      )
    )
    .toContainEqual([expect.stringMatching(/^0x[0-9a-f]{40}$/), previousAddress])

  const connection = await popup.evaluate(async site => {
    const stored = (await chrome.storage.local.get('connectedDApps')).connectedDApps as Array<{
      origin: string
      chainAuthorizations: Array<{
        chainId: string
        accounts: Array<{ walletId: string; accountId: string }>
        binding: { walletId: string; accountId: string }
      }>
      authorizedAccounts?: unknown
    }>
    return stored.find(item => item.origin === site)
  }, origin)
  expect(connection?.chainAuthorizations).toEqual([
    { chainId: 'eip155:1', accounts: [previous, active], binding: active }
  ])
  expect(connection?.authorizedAccounts).toBeUndefined()
  await captureScreenshot(popup, 'wallet-side-evm-connect-success.png')
})

test('connects the SDK example with multi-wallet Zcash, EVM, Bitcoin, Solana, and named NEAR accounts', async ({
  context,
  popup
}) => {
  test.skip(
    !bitcoinEnabled || !solanaEnabled || !nearEnabled,
    'Requires an explicit five-chain verification profile'
  )
  test.skip(
    process.env.APPROVAL_WINDOW_E2E !== '1',
    'Chrome popup windows require an explicit real-browser approval run'
  )
  test.setTimeout(180_000)
  const origin = 'https://provider-release.noir.test'
  await context.route(`${origin}/**`, serveSdkExample)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await context.route('https://api.fastnear.com/v0/public_key/**', async route => {
    const publicKey = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        public_key: publicKey,
        account_ids: ['noir-sdk-example.near']
      })
    })
  })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  const removeZcashHistoryMock = await mockUnknownZcashAccountHistory(context)
  await popup.getByRole('button', { name: 'Add Account', exact: true }).click()
  await selectNewZcashAccountHistory(popup)
  await expect(popup.getByText('Account 2', { exact: true })).toBeVisible({ timeout: 60_000 })
  await removeZcashHistoryMock()

  const page = await context.newPage()
  await page.goto(`${origin}/example/`)
  await page.waitForFunction(() => 'noirwallet' in window)
  await expectDAppTabFavicon(page, popup)

  const zcashApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect Noir Wallet' }).click()
  const zcashApproval = await zcashApprovalPromise
  await zcashApproval.waitForURL(/#approval\?requestId=/)
  await zcashApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppConnectionHeader(zcashApproval, {
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`,
    hiddenChain: 'Zcash'
  })
  await captureScreenshot(zcashApproval, 'zcash-dapp-connect-multi-approval.png')
  await zcashApproval.getByRole('button', { name: 'Edit accounts' }).click()
  await expect(zcashApproval.locator('[data-dapp-account-option="true"]')).toHaveCount(2)
  await zcashApproval.locator('[data-dapp-account-option="true"]').nth(1).click()
  await zcashApproval.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Ethereum', exact: true }).click()
  const evmApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect EVM' }).click()
  const evmApproval = await evmApprovalPromise
  await evmApproval.waitForURL(/#approval\?requestId=/)
  await evmApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppConnectionHeader(evmApproval, {
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`,
    hiddenChain: 'Ethereum'
  })
  await captureScreenshot(evmApproval, 'evm-dapp-connect-multi-approval.png')
  await evmApproval.getByRole('button', { name: 'Edit accounts' }).click()
  await expect(evmApproval.locator('[data-dapp-account-option="true"]')).toHaveCount(2)
  await evmApproval.locator('[data-dapp-account-required="false"]').click()
  await evmApproval.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.provider-result')).toContainText(/^Connected 0x[0-9a-f]{40}$/)

  const arbitrumRpc = EVM_NETWORK_CONFIGS.mainnet.find(
    network => network.chainId === 'eip155:42161'
  )
  if (!arbitrumRpc) throw new Error('Arbitrum RPC is unavailable in the test catalog')
  await context.route(
    url => url.href === new URL(arbitrumRpc.rpcUrl).href,
    async route => {
      const request = route.request().postDataJSON() as { method?: string }
      if (request.method === 'eth_chainId') {
        await route.abort('timedout')
        return
      }
      await route.fallback()
    }
  )

  const arbitrumApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Arbitrum', exact: true }).click()
  const arbitrumApproval = await arbitrumApprovalPromise
  await arbitrumApproval.waitForURL(/#approval\?requestId=/)
  await arbitrumApproval.getByRole('button', { name: 'Switch Network' }).click()
  await expect(page.getByText('0xa4b1', { exact: true })).toBeVisible()
  await expect
    .poll(() => readEvmProviderChainIds(page))
    .toEqual({
      property: '0xa4b1',
      request: '0xa4b1'
    })
  const arbitrumCall = await page.evaluate(() => {
    const provider = (
      window as typeof window & {
        noirwallet: {
          ethereum: { request: (input: { method: string; params: unknown[] }) => Promise<unknown> }
        }
      }
    ).noirwallet.ethereum
    return provider.request({
      method: 'eth_call',
      params: [
        { to: '0x1111111111111111111111111111111111111111', data: '0x', chainId: '0xa4b1' },
        'latest'
      ]
    })
  })
  expect(arbitrumCall).toBe('0x')

  const ethereumApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Ethereum', exact: true }).click()
  const ethereumApproval = await ethereumApprovalPromise
  await ethereumApproval.waitForURL(/#approval\?requestId=/)
  await ethereumApproval.getByRole('button', { name: 'Switch Network' }).click()
  await expect(page.getByText('0x1', { exact: true })).toBeVisible()
  await expect
    .poll(() => readEvmProviderChainIds(page))
    .toEqual({
      property: '0x1',
      request: '0x1'
    })

  await page.getByRole('button', { name: 'Bitcoin', exact: true }).click()
  const bitcoinApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect Bitcoin' }).click()
  const bitcoinApproval = await bitcoinApprovalPromise
  await bitcoinApproval.waitForURL(/#approval\?requestId=/)
  await bitcoinApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppConnectionHeader(bitcoinApproval, {
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`,
    hiddenChain: 'Bitcoin'
  })
  await captureScreenshot(bitcoinApproval, 'bitcoin-dapp-connect-multi-approval.png')
  await bitcoinApproval.getByRole('button', { name: 'Edit accounts' }).click()
  await expect(bitcoinApproval.locator('[data-dapp-account-option="true"]')).toHaveCount(2)
  await bitcoinApproval.locator('[data-dapp-account-required="false"]').click()
  await bitcoinApproval.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.provider-result')).toContainText(/^Connected bc1/)

  await page.getByRole('button', { name: 'Solana', exact: true }).click()
  const solanaApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect Solana' }).click()
  const solanaApproval = await solanaApprovalPromise
  await solanaApproval.waitForURL(/#approval\?requestId=/)
  await solanaApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppConnectionHeader(solanaApproval, {
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`,
    hiddenChain: 'Solana'
  })
  await captureScreenshot(solanaApproval, 'solana-dapp-connect-approval.png')
  await solanaApproval.getByRole('button', { name: 'Edit accounts' }).click()
  await expect(solanaApproval.locator('[data-dapp-account-option="true"]')).toHaveCount(2)
  await solanaApproval.locator('[data-dapp-account-required="false"]').click()
  await solanaApproval.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.provider-result')).toContainText(/^Connected [1-9A-HJ-NP-Za-km-z]+$/)

  const solanaMessageApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Sign message', exact: true }).click()
  const solanaMessageApproval = await solanaMessageApprovalPromise
  await solanaMessageApproval.waitForURL(/#approval\?requestId=/)
  await solanaMessageApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppRequestHeader(solanaMessageApproval, {
    action: 'Sign message',
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`
  })
  await captureScreenshot(solanaMessageApproval, 'solana-dapp-sign-message-approval.png')
  await solanaMessageApproval.getByRole('button', { name: 'Sign message', exact: true }).click()
  await expect(page.locator('.provider-result')).toContainText(/^Signature: /)

  await page.getByRole('button', { name: 'NEAR', exact: true }).click()
  const nearApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Connect NEAR' }).click()
  const nearApproval = await nearApprovalPromise
  await nearApproval.waitForURL(/#approval\?requestId=/)
  await nearApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppConnectionHeader(nearApproval, {
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`,
    hiddenChain: 'NEAR'
  })
  await captureScreenshot(nearApproval, 'near-dapp-connect-approval.png')
  await nearApproval.getByRole('button', { name: 'Edit accounts' }).click()
  await expect(nearApproval.locator('[data-dapp-account-option="true"]')).toHaveCount(2)
  await nearApproval.locator('[data-dapp-account-required="false"]').click()
  await nearApproval.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('.provider-result')).toHaveText('Connected noir-sdk-example.near')

  await page.getByPlaceholder('receiver.near').fill('noir-sdk-example.near')
  const nearMessageApprovalPromise = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Sign message', exact: true }).click()
  const nearMessageApproval = await nearMessageApprovalPromise
  await nearMessageApproval.waitForURL(/#approval\?requestId=/)
  await nearMessageApproval.setViewportSize({ width: 375, height: 632 })
  await expectDAppRequestHeader(nearMessageApproval, {
    action: 'Sign message',
    domain: 'provider-release.noir.test',
    pageUrl: `${origin}/example/`
  })
  await captureScreenshot(nearMessageApproval, 'near-dapp-sign-message-approval.png')
  await nearMessageApproval.getByRole('button', { name: 'Sign message', exact: true }).click()
  await expect(page.locator('.provider-result')).toContainText(/^Signature: /)
})

test('imports and exports scoped EVM and Bitcoin private-key Wallets across Worker restart', async ({
  context,
  popup
}) => {
  test.skip(!bitcoinEnabled, 'Requires an explicit Bitcoin verification profile')
  test.setTimeout(240_000)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const evmPrivateKey = `0x${'00'.repeat(31)}01`
  const bitcoinPrivateKey = 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'
  const importWallet = async (family: 'EVM' | 'Bitcoin', walletName: string): Promise<void> => {
    const addWallet = popup.getByRole('button', { name: 'Add Wallet', exact: true })
    const chooseWallet = popup.getByRole('button', { name: 'Choose wallet' })
    await expect(addWallet.or(chooseWallet)).toBeVisible({ timeout: 30_000 })
    if (await chooseWallet.isVisible()) {
      await chooseWallet.click()
      await expect(addWallet).toBeVisible({ timeout: 30_000 })
    }
    await addWallet.click()
    await popup.getByRole('button', { name: 'Import Wallet', exact: true }).click()
    await popup.getByRole('button', { name: 'Private Key', exact: true }).click()
    await expect(popup.getByRole('heading', { name: 'Import private key' })).toBeVisible()
    const accountCountBeforePreview = await popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
      return response.result?.accounts?.length ?? 0
    })
    await popup.getByLabel('Wallet name').fill(walletName)
    await popup
      .getByLabel('Private key', { exact: true })
      .fill(family === 'EVM' ? evmPrivateKey : bitcoinPrivateKey)
    await expect(popup.getByText('Detected network', { exact: true })).toBeVisible()
    await expect(popup.getByText(family, { exact: true })).toBeVisible()
    if (family === 'EVM') {
      await popup.getByRole('button', { name: 'Change', exact: true }).click()
      await expect(popup.getByRole('button', { name: 'Solana', exact: true })).toBeVisible()
      await expect(popup.getByRole('button', { name: 'NEAR', exact: true })).toBeVisible()
      await popup.getByRole('button', { name: 'Bitcoin', exact: true }).click()
      await expect(popup.getByText('Import as', { exact: true })).toBeVisible()
      await popup.getByLabel('Private key', { exact: true }).fill('')
      await popup.getByLabel('Private key', { exact: true }).fill(evmPrivateKey)
      await expect(popup.getByText('Detected network', { exact: true })).toBeVisible()
      await expect(popup.getByText('EVM', { exact: true })).toBeVisible()
    }
    await popup.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(popup.getByText(`${family} address preview`, { exact: true })).toBeVisible({
      timeout: 30_000
    })
    await expect(
      popup.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
        return response.result?.accounts?.length ?? 0
      })
    ).resolves.toBe(accountCountBeforePreview)
    await expect(
      popup.getByText(
        family === 'EVM'
          ? `Available on ${EVM_NETWORK_CONFIGS.mainnet.length} EVM networks`
          : 'Native SegWit · 3 additional Bitcoin address formats',
        { exact: true }
      )
    ).toBeVisible()
    if (family === 'EVM') {
      await expect(
        popup.getByText('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf', { exact: true })
      ).toBeVisible()
    }
    if (family === 'EVM') {
      await captureScreenshot(popup, 'release-default-import-evm-private-key.png')
    } else {
      await captureScreenshot(popup, 'release-default-import-bitcoin-private-key.png')
    }
    await popup.getByRole('button', { name: 'Import wallet', exact: true }).click()
    if (family === 'Bitcoin') {
      await expect(popup.getByRole('button', { name: 'Expand low value assets' })).toHaveCount(0)
    }
    await expect(
      popup.getByRole('button', {
        name: family === 'EVM' ? 'View ETH details on Ethereum' : 'View BTC details on Bitcoin'
      })
    ).toBeVisible({
      timeout: 60_000
    })
    await expect(popup.getByText('Unable to load portfolio', { exact: true })).toHaveCount(0)
  }

  await importWallet('EVM', 'Imported EVM Test')
  const evmAccount = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    return response.result?.accounts?.find(
      (account: { walletDisplayName?: string }) => account.walletDisplayName === 'Imported EVM Test'
    )
  })
  expect(evmAccount).toMatchObject({
    walletSource: { kind: 'private-key', chainFamily: 'eip155' },
    active: true,
    networks: expect.arrayContaining([
      expect.objectContaining({ chainId: 'eip155:1' }),
      expect.objectContaining({ chainId: 'eip155:56' }),
      expect.objectContaining({ chainId: 'eip155:42161' }),
      expect.objectContaining({ chainId: 'eip155:8453' })
    ])
  })
  expect(evmAccount.networks).toHaveLength(EVM_NETWORK_CONFIGS.mainnet.length)
  expect(
    new Set(
      evmAccount.networks.flatMap((network: { addresses: readonly { value: string }[] }) =>
        network.addresses.map(address => address.value)
      )
    )
  ).toEqual(new Set(['0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf']))

  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  await popup.getByRole('button', { name: 'Wallet actions for Imported EVM Test' }).click()
  await popup.getByRole('menuitem', { name: 'Export private key' }).click()
  const evmExportOption = popup.getByRole('button', { name: 'EVM', exact: true })
  await expect(evmExportOption.locator('[data-slot="chain-icon-group"] img')).toHaveCount(4)
  await expect(popup.getByRole('button', { name: 'Ethereum', exact: true })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'BNB Chain', exact: true })).toHaveCount(0)
  await popup.getByLabel('Enter password').fill(TEST_PASSWORD)
  await popup.getByRole('button', { name: 'Reveal private key' }).click()
  await expect(popup.getByText(evmPrivateKey, { exact: true })).toHaveClass(/blur/)
  await expect(popup.locator('[data-slot="chain-icon-group"] img')).toHaveCount(4)
  await popup.getByRole('button', { name: 'Reveal', exact: true }).click()
  await expect(popup.getByText(evmPrivateKey, { exact: true })).not.toHaveClass(/blur/)
  await captureScreenshot(popup, 'release-default-export-evm-private-key.png')
  await popup.getByRole('button', { name: 'Back' }).click()

  await importWallet('Bitcoin', 'Imported Bitcoin Test')
  const bitcoinAccount = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
    return response.result?.accounts?.find(
      (account: { walletDisplayName?: string }) =>
        account.walletDisplayName === 'Imported Bitcoin Test'
    )
  })
  expect(bitcoinAccount).toMatchObject({
    walletSource: { kind: 'private-key', chainFamily: 'bip122', bitcoinNetwork: 'mainnet' },
    active: true,
    networks: [
      {
        chainId: BITCOIN_MAINNET_CHAIN_ID,
        addresses: expect.arrayContaining([
          expect.objectContaining({ scheme: 'bitcoin-p2pkh' }),
          expect.objectContaining({ scheme: 'bitcoin-p2sh-p2wpkh' }),
          expect.objectContaining({ scheme: 'bitcoin-p2wpkh', preferredForReceive: true }),
          expect.objectContaining({ scheme: 'bitcoin-p2tr' })
        ])
      }
    ]
  })
  expect(bitcoinAccount.networks[0].addresses).toHaveLength(4)

  const nextPassword = `${TEST_PASSWORD}-next`
  await expect(
    popup.evaluate(
      ({ currentPassword, newPassword }) =>
        chrome.runtime.sendMessage({
          type: 'CHANGE_WALLET_PASSWORD',
          currentPassword,
          newPassword
        }),
      { currentPassword: TEST_PASSWORD, newPassword: nextPassword }
    )
  ).resolves.toEqual({ success: true })

  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()
  await expect(popup.getByRole('heading', { name: 'Enter your password' })).toBeVisible({
    timeout: 30_000
  })
  await popup.getByPlaceholder('Enter Password').fill(nextPassword)
  await popup.getByRole('button', { name: 'Unlock' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(
      () =>
        popup.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
          return (response.result?.accounts ?? [])
            .map((account: { walletDisplayName?: string }) => account.walletDisplayName)
            .filter((name: unknown): name is string => typeof name === 'string')
            .filter(name => name.startsWith('Imported '))
            .sort()
        }),
      { timeout: 30_000 }
    )
    .toEqual(['Imported Bitcoin Test', 'Imported EVM Test'])
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  await expect(popup.getByRole('heading', { name: 'Noir Wallet' })).toBeVisible({
    timeout: 30_000
  })
  await expect(popup.getByText('Imported EVM Test', { exact: true })).toBeVisible()
  await expect(popup.getByText('Imported Bitcoin Test', { exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Wallet actions for Imported Bitcoin Test' }).click()
  await popup.getByRole('menuitem', { name: 'Export private key' }).click()
  await popup.getByLabel('Enter password').fill(TEST_PASSWORD)
  await popup.getByRole('button', { name: 'Reveal private key' }).click()
  await expect(popup.locator('p.text-danger')).toContainText(/password|vault/i)
  await popup.getByLabel('Enter password').fill(nextPassword)
  await popup.getByRole('button', { name: 'Reveal private key' }).click()
  const exportedBitcoin = popup.locator('p.font-mono')
  await expect(exportedBitcoin).toHaveText(/^K[1-9A-HJ-NP-Za-km-z]{51}$/)
  await expect(exportedBitcoin).toHaveClass(/blur/)
  await popup.getByRole('button', { name: 'Reveal', exact: true }).click()
  await captureScreenshot(popup, 'release-default-export-bitcoin-private-key.png')
})

test('shows an estimated Home total when one chain fails and cached prices become stale', async ({
  context,
  popup
}) => {
  test.skip(!bitcoinEnabled, 'Uses an unavailable Bitcoin RPC to reproduce the partial portfolio')
  test.setTimeout(180_000)
  await context.route('https://**', route => route.abort())
  await mockReleasedEvmRpc(context)
  await context.route('https://mempool.space/api/**', route => route.abort())
  await context.route('https://blockstream.info/api/**', route => route.abort())
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await seedFreshAssetPrices(popup)
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toContainText(
    '$6,400',
    { timeout: 60_000 }
  )
  await expect(popup.getByRole('button', { name: /^Estimated total assets/ })).toBeVisible()
  await expect(popup.getByRole('status', { name: 'Loading total assets' })).toHaveCount(0)
  await expect(popup.getByTestId('home-total-assets')).toContainText('$')
  await expect(popup.getByTestId('home-total-assets')).not.toContainText('≈')
  await popup.evaluate(async () => {
    const stored = await chrome.storage.local.get('asset_price_cache_v1')
    const cache = stored.asset_price_cache_v1
    const timestamp = Date.now() - 10 * 60_000
    await chrome.storage.local.remove([
      'asset_market_change_cache_v1',
      'defi_llama_market_change_cache_v1'
    ])
    await chrome.storage.local.set({
      asset_price_cache_v1: {
        ...cache,
        fetchedAt: timestamp,
        quotes: cache.quotes.map((quote: { sourceUpdatedAt: number }) => ({
          ...quote,
          sourceUpdatedAt: timestamp
        }))
      }
    })
  })
  await expect
    .poll(() =>
      popup.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_ASSET_PRICES',
          action: 'read'
        })
        return response.result?.quotes.find(
          (quote: { assetId: string }) => quote.assetId === 'eip155:1/slip44:60'
        )?.freshness
      })
    )
    .toBe('stale')
  await popup.reload()
  await expect(popup.getByRole('button', { name: /^Estimated total assets/ })).toBeVisible({
    timeout: 30_000
  })
  await expect(popup.getByRole('status', { name: 'Loading total assets' })).toHaveCount(0)
  await popup.getByRole('button', { name: /^Estimated total assets/ }).hover()
  await expect(popup.getByRole('tooltip')).toContainText(
    'Some balances or prices are unavailable or out of date.'
  )
  await captureScreenshot(popup, 'home-total-assets-partial.png')
})

test('serves cached EVM balances across Popup reload without repeating RPC reads', async ({
  context,
  popup
}) => {
  test.setTimeout(180_000)
  let lendingCatalogRequests = 0
  let tokenCatalogRequests = 0
  await context.route('**/get_multichain_lending_tokens_data**', route => {
    lendingCatalogRequests += 1
    return route.abort()
  })
  await context.route('https://1click.chaindefuser.com/v0/tokens', route => {
    tokenCatalogRequests += 1
    return route.abort()
  })
  const portfolioRpcRequests = await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await seedFreshAssetPrices(popup)
  await seedSettledZcashBalance(popup, {
    total: '0',
    transparent: '0',
    shielded: '0',
    spendable: '0',
    available: '0'
  })
  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()
  await expect
    .poll(
      () =>
        popup.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({
            type: 'GET_PORTFOLIO',
            action: 'read'
          })
          const model = response.result?.model
          return {
            status: model?.status,
            nonReadyChains: model?.chains
              .filter((chain: { status: string }) => chain.status !== 'ready')
              .map(
                (chain: {
                  chain: { id: string }
                  status: string
                  errorCodes: readonly string[]
                }) => ({
                  chainId: chain.chain.id,
                  status: chain.status,
                  errorCodes: chain.errorCodes
                })
              )
          }
        }),
      { timeout: 30_000 }
    )
    .toEqual({ status: 'ready', nonReadyChains: [] })
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 60_000 })
  await expect(popup.getByRole('button', { name: /^Balances incomplete\./ })).toHaveCount(0, {
    timeout: 30_000
  })
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible({
    timeout: 30_000
  })
  await expect(
    popup
      .getByRole('button', { name: 'View ETH details on Ethereum' })
      .getByTestId('asset-unit-price')
  ).toContainText('$3,200')
  await popup.evaluate(async () => {
    const stored = (await chrome.storage.local.get('wallet_state')).wallet_state
    const walletState = typeof stored === 'string' ? JSON.parse(stored) : stored
    const walletId = walletState?.state?.currentWalletId
    const accountId = walletState?.state?.currentAccountId
    if (typeof walletId !== 'string' || typeof accountId !== 'string') {
      throw new Error('Active Wallet fixture is missing')
    }
    const market = (tokenId: string, symbol: string, supplied: string, suppliedUsd: string) => ({
      id: tokenId,
      tokenId,
      destinationAssetId: `nep141:${tokenId}`,
      symbol,
      displayName: symbol,
      decimals: symbol === 'USDC' ? 6 : 24,
      priceUsd: 1,
      supplyApy: '0',
      totalSupplied: supplied,
      totalSuppliedUsd: suppliedUsd,
      supplied,
      suppliedUsd
    })
    await chrome.storage.local.set({
      lending_market_cache_v1: {
        version: 2,
        entries: {
          [`${walletId}:${accountId}`]: {
            cachedAt: Date.now(),
            markets: [
              market('usdc.test.near', 'USDC', '0.000666', '0.00'),
              market('lst.rhealab.near', 'rNEAR', '0.000000000002021', '0.00')
            ]
          }
        }
      }
    })
  })
  await popup.getByRole('tab', { name: 'Lending' }).click()
  await expect(popup.getByText('0.000666 USDC', { exact: true })).toBeVisible()
  await expect(popup.getByText('0.0₁₁2021 rNEAR', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'REF-13215-lending-small-decimal-balances.png')
  await popup.getByRole('tab', { name: 'Assets' }).click()
  await expect(
    popup.getByTestId('home-total-assets').locator('[data-slot="tooltip-trigger"]')
  ).toHaveCount(1)
  await popup.getByRole('button', { name: 'dApp address: Public' }).click()
  const dappAddressDialog = popup.getByRole('dialog', { name: 'dApp address' })
  await expect(dappAddressDialog.getByTestId('main-address-total')).toHaveText(/^\$/)
  await expect(dappAddressDialog.getByTestId('private-address-total')).toHaveText(/^\$/)
  await captureScreenshot(popup, 'private-defi-home-address-totals.png')
  await dappAddressDialog.getByRole('button', { name: 'Close' }).click()

  const ethereumRpcUrl = new URL(EVM_NETWORK_CONFIGS.mainnet[0].rpcUrl).href
  let abortedEthereumRpcRequests = 0
  const abortEthereumRpc = (route: Route) => {
    abortedEthereumRpcRequests += 1
    return route.abort()
  }
  let lastRequestCount = -1
  let stablePolls = 0
  await expect
    .poll(
      () => {
        const current = portfolioRpcRequests.length
        stablePolls = current === lastRequestCount ? stablePolls + 1 : 0
        lastRequestCount = current
        return stablePolls
      },
      { intervals: [250], timeout: 30_000 }
    )
    .toBeGreaterThanOrEqual(4)
  const requestCountBeforeReload = portfolioRpcRequests.length
  const lendingRequestsBeforeReload = lendingCatalogRequests
  const tokenRequestsBeforeReload = tokenCatalogRequests
  await context.route(ethereumRpcUrl, abortEthereumRpc)
  await popup.reload()

  const portfolioSyncing = popup.getByRole('status', { name: 'Portfolio data is syncing' })
  await expect(portfolioSyncing).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible()
  await expect(popup.getByRole('button', { name: /retry/i })).toHaveCount(0)
  await expect(popup.getByText('Prices delayed', { exact: true })).toHaveCount(0)
  await popup.waitForTimeout(1_500)
  expect(portfolioRpcRequests.slice(requestCountBeforeReload)).toEqual([])
  expect(lendingCatalogRequests).toBe(lendingRequestsBeforeReload)
  expect(tokenCatalogRequests).toBe(tokenRequestsBeforeReload)
  await captureScreenshot(popup, 'release-default-network-persistent-cache.png')

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Send ETH on Ethereum' })).toBeVisible()
  await expect(popup.getByRole('status', { name: 'Loading additional networks' })).toHaveCount(0)
  await popup.waitForTimeout(1_500)
  expect(portfolioRpcRequests.slice(requestCountBeforeReload)).toEqual([])

  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  await expect(popup.getByLabel('Send To')).toBeFocused()
  await expect(popup.getByRole('button', { name: 'Change asset' })).toHaveCount(0)
  await expect(popup.getByTestId('send-asset-header')).toContainText('ETH')
  await expect(popup.getByTestId('send-asset-header')).toContainText('Ethereum')
  const sendSourceButton = popup.getByRole('button', {
    name: 'Choose source account, current main'
  })
  await expect(sendSourceButton).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Choose send source account' })).toHaveCount(0)
  await sendSourceButton.click()
  let sendSourceDialog = popup.getByRole('dialog', { name: 'Choose source account' })
  await expect(sendSourceDialog).toContainText('This choice applies only to this wallet action.')
  await expect(sendSourceDialog.getByText('Selected', { exact: true })).toHaveCount(0)
  await sendSourceDialog.getByRole('radio', { name: /Confidential account/ }).click()
  const privateSendSourceButton = popup.getByRole('button', {
    name: 'Choose source account, current private'
  })
  await expect(privateSendSourceButton).toBeVisible()
  await captureScreenshot(popup, 'release-default-send-private-source.png')
  await privateSendSourceButton.click()
  sendSourceDialog = popup.getByRole('dialog', { name: 'Choose source account' })
  await sendSourceDialog.getByRole('radio', { name: /Public account/ }).click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current main' })
  ).toBeVisible()
  await expect(popup.getByText('Send to', { exact: true })).toBeVisible()
  await expect(popup.getByText('Amount', { exact: true })).toBeVisible()
  await expect(popup.getByLabel('Send To')).toHaveCSS('height', '56px')
  await expect(popup.getByTestId('send-amount-card')).toHaveCSS('min-height', '92px')
  await expect(popup.getByTestId('send-network-fee')).toBeVisible()
  await captureScreenshot(popup, 'release-default-send-input-cards.png')
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByLabel('Search your assets')).toBeVisible()

  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible()
  await popup.waitForTimeout(1_500)
  expect(portfolioRpcRequests.slice(requestCountBeforeReload)).toEqual([])
  expect(lendingCatalogRequests).toBe(lendingRequestsBeforeReload)
  expect(tokenCatalogRequests).toBe(tokenRequestsBeforeReload)

  await popup.getByRole('button', { name: 'Expand low value assets' }).click()
  await popup.getByRole('button', { name: 'View USDC details on Ethereum' }).click()
  await expect(popup.getByRole('heading', { name: 'USDC', exact: true })).toBeVisible()
  await expect(
    popup.getByTestId('asset-detail-token-icon').getByRole('img', { name: 'Ethereum' })
  ).toBeVisible()
  await expect(popup.getByText('Ethereum', { exact: true })).toHaveCount(0)
  await popup.waitForTimeout(1_500)
  expect(portfolioRpcRequests.slice(requestCountBeforeReload)).toEqual([])
  const ethereumRequestsAfterFirstDetail = abortedEthereumRpcRequests

  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()
  const expandLowValueAssets = popup.getByRole('button', { name: 'Expand low value assets' })
  if (await expandLowValueAssets.isVisible()) await expandLowValueAssets.click()
  await popup.getByRole('button', { name: 'View USDC details on Ethereum' }).click()
  await expect(popup.getByRole('heading', { name: 'USDC', exact: true })).toBeVisible()
  await popup.waitForTimeout(1_500)
  expect(portfolioRpcRequests.slice(requestCountBeforeReload)).toEqual([])
  expect(abortedEthereumRpcRequests).toBe(ethereumRequestsAfterFirstDetail)
  await captureScreenshot(popup, 'release-default-token-chain-badge.png')

  await context.unroute(ethereumRpcUrl, abortEthereumRpc)
})

test('shows the global dApp account mode before an EVM dApp connects', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  const priceUpdatedAt = new Date().toISOString()
  const canonicalEth = {
    assetId: 'nep141:eth.omft.near',
    blockchain: 'eth',
    chainId: 1,
    contractAddress: null,
    decimals: 18,
    price: 3_200,
    priceUpdatedAt,
    symbol: 'ETH',
    address: 'nep141:eth.omft.near',
    isNative: true
  }
  await context.route('https://1click.chaindefuser.com/v0/tokens', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([canonicalEth])
    })
  )
  await context.route('https://api.rhea.finance/get_chain_prices**', route => {
    const chainId = Number(new URL(route.request().url()).searchParams.get('chain'))
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data: chainId === 1 ? { [canonicalEth.assetId]: canonicalEth } : {}
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
        data: { tokens: chainId === 1 ? [canonicalEth] : [] }
      })
    })
  })
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 60_000 })

  await popup.getByRole('button', { name: 'dApp address: Public' }).click()
  const executionModeCard = popup
    .getByRole('dialog', { name: 'dApp address' })
    .getByTestId('dapp-execution-mode-card')
  await expect(executionModeCard).toBeVisible()
  await expect(executionModeCard.getByText('No dApps connected.', { exact: true })).toBeVisible()
  await expect(
    executionModeCard.getByRole('radio', { name: 'Use Public address for dApps' })
  ).toBeChecked()
  await expect(
    executionModeCard.getByRole('radio', { name: 'Use Confidential address for dApps' })
  ).toBeEnabled({ timeout: 30_000 })

  await expect
    .poll(async () => {
      const [cardBox, viewportHeight] = await Promise.all([
        executionModeCard.boundingBox(),
        popup.evaluate(() => document.documentElement.clientHeight)
      ])
      return Boolean(
        cardBox && cardBox.y >= 0 && cardBox.y + cardBox.height <= viewportHeight + 0.5
      )
    })
    .toBe(true)
  await captureScreenshot(popup, 'release-default-dapp-mode-empty.png')
  await executionModeCard.getByRole('radio', { name: 'Use Confidential address for dApps' }).click()
  const privateSetupDialog = popup.getByRole('dialog', { name: 'Turn on dApp privacy?' })
  if (await privateSetupDialog.isVisible()) {
    await privateSetupDialog.getByRole('button', { name: 'Turn on' }).click()
  }
  await expect(popup.getByRole('button', { name: 'dApp address: Confidential' })).toBeVisible()
  await popup.getByRole('button', { name: 'dApp address: Confidential' }).click()
  const privateModeCard = popup
    .getByRole('dialog', { name: 'dApp address' })
    .getByTestId('dapp-execution-mode-card')
  await expect(
    privateModeCard.getByRole('radio', { name: 'Use Confidential address for dApps' })
  ).toBeChecked()
  await captureScreenshot(popup, 'release-default-dapp-mode-private.png')
  await popup.getByRole('button', { name: 'Close' }).click()

  await popup.getByRole('button', { name: 'Show account addresses' }).click()
  const accountAddressMenu = popup.getByLabel('Account address menu')
  await expect(
    accountAddressMenu.getByRole('button', { name: 'Copy EVM Confidential address' })
  ).toBeVisible()
  await captureScreenshot(popup, 'release-default-private-address-menu.png')
  await accountAddressMenu.getByRole('button', { name: 'View all' }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await expect(
    popup.getByRole('button', { name: 'Copy Confidential address' }).first()
  ).toBeVisible()
  await captureScreenshot(popup, 'release-default-private-addresses.png')
  await popup.getByRole('button', { name: 'Back' }).click()

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  const privateSendSource = popup.getByRole('button', {
    name: 'Choose source account, current private'
  })
  await expect(privateSendSource).toBeVisible()
  await captureScreenshot(popup, 'release-default-send-global-private.png')
  await privateSendSource.click()
  await expect(
    popup
      .getByRole('dialog', { name: 'Choose source account' })
      .getByRole('radio', { name: /Confidential account/ })
  ).toBeChecked()
  await popup.getByRole('button', { name: 'Close' }).click()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByLabel('Search your assets')).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()

  await popup.getByRole('button', { name: 'View ETH details on Ethereum' }).click()
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('status', { name: 'Loading swap assets' })).toHaveCount(0, {
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'From asset' }).click()
  const sourceSelector = popup.getByRole('dialog')
  await sourceSelector
    .getByRole('button', { name: 'Filter assets by network: All Networks' })
    .click()
  await popup.getByRole('menuitemradio', { name: 'Ethereum', exact: true }).click()
  await sourceSelector.getByPlaceholder('Search tokens').fill('ETH')
  await sourceSelector
    .getByRole('button', { name: /^ETH on Ethereum/ })
    .first()
    .click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current private' })
  ).toBeVisible({ timeout: 30_000 })
  await captureScreenshot(popup, 'release-default-swap-global-private.png')
})

test('REF-13211 shows the Private USDC Gas requirement before transfer preparation', async ({
  context,
  popup
}) => {
  test.setTimeout(180_000)
  await mockExternalAssetIcons(context)
  await context.route('**/get_multichain_lending_tokens_data**', route => route.abort())
  await context.route('https://1click.chaindefuser.com/v0/tokens', route => route.abort())
  await mockEvmHistoryProxy(context)
  await mockReleasedEvmRpc(context, 'mainnet', {
    nativeBalanceRaw: 0n,
    bundledUsdcBalanceRaw: 1_764_712n
  })
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await seedFreshAssetPrices(popup)

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(popup.getByRole('status', { name: 'Loading additional networks' })).toHaveCount(0, {
    timeout: 30_000
  })
  await popup.getByRole('button', { name: 'Send USDC on Arbitrum' }).click()
  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()

  await expect(popup.getByTestId('send-asset-header')).toContainText('USDC')
  await expect(
    popup.getByTestId('send-asset-header').getByText('To Arbitrum', { exact: true })
  ).toBeVisible()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current private' })
  ).toBeVisible()
  await popup.getByLabel('Send To').fill('0x9C73842d02D1Fe00000000000000000000000000')
  await popup.getByLabel('USDC amount').fill('1')
  await expect(popup.getByTestId('send-amount-card')).toContainText('Available 1.764 USDC')
  const missingGasAlert = popup.getByRole('alert').filter({
    hasText: 'Insufficient ETH balance.'
  })
  await expect(missingGasAlert).toBeVisible()
  await expect(popup.getByRole('button', { name: /View (?:Private )?address/ })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await missingGasAlert.scrollIntoViewIfNeeded()
  await captureScreenshot(popup, 'REF-13207-noirv2-improve-balance-message.png')
  await captureScreenshot(popup, 'REF-13211-noirv2-still-errors.png')
})

test('renders and switches the released EVM catalog and chain-scoped endpoint settings', async ({
  context,
  popup,
  extensionId
}) => {
  test.skip(
    !bitcoinEnabled || !nearEnabled,
    'This mixed-chain journey requires explicit Bitcoin and NEAR flags'
  )
  test.setTimeout(300_000)
  const evmHistoryRequests = await mockEvmHistoryProxy(context, 1_500)
  const portfolioRpcRequests = await mockReleasedEvmRpc(context)
  const bitcoinRequests = await mockReleasedBitcoinEsplora(context)
  const marketHistoryRequests = await mockAssetMarketHistory(context)
  await context.route('https://1click.chaindefuser.com/**', route => route.abort())
  await context.route('https://api.dexscreener.com/**', route => route.abort())
  const transferEth = {
    assetId: 'nep141:eth.omft.near',
    blockchain: 'eth',
    chainId: 1,
    contractAddress: null,
    decimals: 18,
    price: 3_200,
    priceUpdatedAt: new Date().toISOString(),
    symbol: 'ETH',
    address: 'nep141:eth.omft.near',
    isNative: true
  }
  await context.route('https://api.rhea.finance/get_chain_prices**', route => {
    const chainId = Number(new URL(route.request().url()).searchParams.get('chain'))
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        msg: 'success',
        data: chainId === 1 ? { [transferEth.assetId]: transferEth } : {}
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
        data: { tokens: chainId === 1 ? [transferEth] : [] }
      })
    })
  })
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await seedFreshAssetPrices(popup)
  await popup.getByRole('button', { name: 'Choose wallet' }).click()
  const removeZcashHistoryMock = await mockUnknownZcashAccountHistory(context)
  await popup.getByRole('button', { name: 'Add Account', exact: true }).click()
  await selectNewZcashAccountHistory(popup)
  await expect(popup.getByText('Account 2', { exact: true })).toBeVisible({ timeout: 60_000 })
  await removeZcashHistoryMock()
  await popup.reload()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByRole('button', { name: /Portfolio network filter/ })).toHaveCount(0)
  await expect(popup.getByRole('status', { name: 'Loading portfolio' })).toHaveCount(0, {
    timeout: 30_000
  })

  await expect(popup.getByRole('button', { name: 'View ZEC details on Zcash' })).toContainText(
    '0 ZEC'
  )
  await expect(popup.getByRole('button', { name: 'View SOL details on Solana' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'View NEAR details on NEAR' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'View BTC details on Bitcoin' })).toHaveCount(1)
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toContainText(
    '2 ETH',
    { timeout: 30_000 }
  )

  const assetsTab = popup.getByRole('tab', { name: 'Assets' })
  const activityTab = popup.getByRole('tab', { name: 'Activity' })
  await activityTab.click()
  const activityLoading = popup.getByRole('status', { name: 'Loading activity' })
  if (await activityLoading.isVisible()) {
    await captureScreenshot(popup, 'release-default-activity-loading-skeleton.png')
  }
  await expect(popup.getByText('Unable to load activity', { exact: true })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  await expect(popup.getByText('+0.005872 ETH', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByText('+1e-18 ETH', { exact: true })).toBeVisible()
  await expect(popup.getByRole('status', { name: 'Loading activity' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
  const activityFilter = popup.getByRole('button', {
    name: 'Filter activity by network: All Networks'
  })
  await expect(activityFilter).toBeVisible()
  const activityFilterPosition = await activityFilter.boundingBox()
  if (!activityFilterPosition) throw new Error('Activity network filter has no layout box')
  await activityFilter.click()
  await popup.getByRole('menuitemradio', { name: 'Ethereum', exact: true }).click()
  await expect(popup.getByRole('link', { name: 'Full history' })).toHaveAttribute(
    'href',
    /^https:\/\/etherscan\.io\/address\/0x[0-9a-fA-F]{40}$/
  )
  await expect.poll(() => evmHistoryRequests.length).toBe(4)
  expect(new Set(evmHistoryRequests.map(request => JSON.stringify(request))).size).toBe(4)
  expect(new Set(evmHistoryRequests.map(request => request.address)).size).toBe(2)
  expect(evmHistoryRequests.every(request => request.blockchains.length === 9)).toBe(true)
  await expect
    .poll(() =>
      popup.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open('noir-wallet-evm-history-cache', 2)
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const database = request.result
              const transaction = database.transaction('records', 'readonly')
              const count = transaction.objectStore('records').count()
              count.onerror = () => reject(count.error)
              count.onsuccess = () => resolve(count.result)
              transaction.oncomplete = () => database.close()
            }
          })
      )
    )
    .toBe(18)
  const firstHistoryRequestCount = evmHistoryRequests.length
  const firstPortfolioRpcRequestCount = portfolioRpcRequests.length
  const firstBitcoinAttestationCount = bitcoinRequests.filter(request =>
    request.endsWith('/block-height/0')
  ).length
  await assetsTab.click()
  await expect(assetsTab).toHaveAttribute('data-state', 'active')
  const portfolioFilterForAlignment = popup.getByRole('button', {
    name: 'Filter portfolio by network: Ethereum'
  })
  await expect(portfolioFilterForAlignment).toBeVisible()
  const portfolioFilterPosition = await portfolioFilterForAlignment.boundingBox()
  if (!portfolioFilterPosition) throw new Error('Portfolio network filter has no layout box')
  expect(Math.abs(portfolioFilterPosition.x - activityFilterPosition.x)).toBeLessThan(0.5)
  expect(Math.abs(portfolioFilterPosition.y - activityFilterPosition.y)).toBeLessThan(0.5)
  await portfolioFilterForAlignment.click()
  await popup.getByRole('menuitemradio', { name: 'All Networks', exact: true }).click()
  await activityTab.click()
  await expect(
    popup.getByRole('button', { name: 'Filter activity by network: All Networks' })
  ).toBeVisible()
  await expect(popup.getByRole('status', { name: 'Loading activity' })).toHaveCount(0)
  await expect(popup.getByText('+0.005872 ETH', { exact: true })).toBeVisible()
  await popup.waitForTimeout(500)
  expect(evmHistoryRequests).toHaveLength(firstHistoryRequestCount)
  expect(portfolioRpcRequests).toHaveLength(firstPortfolioRpcRequestCount)
  expect(bitcoinRequests.filter(request => request.endsWith('/block-height/0'))).toHaveLength(
    firstBitcoinAttestationCount
  )
  await captureScreenshot(popup, 'release-default-activity-session-cache.png')
  await assetsTab.click()
  await expect(assetsTab).toHaveAttribute('data-state', 'active')

  const walletChooser = popup.getByRole('button', { name: 'Choose wallet' })
  await expect(walletChooser).toBeVisible()
  await expect(walletChooser).toHaveText('')
  const accountAddresses = popup.getByRole('button', { name: 'Show account addresses' })
  await expect(accountAddresses).toBeVisible()
  await expect(accountAddresses).toContainText('Account 1')
  await expect(popup.getByRole('button', { name: 'Choose account' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: /Copy .* account address/ })).toHaveCount(0)

  await accountAddresses.click()
  const accountAddressMenu = popup.getByLabel('Account address menu')
  await expect(accountAddressMenu).toBeVisible()
  await expect(accountAddressMenu.getByText('Zcash', { exact: true })).toBeVisible()
  await expect(accountAddressMenu.getByText('EVM', { exact: true })).toBeVisible()
  await expect(accountAddressMenu.getByText('Bitcoin', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'release-default-home-account-address-menu.png')
  await accountAddressMenu.getByRole('button', { name: 'View all' }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await expect(popup.getByRole('region', { name: 'Account network addresses' })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(popup.getByLabel('Search your assets')).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Send ETH on Ethereum' })).toContainText('2 ETH', {
    timeout: 30_000
  })
  await expect(popup.getByRole('status', { name: 'Loading additional networks' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Send BNB on BNB Chain' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Send POL on Polygon' })).toContainText(
    '2,468 POL'
  )
  await expect(popup.getByRole('button', { name: 'Send BTC on Bitcoin' })).toContainText('0 BTC')
  await expect(popup.getByText(/bsc-mainnet|arbitrum-one|base-mainnet/i)).toHaveCount(0)
  await expect(popup.getByText('Available', { exact: true })).toHaveCount(0)
  await expect(popup.getByText(/^≈\$/).first()).toBeVisible()
  const sendNetworkFilter = popup.getByRole('button', { name: 'All Networks', exact: true })
  await expect(sendNetworkFilter).toHaveCSS('cursor', 'pointer')
  await sendNetworkFilter.click()
  const ethereumSendFilter = popup.getByRole('menuitemradio', { name: 'Ethereum', exact: true })
  await expect(ethereumSendFilter.locator('img')).toHaveCount(1)
  await expect(ethereumSendFilter).toHaveCSS('cursor', 'pointer')
  await captureScreenshot(popup, 'release-default-send-network-filter.png')
  await popup.getByRole('menuitemradio', { name: 'All Networks', exact: true }).click()
  const orderedSendAssets = await popup
    .locator('button[aria-label^="Send "]')
    .evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))
  const ethereumEthIndex = orderedSendAssets.indexOf('Send ETH on Ethereum')
  const bnbIndex = orderedSendAssets.indexOf('Send BNB on BNB Chain')
  const polygonIndex = orderedSendAssets.indexOf('Send POL on Polygon')
  const ethereumUsdcIndex = orderedSendAssets.indexOf('Send USDC on Ethereum')
  expect(ethereumEthIndex).toBeGreaterThanOrEqual(0)
  expect(bnbIndex).toBeGreaterThan(ethereumEthIndex)
  expect(polygonIndex).toBeGreaterThan(bnbIndex)
  expect(ethereumUsdcIndex).toBeGreaterThan(polygonIndex)
  await captureScreenshot(popup, 'release-default-send-assets.png')
  await popup.getByRole('button', { name: 'Send NEAR on NEAR' }).click()
  await expect(popup.getByPlaceholder('alice.near or implicit account')).toBeVisible()
  await expect(popup.getByText(/Beta transfer/)).toHaveCount(0)
  await expect(popup.getByText(/NEAR Testnet/)).toHaveCount(0)
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('button', { name: 'Send NEAR on NEAR' })).toBeVisible()
  await popup.getByRole('button', { name: 'Send ETH on Ethereum' }).click()
  await expect(popup.getByLabel('Send To')).toBeFocused()
  await expect(popup.getByRole('button', { name: 'Change asset' })).toHaveCount(0)
  await expect
    .poll(() =>
      popup
        .locator('#evm-send-recipient, input[aria-label="ETH amount"]')
        .evaluateAll(elements =>
          elements.map(element => element.id || element.getAttribute('aria-label'))
        )
    )
    .toEqual(['evm-send-recipient', 'ETH amount'])
  await captureScreenshot(popup, 'release-default-evm-send-form.png')
  await popup.getByRole('button', { name: 'Select Recipient' }).click()
  const recipientDialog = popup.getByRole('dialog')
  await expect(recipientDialog.getByRole('heading', { name: 'Select Recipient' })).toBeVisible()
  await expect(recipientDialog.getByRole('tab', { name: 'My Accounts' })).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(
    recipientDialog.getByRole('button', { name: 'Send to Account 2 Public' })
  ).toBeVisible()
  await captureScreenshot(popup, 'release-default-recipient-my-accounts.png')
  await recipientDialog.getByRole('tab', { name: 'Address Book' }).click()
  await expect(recipientDialog.getByText('No saved recipients', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'release-default-recipient-selector.png')
  await recipientDialog.getByRole('button', { name: 'Close' }).click()
  await popup.getByRole('button', { name: 'Back' }).click()
  await popup.getByRole('button', { name: 'Send ZEC on Zcash' }).click()
  await expect(popup.getByLabel('Send To')).toBeFocused()
  await expect
    .poll(() =>
      popup
        .locator('#zcash-send-recipient, input[aria-label="ZEC amount"]')
        .evaluateAll(elements =>
          elements.map(element => element.id || element.getAttribute('aria-label'))
        )
    )
    .toEqual(['zcash-send-recipient', 'ZEC amount'])
  await expect(popup.getByTestId('zcash-amount-card')).toHaveCSS('min-height', '92px')
  await expect(popup.getByText('Memo (optional)', { exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
  await captureScreenshot(popup, 'release-default-zcash-send-form.png')
  await popup.getByRole('button', { name: 'Select Recipient' }).click()
  const zcashRecipientDialog = popup.getByRole('dialog')
  await expect(
    zcashRecipientDialog.getByRole('button', { name: 'Send to Account 1 Transparent' })
  ).toBeVisible()
  await expect(
    zcashRecipientDialog.getByRole('button', { name: 'Send to Account 2 Shielded' })
  ).toBeVisible()
  await expect(
    zcashRecipientDialog.getByRole('button', { name: 'Send to Account 2 Transparent' })
  ).toBeVisible()
  await captureScreenshot(popup, 'release-default-zcash-recipient-my-accounts.png')
  await zcashRecipientDialog.getByRole('button', { name: 'Close' }).click()
  await popup.getByRole('button', { name: 'Back' }).click()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()

  await popup.getByRole('button', { name: 'Receive', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await expect(popup.getByLabel('Search Networks')).toBeVisible()
  const receiveAddresses = popup.getByRole('region', { name: 'Account network addresses' })
  await expect(receiveAddresses.getByRole('heading', { name: 'Zcash' })).toBeVisible()
  await expect(receiveAddresses.getByRole('heading', { name: 'Bitcoin' })).toBeVisible()
  await expect(receiveAddresses.getByRole('heading', { name: 'Ethereum' })).toBeVisible()
  await expect(receiveAddresses.getByText('Native SegWit', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'release-default-receive-addresses.png')
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()

  await popup.getByRole('button', { name: 'Hide balances' }).click()
  await expect(popup.getByRole('button', { name: 'Show balances' })).toBeVisible()
  await expect(popup.getByLabel('Total balance hidden')).toHaveText('••••')
  await expect
    .poll(() =>
      popup.evaluate(async () => {
        const raw = (await chrome.storage.local.get('wallet_settings')).wallet_settings
        const state = typeof raw === 'string' ? JSON.parse(raw).state : raw?.state
        return state?.balancesHidden
      })
    )
    .toBe(true)
  await popup.getByRole('button', { name: 'Show balances' }).click()
  await expect(popup.getByRole('button', { name: 'Hide balances' })).toBeVisible()

  const homeScroll = popup.getByTestId('home-scroll-container')
  await expect(homeScroll).toBeVisible()
  expect(
    await homeScroll.evaluate(
      element =>
        [...element.querySelectorAll('*')].filter(child => {
          const overflowY = getComputedStyle(child).overflowY
          return overflowY === 'auto' || overflowY === 'scroll'
        }).length
    )
  ).toBe(0)
  await expect(popup.getByRole('button', { name: 'Show token view' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  const portfolioNetworkFilter = popup.getByRole('button', {
    name: 'Filter portfolio by network: All Networks'
  })
  await expect(portfolioNetworkFilter).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Refresh portfolio' })).toBeVisible()
  await expect(popup.getByText('Updating', { exact: true })).toHaveCount(0)
  const portfolio = popup.getByRole('region', { name: 'Portfolio' })
  await expect(portfolio.getByText(/^\d+ Addresses?$/)).toHaveCount(0)
  const lowValueAssets = popup.getByRole('button', { name: 'Expand low value assets' })
  await expect(lowValueAssets).toBeVisible()
  await lowValueAssets.click()
  const bitcoinAsset = popup.getByRole('button', { name: 'View BTC details on Bitcoin' })
  await expect(bitcoinAsset).not.toContainText('Bitcoin')
  await expect(bitcoinAsset.getByText('$63,014', { exact: true })).toBeVisible()
  await expect(bitcoinAsset).toContainText('+1.25%')
  await popup.getByRole('button', { name: 'Collapse low value assets' }).click()
  const ethereumAsset = popup.getByRole('button', { name: 'View ETH details on Ethereum' })
  await expect(ethereumAsset).toContainText('ETH')
  await expect(ethereumAsset).not.toContainText('Ethereum')
  await expect(ethereumAsset).toContainText('$3,200')
  await expect(ethereumAsset).toContainText('+0.42%')
  await expect(ethereumAsset).not.toContainText(/\d+ Networks?/)
  const assetRows = portfolio.locator('button[aria-label^="View "][aria-label*=" details on "]')
  await expect(assetRows.first()).toHaveAttribute('aria-label', 'View ETH details on Ethereum')
  await expect(assetRows.nth(1)).toHaveAttribute('aria-label', 'View ETH details on Arbitrum')
  await expect(popup.getByRole('button', { name: /^Network unavailable\./ })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: /^Balances incomplete\./ })).toHaveCount(0)
  await expectVisibleImagesLoaded(popup)
  await captureScreenshot(popup, 'release-default-home-figma-aligned.png')

  const syncWorker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  await syncWorker.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'SYNC_PROGRESS',
      isSyncing: true,
      syncProgress: 42,
      currentHeight: 2_900_042,
      latestHeight: 3_000_000,
      etaMs: 120_000
    })
  })
  const zcashSyncProgress = popup.getByRole('status', { name: 'Zcash sync progress: 42%' })
  await expect(zcashSyncProgress).toBeVisible()
  const syncProgressBox = await zcashSyncProgress.boundingBox()
  const tokenViewBox = await popup.getByRole('button', { name: 'Show token view' }).boundingBox()
  if (!syncProgressBox || !tokenViewBox) {
    throw new Error('Portfolio sync progress or token view control is not measurable')
  }
  expect(syncProgressBox.x + syncProgressBox.width).toBeLessThan(tokenViewBox.x)
  await captureScreenshot(popup, 'release-default-home-zcash-sync-progress.png')
  await syncWorker.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'SYNC_PROGRESS', isSyncing: false })
  })
  await expect(zcashSyncProgress).toHaveCount(0)

  const ethereumRpcUrl = new URL(EVM_NETWORK_CONFIGS.mainnet[0].rpcUrl).href
  const abortEthereumRpc = (route: Route) => route.abort()
  await context.route(ethereumRpcUrl, abortEthereumRpc)
  await popup.reload()
  await popup.getByRole('button', { name: 'Refresh portfolio' }).click()
  const portfolioSyncing = popup.getByRole('status', { name: 'Portfolio data is syncing' })
  await expect(portfolioSyncing).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByRole('button', { name: /retry/i })).toHaveCount(0)
  await context.unroute(ethereumRpcUrl, abortEthereumRpc)
  await expect(portfolioSyncing).toHaveCount(0, { timeout: 30_000 })

  await popup.evaluate(() =>
    chrome.storage.local.remove(['asset_price_cache_v1', 'asset_market_change_cache_v1'])
  )
  await popup.reload()
  await expect(portfolioSyncing).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByRole('button', { name: /retry/i })).toHaveCount(0)
  await captureScreenshot(popup, 'release-default-price-auto-sync.png')
  await seedFreshAssetPrices(popup)
  await expect(portfolioSyncing).toHaveCount(0, { timeout: 30_000 })

  await portfolioNetworkFilter.click()
  await popup.getByRole('menuitemradio', { name: 'Ethereum', exact: true }).click()
  await expect(
    popup.getByRole('button', { name: 'Filter portfolio by network: Ethereum' })
  ).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View BNB details on BNB Chain' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'View BTC details on Bitcoin' })).toHaveCount(0)
  await popup.reload()
  await expect(
    popup.getByRole('button', { name: 'Filter portfolio by network: Ethereum' })
  ).toBeVisible({ timeout: 30_000 })
  await popup.getByRole('button', { name: 'Filter portfolio by network: Ethereum' }).click()
  await popup.getByRole('menuitemradio', { name: 'All Networks', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Expand low value assets' })).toBeVisible()

  const bitcoinAddressRequests = () =>
    bitcoinRequests.filter(request => /\/api\/address\/[^/]+$/.test(request)).length
  await expect.poll(bitcoinAddressRequests, { timeout: 60_000 }).toBe(1)
  expect(bitcoinRequests).toContain('https://mempool.space/api/block-height/0')
  expect(
    bitcoinRequests.filter(request => request.startsWith('https://blockstream.info/'))
  ).toEqual([])
  const completedDiscoveryRequestCount = bitcoinRequests.length
  await popup.reload()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  await popup.waitForTimeout(1_500)
  expect(bitcoinRequests).toHaveLength(completedDiscoveryRequestCount)

  const ethereumEthDetail = popup.getByRole('button', {
    name: 'View ETH details on Ethereum'
  })
  await expect(ethereumEthDetail).toBeVisible()
  await expect(ethereumEthDetail.getByText('$6,400', { exact: true })).toHaveCount(1)
  await captureScreenshot(popup, 'release-default-home-token-networks.png')
  await ethereumEthDetail.click()
  await expect(popup.getByRole('heading', { name: 'ETH', exact: true })).toBeVisible()
  await expect(
    popup.getByTestId('asset-detail-token-icon').getByRole('img', { name: 'Ethereum' })
  ).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Swap', exact: true })).toBeVisible()
  await expect(popup.getByText('Ethereum · Mainnet', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Asset type', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Decimals', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Network', { exact: true })).toHaveCount(0)
  const priceChart = popup.getByRole('img', { name: '1D price history' })
  await expect(priceChart).toBeVisible()
  const priceChartLine = priceChart.locator('path[fill="none"]')
  await expect(priceChartLine).toHaveCount(1)
  expect(await priceChartLine.evaluate(element => getComputedStyle(element).strokeDasharray)).toBe(
    'none'
  )
  await popup.getByRole('button', { name: '1W', exact: true }).click()
  await expect(popup.getByRole('img', { name: '1W price history' })).toBeVisible()
  expect(
    marketHistoryRequests.some(url => new URL(url).searchParams.get('aggregate') === '4')
  ).toBe(true)
  await expect(popup.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View all' })).toBeVisible()
  for (const amount of ['+0.005872 ETH', '+1e-18 ETH']) {
    const amountLabel = popup.getByText(amount, { exact: true })
    await expect(amountLabel).toBeVisible()
    expect(
      await amountLabel.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth
      })
    ).toBe(true)
  }
  await captureScreenshot(popup, 'release-default-asset-detail.png')
  await popup.getByRole('button', { name: 'Transfer ETH between Public and Confidential' }).click()
  const transferDialog = popup.getByRole('dialog', { name: 'Transfer ETH' })
  await expect(transferDialog).toBeVisible()
  await expect(transferDialog.getByText('Public', { exact: true })).toBeVisible()
  await expect(transferDialog.getByText('Confidential', { exact: true }).first()).toBeVisible()
  await expect(transferDialog.getByRole('button', { name: 'Review transfer' })).toBeDisabled()
  await transferDialog.getByLabel('Transfer amount').fill('0.1')
  await expect(transferDialog.getByRole('button', { name: 'Review transfer' })).toBeEnabled()
  await captureScreenshot(popup, 'THU-DEMO-03-Main-to-Private-transfer-sheet.png')
  await transferDialog.getByRole('button', { name: 'Switch transfer direction' }).click()
  await expect(transferDialog.getByRole('button', { name: 'Review transfer' })).toBeDisabled()
  await transferDialog.getByLabel('Transfer amount').fill('0.1')
  await expect(transferDialog.getByRole('button', { name: 'Review transfer' })).toBeEnabled()
  await captureScreenshot(popup, 'THU-DEMO-04-Private-to-Main-transfer-sheet.png')
  await transferDialog.getByRole('button', { name: 'Close' }).click()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()
  await popup.getByRole('button', { name: 'Expand low value assets' }).click()
  await popup.getByRole('button', { name: 'View USDC details on Ethereum' }).click()
  await expect(popup.getByRole('heading', { name: 'USDC', exact: true })).toBeVisible()
  await expect(
    popup.getByTestId('asset-detail-token-icon').getByRole('img', { name: 'Ethereum' })
  ).toBeVisible()
  await expect(popup.getByText('Ethereum', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Ethereum · Mainnet', { exact: true })).toHaveCount(0)
  await expect(popup.getByText('Contract address', { exact: true })).toBeVisible()
  await expect(popup.getByRole('img', { name: '1D price history' })).toBeVisible()
  await expect(popup.getByRole('heading', { name: 'Recent activity' })).toBeVisible()
  await captureScreenshot(popup, 'release-default-token-asset-detail.png')
  await popup.getByRole('heading', { name: 'Details' }).scrollIntoViewIfNeeded()
  await expect(popup.getByText('Contract address', { exact: true })).toBeInViewport()
  await captureScreenshot(popup, 'release-default-token-asset-details.png')
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()
  await popup.getByRole('button', { name: 'Expand low value assets' }).click()
  await popup.getByRole('button', { name: 'View BTC details on Bitcoin' }).click()
  await expect(popup.getByRole('heading', { name: 'BTC', exact: true })).toBeVisible()
  await expect(
    popup.getByTestId('asset-detail-token-icon').getByRole('img', { name: 'Bitcoin' })
  ).toBeVisible()
  await expect(popup.getByRole('heading', { name: 'Receive address' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Copy Bitcoin receive address' })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'Receive Bitcoin' })).toBeVisible()
  const bitcoinAccounts = popup.getByRole('region', { name: 'Bitcoin accounts' })
  await expect(bitcoinAccounts).toContainText('Balance and activity use the selected address only.')
  const bitcoinAccountSelector = bitcoinAccounts.getByRole('button', {
    name: /Bitcoin account Native SegWit/
  })
  await expect(bitcoinAccountSelector).toBeVisible()
  await bitcoinAccountSelector.click()
  await expect(popup.getByRole('button', { name: /Nested SegWit BIP-49/ })).toBeVisible()
  await expect(popup.getByRole('button', { name: /Taproot BIP-86/ })).toBeVisible()
  await expect(popup.getByRole('button', { name: /Legacy BIP-44/ })).toBeVisible()
  await popup.getByRole('button', { name: /Taproot BIP-86/ }).click()
  await expect(
    bitcoinAccounts.getByRole('button', { name: /Bitcoin account Taproot/ })
  ).toBeVisible({ timeout: 60_000 })
  await expect.poll(bitcoinAddressRequests, { timeout: 60_000 }).toBe(2)
  await captureScreenshot(popup, 'release-default-bitcoin-asset-detail.png')
  await popup.getByRole('heading', { name: 'Details' }).scrollIntoViewIfNeeded()
  await expect(popup.getByRole('heading', { name: 'Receive address' })).toBeInViewport()
  await expect(popup.getByRole('button', { name: 'Receive Bitcoin' })).toBeInViewport()
  await captureScreenshot(popup, 'release-default-bitcoin-asset-details.png')
  await popup.getByRole('button', { name: 'Receive Bitcoin' }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await expect(
    popup
      .getByRole('region', { name: 'Account network addresses' })
      .getByRole('heading', { name: 'Bitcoin' })
  ).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'BTC', exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Addresses', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await expect(popup.getByRole('region', { name: 'Account network addresses' })).toBeVisible()
  await expect(popup.getByRole('heading', { name: 'Bitcoin' })).toBeVisible()
  const bitcoinAddress = popup.getByRole('region', { name: 'Bitcoin' })
  await expect(bitcoinAddress).toBeVisible()
  await expect(bitcoinAddress.getByText('Native SegWit', { exact: true })).toBeVisible()
  await expect(bitcoinAddress.getByText('Nested SegWit', { exact: true })).toBeVisible()
  await expect(bitcoinAddress.getByText('Legacy', { exact: true })).toBeVisible()
  await expect(bitcoinAddress).toContainText('Taproot')
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'BTC', exact: true })).toBeVisible()

  await popup.getByRole('button', { name: 'Receive', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await expect(popup.getByText('Taproot', { exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'BTC', exact: true })).toBeVisible()

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
  await expect(popup.getByTestId('send-asset-header')).toContainText('Bitcoin · Taproot · BIP-86')
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('button', { name: 'Send BTC on Bitcoin' })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'BTC', exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()

  await popup.getByRole('button', { name: 'Show chain view' }).click()
  await expect(popup.getByRole('button', { name: 'Show chain view' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect
    .poll(() =>
      popup.evaluate(async () => {
        const raw = (await chrome.storage.local.get('wallet_settings')).wallet_settings
        const state = typeof raw === 'string' ? JSON.parse(raw).state : raw?.state
        return state?.portfolioViewMode
      })
    )
    .toBe('chains')
  const chainGroupButtons = portfolio.locator(
    'button[aria-label^="Expand "][aria-label$=" tokens"]'
  )
  const expectedChains = [
    'Ethereum',
    'Arbitrum',
    'Optimism',
    'Base',
    'BNB Chain',
    'Polygon',
    'X Layer',
    'Avalanche',
    'Berachain',
    'Gnosis',
    'Plasma',
    'Monad',
    'Bitcoin',
    'Solana',
    'NEAR',
    'Zcash'
  ]
  const chainLabels = await chainGroupButtons.evaluateAll(buttons =>
    buttons.map(button => button.getAttribute('aria-label')?.replace(/^Expand | tokens$/g, ''))
  )
  expect(chainLabels.slice(0, 4)).toEqual(['Ethereum', 'Arbitrum', 'Optimism', 'Base'])
  expect(chainLabels).toHaveLength(expectedChains.length)
  expect(chainLabels).toEqual(expect.arrayContaining(expectedChains))
  await popup.getByRole('button', { name: 'Expand Ethereum tokens' }).click()
  const ethereumBalances = popup.getByRole('region', { name: 'Ethereum token balances' })
  await expect(ethereumBalances).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View ETH details on Ethereum' })).toBeVisible()
  await ethereumBalances.getByRole('button', { name: /Low value/ }).click()
  await expect(popup.getByRole('button', { name: 'View USDC details on Ethereum' })).toBeVisible()
  await captureScreenshot(popup, 'release-default-home-chain-tokens.png')
  const scrollMetrics = await homeScroll.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }))
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
  await homeScroll.hover()
  await popup.mouse.wheel(0, 600)
  await expect.poll(() => homeScroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await homeScroll.evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  await expect
    .poll(() =>
      homeScroll.evaluate(
        element => element.scrollHeight - element.clientHeight - element.scrollTop
      )
    )
    .toBe(0)
  await popup.getByRole('button', { name: 'Show token view' }).click()
  await homeScroll.evaluate(element => {
    element.scrollTop = 0
  })

  await popup.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await expect(popup.getByRole('button', { name: 'Preferred Explorer', exact: true })).toHaveCount(
    0
  )
  await expect(popup.getByRole('button', { name: 'RPC Endpoint', exact: true })).toHaveCount(0)
  await popup.getByRole('button', { name: 'Networks', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Networks' })).toBeVisible()
  for (const network of ['Zcash', 'Bitcoin', ...BUILTIN_EVM_NETWORKS, 'Solana', 'NEAR']) {
    await expect(popup.getByRole('button', { name: `Configure ${network} network` })).toBeVisible()
  }
  await expect(popup.getByText('Local EVM', { exact: true })).toHaveCount(0)
  await expect(popup.locator('button[aria-label^="Configure "][aria-pressed]')).toHaveCount(0)
  await expectPopupWidth(popup)
  await expectVisibleImagesLoaded(popup)
  await captureScreenshot(popup, 'release-default-networks.png')

  await popup.getByRole('button', { name: 'Configure Zcash network' }).click()
  await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
  const zcashRpcDialog = popup.getByRole('dialog')
  await expect(zcashRpcDialog.getByRole('heading', { name: 'Zcash RPC' })).toBeVisible()
  await expect(
    zcashRpcDialog.getByRole('button', { name: 'Use automatic Zcash RPC' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(zcashRpcDialog.getByRole('button', { name: 'Use DeltaRPC RPC' })).toBeVisible()
  await expect(
    zcashRpcDialog.getByRole('button', { name: /^Use (?!automatic).* RPC$/ })
  ).toHaveCount(1)
  await captureScreenshot(popup, 'release-default-zcash-rpc-selector.png')
  await popup.keyboard.press('Escape')
  await expect(zcashRpcDialog).toHaveCount(0)
  await popup.getByRole('button', { name: 'Back' }).click()

  await popup.getByRole('button', { name: 'Configure Ethereum network' }).click()
  await expect(popup.getByRole('button', { name: 'RPC Endpoint', exact: true })).toContainText(
    new URL(EVM_NETWORK_CONFIGS.mainnet[0].rpcUrl).host
  )
  await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
  const ethereumRpcDialog = popup.getByRole('dialog')
  await expect(
    ethereumRpcDialog.getByRole('button', { name: 'Use automatic RPC' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(ethereumRpcDialog.getByRole('button', { name: 'Use DeltaRPC RPC' })).toBeVisible()
  await expect(ethereumRpcDialog.getByText('eth.deltarpc.com', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'release-default-ethereum-rpc-presets.png')
  await popup.keyboard.press('Escape')
  await expect(ethereumRpcDialog).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'Block Explorer', exact: true })).toContainText(
    'etherscan.io'
  )
  await popup.getByRole('button', { name: 'Block Explorer', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Ethereum Explorer' })).toBeVisible()
  await expectPopupWidth(popup)
  await captureScreenshot(popup, 'release-default-ethereum-explorers.png')
  await popup.keyboard.press('Escape')
  await popup.getByRole('button', { name: 'Back' }).click()

  for (const network of [
    { name: 'Solana', provider: 'Delta' },
    { name: 'NEAR', provider: 'Fastnear' }
  ]) {
    await popup.getByRole('button', { name: `Configure ${network.name} network` }).click()
    await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
    const networkRpcDialog = popup.getByRole('dialog')
    await expect(
      networkRpcDialog.getByRole('button', { name: /^Use (?!automatic).* RPC$/ })
    ).toHaveCount(1)
    await networkRpcDialog.getByRole('button', { name: `Use ${network.provider} RPC` }).click()
    await expect(networkRpcDialog).toHaveCount(0)
    await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
    await expect(
      networkRpcDialog.getByRole('button', { name: `Use ${network.provider} RPC` })
    ).toHaveAttribute('aria-pressed', 'true')
    await popup.keyboard.press('Escape')
    await popup.getByRole('button', { name: 'Back' }).click()
  }

  await popup.getByRole('button', { name: 'Configure Bitcoin network' }).click()
  await popup.getByRole('button', { name: 'RPC Endpoint', exact: true }).click()
  const rpcDialog = popup.getByRole('dialog')
  await expect(rpcDialog.getByLabel('Bitcoin RPC URL')).toHaveCount(0)
  await rpcDialog.getByRole('button', { name: 'Use automatic RPC' }).click()
  await expect(rpcDialog).toHaveCount(0)
  await expect(popup.getByText('Auto RPC Enabled', { exact: true })).toBeVisible()
  await popup.getByRole('button', { name: 'Back' }).click()

  const addedAccount = await popup.evaluate(async () => {
    const stored = (await chrome.storage.local.get('wallet_state')).wallet_state
    const walletState = typeof stored === 'string' ? JSON.parse(stored) : stored
    const walletId = walletState?.state?.currentWalletId
    if (typeof walletId !== 'string') throw new Error('Active Wallet fixture is missing')
    return chrome.runtime.sendMessage({ type: 'ADD_ACCOUNT', walletId })
  })
  expect(addedAccount).toMatchObject({ success: true, accountId: expect.any(String) })
  const accountNetworkCoverage = await popup.evaluate(
    () =>
      new Promise<Readonly<{ accountCount: number; accountNetworkCounts: readonly number[] }>>(
        (resolve, reject) => {
          const request = indexedDB.open('noir-wallet-storage-v2-db')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const database = request.result
            const transaction = database.transaction(['metadata', 'accounts', 'chainAccounts'])
            const metadata = transaction.objectStore('metadata').get('active-pointer')
            metadata.onerror = () => reject(metadata.error)
            metadata.onsuccess = () => {
              const generationId = (metadata.result as { generationId?: unknown } | undefined)
                ?.generationId
              if (typeof generationId !== 'string') {
                reject(new Error('Active Storage V2 pointer is missing'))
                return
              }
              const accountRecords = transaction.objectStore('accounts').getAll()
              const chainAccountRecords = transaction.objectStore('chainAccounts').getAll()
              transaction.onerror = () => reject(transaction.error)
              transaction.oncomplete = () => {
                database.close()
                const accounts = (
                  accountRecords.result as Array<{
                    generationId?: unknown
                    entity?: { id?: unknown }
                  }>
                ).filter(record => record.generationId === generationId)
                const chainAccounts = (
                  chainAccountRecords.result as Array<{
                    generationId?: unknown
                    entity?: { scope?: { accountId?: unknown; chainId?: unknown } }
                  }>
                ).filter(record => record.generationId === generationId)
                resolve({
                  accountCount: accounts.length,
                  accountNetworkCounts: accounts.map(account => {
                    const accountId = account.entity?.id
                    return new Set(
                      chainAccounts
                        .filter(record => record.entity?.scope?.accountId === accountId)
                        .map(record => record.entity?.scope?.chainId)
                    ).size
                  })
                })
              }
            }
          }
        }
      )
  )
  expect(accountNetworkCoverage).toEqual({
    accountCount: 3,
    accountNetworkCounts: [23, 23, 23]
  })

  await terminateExtensionServiceWorker(context, popup)
  await waitForBackgroundWalletInitialization(popup)
  await popup.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'GET_ACTIVITY', action: 'refresh' }, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          if (response?.error) {
            reject(new Error(response.error))
            return
          }
          resolve()
        })
      })
  )
  expect(evmHistoryRequests).toHaveLength(firstHistoryRequestCount)
})

test('resyncs only active Wallet Zcash data and preserves EVM and Bitcoin state', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const addedAccount = await popup.evaluate(async () => {
    const stored = (await chrome.storage.local.get('wallet_state')).wallet_state
    const walletState = typeof stored === 'string' ? JSON.parse(stored) : stored
    const walletId = walletState?.state?.currentWalletId
    if (typeof walletId !== 'string') throw new Error('Active Wallet fixture is missing')
    return chrome.runtime.sendMessage({ type: 'ADD_ACCOUNT', walletId })
  })
  expect(addedAccount).toMatchObject({ success: true, accountId: expect.any(String) })

  await popup.goto(
    `chrome-extension://${extensionId}/tests/e2e/transaction-repository-integration.html`
  )
  await expect
    .poll(() => popup.evaluate(() => Boolean(window.transactionRepositoryIntegration)))
    .toBe(true)
  const beforeZcashResync = await popup.evaluate(() =>
    window.transactionRepositoryIntegration!.initializeResyncIsolationProbe()
  )
  expect(beforeZcashResync.portfolio).toHaveLength(2)
  expect(beforeZcashResync.activity).toHaveLength(2)

  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  await popup.getByRole('button', { name: 'Show account addresses' }).click()
  await popup.getByLabel('Account address menu').getByRole('button', { name: 'View all' }).click()
  await expect(popup.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  await popup.getByRole('button', { name: 'Open Zcash settings' }).click()
  await expect(popup.getByRole('heading', { name: 'Zcash settings' })).toBeVisible()
  const resyncZcashButton = popup.getByRole('button', { name: 'Resync Zcash' })
  await resyncZcashButton.scrollIntoViewIfNeeded()
  await resyncZcashButton.click()
  const resyncDialog = popup.getByRole('dialog')
  await expect(resyncDialog.getByRole('heading', { name: 'Resync Zcash' })).toBeVisible()
  await expect(resyncDialog.locator('input[type="number"]')).not.toHaveValue('')
  await resyncDialog.getByRole('button', { name: 'Resync', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 60_000 })

  await popup.goto(
    `chrome-extension://${extensionId}/tests/e2e/transaction-repository-integration.html`
  )
  await expect
    .poll(() => popup.evaluate(() => Boolean(window.transactionRepositoryIntegration)))
    .toBe(true)
  const afterZcashResync = await popup.evaluate(() =>
    window.transactionRepositoryIntegration!.inspectResyncIsolationProbe()
  )
  expect(afterZcashResync).toEqual(beforeZcashResync)

  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  const switchAfterResync = await popup.evaluate(async addedAccountId => {
    const stored = (await chrome.storage.local.get('wallet_state')).wallet_state
    const walletState = typeof stored === 'string' ? JSON.parse(stored) : stored
    const walletId = walletState?.state?.currentWalletId
    const originalAccountId = walletState?.state?.currentAccountId
    if (typeof walletId !== 'string' || typeof originalAccountId !== 'string') {
      throw new Error('Active Wallet fixture is missing after Zcash resync')
    }
    const switched = await chrome.runtime.sendMessage({
      type: 'SWITCH_ACCOUNT',
      walletId,
      accountId: addedAccountId
    })
    const restored = await chrome.runtime.sendMessage({
      type: 'SWITCH_ACCOUNT',
      walletId,
      accountId: originalAccountId
    })
    return { switched, restored }
  }, addedAccount.accountId)
  expect(switchAfterResync).toMatchObject({
    switched: { success: true },
    restored: { success: true }
  })
})

test('shows Shield on positive transparent ZEC and uses the readable modal backdrop', async ({
  context,
  popup,
  extensionId
}) => {
  test.setTimeout(120_000)
  await mockUnknownZcashAccountHistory(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  await seedSettledZcashBalance(popup, {
    total: '0.512',
    transparent: '0.002',
    shielded: '0.51',
    spendable: '0.5',
    available: '0.5',
    shieldable: '0.002',
    pending: { total: '0.01', transparent: '0', shielded: '0.01' }
  })

  await terminateExtensionServiceWorker(context, popup)
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  const zecRow = popup.getByRole('button', { name: 'View ZEC details on Zcash' })
  await expect(zecRow).toBeVisible({ timeout: 30_000 })
  await expect(zecRow.locator('..')).toContainText('0.01 ZEC pending')
  await captureScreenshot(popup, 'REF-13197-noirv2-pending-balance.png')
  await zecRow.click()
  const zcashBalanceBreakdown = popup.getByLabel('Zcash balance breakdown')
  await expect(zcashBalanceBreakdown).toBeVisible()
  await expect(zcashBalanceBreakdown.getByText('Pending', { exact: true })).toHaveCount(0)
  const shieldButton = popup.getByRole('button', { name: 'Shield transparent ZEC' })
  await expect(shieldButton).toBeVisible()
  await captureScreenshot(popup, 'REF-13213-yellow-unspendable-balance.png')
  await captureScreenshot(popup, 'release-default-zcash-balance-and-shield.png')

  await shieldButton.click()
  await expect(popup.getByRole('dialog', { name: 'Shield Funds' })).toBeVisible()
  await captureScreenshot(popup, 'release-default-shield-modal-backdrop.png')
})

test('labels an outgoing shielded Zcash activity without a stale rotated address', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  const removeZcashHistoryMock = await mockUnknownZcashAccountHistory(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await removeZcashHistoryMock()

  const added = await popup.evaluate(async () => {
    const stored = (await chrome.storage.local.get('wallet_state')).wallet_state
    const walletState = typeof stored === 'string' ? JSON.parse(stored) : stored
    const state = walletState?.state
    const walletId = state?.currentWalletId
    const accountId = state?.currentAccountId
    const wallet = state?.wallets?.find((item: { id?: unknown }) => item.id === walletId)
    const account = wallet?.accounts?.find((item: { id?: unknown }) => item.id === accountId)
    const shieldedAddress = account?.addresses?.shielded
    if (
      typeof walletId !== 'string' ||
      typeof accountId !== 'string' ||
      typeof shieldedAddress !== 'string'
    ) {
      throw new Error('Active Zcash account fixture is missing')
    }
    return chrome.runtime.sendMessage({
      type: 'ADD_TRANSACTION',
      accountKey: `mainnet_${walletId}_${accountId}`,
      transaction: {
        txHash: 'a'.repeat(64),
        status: 'success',
        type: 'send',
        amount: '0.001',
        to: 't1ExampleDestination',
        from: shieldedAddress,
        fromType: 'shielded',
        fee: '0.00015',
        timestamp: Date.now(),
        network: 'mainnet'
      }
    })
  })
  expect(added).toMatchObject({ success: true })

  await popup.getByRole('tab', { name: 'Activity' }).click()
  const activity = popup.getByRole('button', { name: 'View Sent ZEC details on Zcash' })
  await expect(activity).toBeVisible({ timeout: 30_000 })
  await activity.click()
  const detail = popup.locator('[data-activity-detail-id]')
  await expect(detail.getByText('Shielded Pool', { exact: true })).toBeVisible()
  await expect(detail.getByText(/^u1/)).toHaveCount(0)
  await captureScreenshot(popup, 'release-default-zcash-shielded-source-activity.png')
})

test('adds and removes an exact custom Token without symbol or icon spoofing', async ({
  context,
  popup
}) => {
  test.setTimeout(180_000)
  const priceUpdatedAt = new Date().toISOString()
  await context.route('https://1click.chaindefuser.com/v0/tokens', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          assetId: 'nep141:zec.omft.near',
          blockchain: 'zec',
          contractAddress: null,
          decimals: 8,
          price: 40,
          priceUpdatedAt,
          symbol: 'ZEC'
        },
        {
          assetId: ASSET_PRICE_SOURCE_ASSETS.usdc,
          blockchain: 'eth',
          contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6,
          price: 1,
          priceUpdatedAt,
          symbol: 'USDC'
        }
      ])
    })
  )
  await context.route('**/get_multichain_lending_tokens_data**', route =>
    route.fulfill({ contentType: 'application/json', body: '[]' })
  )
  await mockReleasedEvmRpc(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  await popup.getByRole('button', { name: 'Manage Tokens' }).click()
  await expect(popup.getByRole('heading', { name: 'Manage Tokens' })).toBeVisible()
  await expect(popup.getByLabel('Search Tokens')).toBeVisible()
  await expect(
    popup.getByRole('button', { name: 'Manage Tokens network: All Networks' })
  ).toBeVisible()
  await popup.getByRole('button', { name: 'Add Token' }).click()
  const addDialog = popup.getByRole('dialog')
  await captureScreenshot(popup, 'release-default-add-token-sheet.png')
  await addDialog.getByRole('button', { name: 'Token network' }).click()
  await captureScreenshot(popup, 'release-default-add-token-network-menu.png')
  await popup.getByRole('menuitemradio', { name: 'Ethereum' }).click()
  await addDialog.getByLabel('EVM contract address').fill(CUSTOM_TOKEN_CONTRACT)
  await addDialog.getByRole('button', { name: 'Verify Token' }).click()
  await expect(addDialog.getByText('Example Token', { exact: true })).toBeVisible()
  await expect(addDialog.getByText('USDC · 18 decimals', { exact: true })).toBeVisible()
  await addDialog.getByRole('button', { name: 'Add Token' }).click()

  await expect(addDialog).toBeHidden()
  await expect(popup.getByRole('button', { name: 'Remove USDC' })).toBeVisible()
  await expect(popup.getByText('Ethereum · 0x3333...333333', { exact: true })).toBeVisible()
  await popup.getByLabel('Search Tokens').fill('0x333333')
  await expect(popup.getByText('No matching Tokens', { exact: true })).toBeVisible()
  await popup.getByLabel('Search Tokens').fill(CUSTOM_TOKEN_CONTRACT)
  await expect(popup.getByRole('button', { name: 'Remove USDC' })).toBeVisible()
  await popup.getByLabel('Search Tokens').fill('')
  await captureScreenshot(popup, 'release-default-manage-custom-token.png')
  await expect(
    popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_USER_EVM_ASSETS' }))
  ).resolves.toMatchObject({
    result: [
      {
        assetId: `eip155:1/erc20:${CUSTOM_TOKEN_CONTRACT}`,
        metadata: { symbol: 'USDC', decimals: 18 }
      }
    ]
  })
  const customTokenRow = popup.locator('div.rounded-xl').filter({ hasText: '0x3333...333333' })
  await expect(
    customTokenRow.locator('[data-slot="token-icon"]').getByRole('img', { name: 'Ethereum' })
  ).toBeVisible()
  await customTokenRow.getByRole('switch', { name: 'Disable USDC on Ethereum' }).click()
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_MANAGED_TOKEN_ASSETS' }))
    )
    .toMatchObject({ result: { hiddenAssetIds: [`eip155:1/erc20:${CUSTOM_TOKEN_CONTRACT}`] } })
  await customTokenRow.getByRole('switch', { name: 'Enable USDC on Ethereum' }).click()
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_MANAGED_TOKEN_ASSETS' }))
    )
    .toMatchObject({ result: { hiddenAssetIds: [] } })

  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  await expect(popup.getByRole('status', { name: 'Loading portfolio' })).toHaveCount(0, {
    timeout: 30_000
  })
  await expect(popup.getByRole('button', { name: /Portfolio network filter/ })).toHaveCount(0)
  await popup.getByRole('button', { name: 'Expand low value assets' }).click()
  const customAsset = popup.locator('article').filter({ hasText: 'Custom' })
  await expect(customAsset).toHaveCount(1)
  await expect(customAsset.getByText('Custom', { exact: true })).toBeVisible()
  await expect(customAsset.locator('img[alt="USDC"]')).toHaveCount(0)
  await captureScreenshot(popup, 'release-default-portfolio-custom-token-isolation.png')

  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  const customSendAsset = popup.getByRole('button', {
    name: 'Send USDC custom Token on Ethereum'
  })
  await expect(customSendAsset).toBeVisible()
  await expect(customSendAsset.getByText('Custom', { exact: true })).toBeVisible()
  await expect(customSendAsset.getByText(/0x3333.*3333/)).toBeVisible()
  await customSendAsset.click()
  await popup.getByLabel('Send To').fill('0x1111111111111111111111111111111111111111')
  await popup.getByLabel('USDC amount').fill('0.5')
  await popup.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Review Send' })).toBeVisible({
    timeout: 30_000
  })
  await expect(
    popup.getByText(
      'This transfer calls a custom Token contract you added. Verify the network, Token, and recipient.',
      { exact: true }
    )
  ).toBeVisible()
  await captureScreenshot(popup, 'release-default-custom-token-send-review.png')
  await popup.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(popup.getByText('Transaction Confirmed', { exact: true })).toBeVisible({
    timeout: 30_000
  })
  await captureScreenshot(popup, 'release-default-custom-token-transaction-final.png')
  await popup.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  await popup.getByRole('button', { name: 'Not now' }).click()

  await popup.getByRole('button', { name: 'Manage Tokens' }).click()
  await popup.getByRole('button', { name: 'Remove USDC' }).click()
  const removeDialog = popup.getByRole('dialog')
  await removeDialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(popup.getByRole('button', { name: 'Remove USDC' })).toHaveCount(0)
  await expect
    .poll(() => popup.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_USER_EVM_ASSETS' })))
    .toEqual({ result: [] })
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const customActivity = popup.getByRole('button', { name: 'View Sent USDC details' })
  await expect(customActivity).toBeVisible({ timeout: 30_000 })
  await customActivity.click()
  const customActivityDetail = popup.locator('[data-activity-detail-id]')
  await expect(customActivityDetail.getByText('−0.5 USDC', { exact: true })).toBeVisible()
  await expect(customActivityDetail.locator('img[alt="USDC"]')).toHaveCount(0)
  await captureScreenshot(popup, 'release-default-custom-token-activity-after-removal.png')
})

test('automatically manages Intents Tokens on newly released chains', async ({
  context,
  popup
}) => {
  test.skip(!solanaEnabled || !nearEnabled, 'Requires explicit Solana and NEAR verification flags')
  test.setTimeout(180_000)
  const unexpectedHistoryProxyRequests: string[] = []
  context.on('request', request => {
    const url = new URL(request.url())
    if (
      EVM_HISTORY_PROXY_ORIGINS.has(url.origin) &&
      /^\/(?:bitcoin|solana|near|evm)(?:\/|$)/.test(url.pathname)
    ) {
      unexpectedHistoryProxyRequests.push(request.url())
    }
  })
  const priceUpdatedAt = new Date().toISOString()
  const solanaUsdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const solanaJupMint = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
  const rnearContract = 'lst.rhealab.near'
  const rnearAssetId = `${NEAR_NETWORKS.mainnet.chainId}/nep141:${rnearContract}`
  const protocolTokens = [
    {
      assetId: `nep141:gnosis-${GNOSIS_USDC_CONTRACT}.omft.near`,
      blockchain: 'gnosis',
      contractAddress: GNOSIS_USDC_CONTRACT,
      decimals: 6,
      icon: '',
      price: 1,
      priceUpdatedAt,
      symbol: 'USDC',
      coingeckoId: 'usd-coin'
    },
    {
      assetId: 'nep141:sol-usdc.omft.near',
      blockchain: 'sol',
      contractAddress: solanaUsdcMint,
      decimals: 6,
      icon: '',
      price: 1,
      priceUpdatedAt,
      symbol: 'USDC',
      coingeckoId: 'usd-coin'
    },
    {
      assetId: 'nep141:sol-jup.omft.near',
      blockchain: 'sol',
      contractAddress: solanaJupMint,
      decimals: 6,
      icon: '',
      price: 1,
      priceUpdatedAt,
      symbol: 'JUP',
      coingeckoId: 'jupiter-exchange-solana'
    },
    {
      assetId: 'nep141:usdt.tether-token.near',
      blockchain: 'near',
      contractAddress: 'usdt.tether-token.near',
      decimals: 6,
      icon: '',
      price: 1,
      priceUpdatedAt,
      symbol: 'USDT',
      coingeckoId: 'tether'
    },
    {
      assetId: 'nep141:jambo-1679.meme-cooking.near',
      blockchain: 'near',
      contractAddress: 'jambo-1679.meme-cooking.near',
      decimals: 18,
      icon: '',
      price: 0.00022792420856958625,
      priceUpdatedAt,
      symbol: 'JAMBO'
    }
  ]
  const priceTokens = [
    ...protocolTokens.map(({ icon: _icon, ...token }) => token),
    {
      assetId: 'nep141:wrap.near',
      blockchain: 'near',
      contractAddress: null,
      decimals: 24,
      price: 4,
      priceUpdatedAt,
      symbol: 'NEAR'
    },
    {
      assetId: 'nep141:zec.omft.near',
      blockchain: 'zec',
      contractAddress: null,
      decimals: 8,
      price: 40,
      priceUpdatedAt,
      symbol: 'ZEC'
    },
    {
      assetId: ASSET_PRICE_SOURCE_ASSETS.usdc,
      blockchain: 'eth',
      contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
      price: 1,
      priceUpdatedAt,
      symbol: 'USDC'
    }
  ]
  await mockExternalAssetIcons(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  const solanaRpcUrl = new URL(SOLANA_NETWORKS.mainnet.rpcUrl).href
  const solanaHistorySignature = '1'.repeat(64)
  const solanaHistoryTokenAccount = '11111111111111111111111111111112'
  let solanaOwner = ''
  let requestedSolanaMints: string[] = []
  const directSolanaHistoryMethods: string[] = []
  let directNearHistoryRequests = 0
  await context.route(
    url => url.href === solanaRpcUrl,
    async route => {
      const request = route.request().postDataJSON() as {
        id?: unknown
        method?: unknown
        params?: [unknown, { encoding?: string; programId?: string }?]
      }
      if (request.method === 'getTokenAccountsByOwner') {
        solanaOwner = String(request.params?.[0] ?? '')
        const legacyTokenProgram = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              context: { slot: 123 },
              value:
                request.params?.[1]?.programId === legacyTokenProgram
                  ? [
                      {
                        pubkey: solanaHistoryTokenAccount,
                        account: {
                          data: {
                            program: 'spl-token',
                            parsed: {
                              type: 'account',
                              info: {
                                isNative: false,
                                mint: solanaUsdcMint,
                                owner: solanaOwner,
                                state: 'initialized',
                                tokenAmount: {
                                  amount: '0',
                                  decimals: 6,
                                  uiAmount: 0,
                                  uiAmountString: '0'
                                }
                              }
                            },
                            space: 165
                          },
                          executable: false,
                          lamports: 2_039_280,
                          owner: legacyTokenProgram,
                          rentEpoch: 0,
                          space: 165
                        }
                      }
                    ]
                  : []
            }
          })
        })
        return
      }
      if (request.method === 'getBalance') {
        solanaOwner = String(request.params?.[0] ?? '')
        await route.fallback()
        return
      }
      if (request.method === 'getSignaturesForAddress') {
        directSolanaHistoryMethods.push(request.method)
        const address = String(request.params?.[0] ?? '')
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result:
              address === solanaHistoryTokenAccount
                ? [
                    {
                      signature: solanaHistorySignature,
                      slot: 124,
                      blockTime: 1_700_000_001,
                      err: null,
                      memo: null,
                      confirmationStatus: 'finalized'
                    }
                  ]
                : []
          })
        })
        return
      }
      if (request.method === 'getTransaction') {
        directSolanaHistoryMethods.push(request.method)
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              slot: 124,
              blockTime: 1_700_000_001,
              version: 0,
              transaction: {
                signatures: [solanaHistorySignature],
                message: {
                  accountKeys: [
                    { pubkey: solanaOwner, signer: true, source: 'transaction', writable: true },
                    {
                      pubkey: solanaHistoryTokenAccount,
                      signer: false,
                      source: 'transaction',
                      writable: true
                    }
                  ],
                  instructions: [],
                  recentBlockhash: '11111111111111111111111111111111'
                }
              },
              meta: {
                err: null,
                fee: 5000,
                preBalances: [1_000_000, 0],
                postBalances: [995_000, 0],
                preTokenBalances: [],
                postTokenBalances: [
                  {
                    accountIndex: 1,
                    mint: solanaUsdcMint,
                    owner: solanaOwner,
                    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    uiTokenAmount: {
                      amount: '2500000',
                      decimals: 6,
                      uiAmount: 2.5,
                      uiAmountString: '2.5'
                    }
                  }
                ]
              }
            }
          })
        })
        return
      }
      if (request.method !== 'getMultipleAccounts') {
        await route.fallback()
        return
      }
      const addresses = Array.isArray(request.params?.[0])
        ? request.params[0].map(value => String(value))
        : []
      const mintLookup = request.params?.[1]?.encoding === 'base64'
      if (mintLookup) requestedSolanaMints = addresses
      const programId = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      const tokenAccount = (mint: string, amount: string) => ({
        data: {
          program: 'spl-token',
          parsed: {
            info: {
              isNative: false,
              mint,
              owner: solanaOwner,
              state: 'initialized',
              tokenAmount: {
                amount,
                decimals: 6,
                uiAmount: Number(amount) / 1_000_000,
                uiAmountString: (Number(amount) / 1_000_000).toString()
              }
            },
            type: 'account'
          },
          space: 165
        },
        executable: false,
        lamports: 2_039_280,
        owner: programId,
        rentEpoch: 0,
        space: 165
      })
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            context: { slot: 123 },
            value: mintLookup
              ? addresses.map(mint => ({
                  data: ['', 'base64'],
                  executable: false,
                  lamports: 1,
                  owner: programId,
                  rentEpoch: 0,
                  space: 82
                }))
              : requestedSolanaMints.map(mint =>
                  tokenAccount(
                    mint,
                    mint === solanaUsdcMint ? '2500000' : mint === solanaJupMint ? '3000000' : '0'
                  )
                )
          }
        })
      })
    }
  )
  await context.route('https://api.fastnear.com/v1/account/**/ft', async route => {
    const accountId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2)!)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        account_id: accountId,
        tokens: [
          {
            contract_id: 'usdt.tether-token.near',
            balance: '4500000',
            last_update_block_height: 123
          },
          {
            contract_id: rnearContract,
            balance: '200000000000000000000000',
            last_update_block_height: 124
          }
        ]
      })
    })
  })
  await context.route('https://transfers.main.fastnear.com/v0/transfers', async route => {
    directNearHistoryRequests += 1
    const request = route.request().postDataJSON() as { direction?: string }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        resume_token: null,
        transfers:
          request.direction === 'receiver'
            ? [
                {
                  amount: '200000000000000000000000',
                  asset_id: `nep141:${rnearContract}`,
                  block_height: '214090596',
                  block_timestamp: '1788429096000000000',
                  other_account_id: 'duducat.near',
                  receipt_id: 'rnear-receipt',
                  transaction_id: 'rnear-transaction',
                  transfer_index: 0
                }
              ]
            : []
      })
    })
  })
  await context.route('https://1click.chaindefuser.com/v0/tokens', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(priceTokens) })
  )
  const rheaTokenListChainIds: Readonly<Record<string, number>> = {
    eth: 1,
    gnosis: 100,
    sol: 501,
    near: 900001,
    zec: 900010
  }
  const rheaTokenRows = priceTokens.map(token => ({
    ...token,
    address: token.assetId,
    chainId: rheaTokenListChainIds[token.blockchain],
    isNative: token.contractAddress === null
  }))
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
  const coinGeckoHistoryRequests: string[] = []
  await context.route(
    url =>
      url.origin === 'https://api.coingecko.com' &&
      url.pathname.startsWith('/api/v3/coins/') &&
      url.pathname.endsWith('/market_chart'),
    route => {
      coinGeckoHistoryRequests.push(route.request().url())
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          prices: [
            [Date.now() - 7_200_000, 0.99],
            [Date.now() - 3_600_000, 1],
            [Date.now(), 1.01]
          ],
          market_caps: [],
          total_volumes: []
        })
      })
    }
  )
  const marketById = {
    'coingecko:usd-coin': { price: 1, percent24h: 0.01 },
    'coingecko:jupiter-exchange-solana': { price: 1, percent24h: -2.5 },
    'coingecko:tether': { price: 1, percent24h: 0.02 }
  }
  await context.route(
    url =>
      url.origin === 'https://coins.llama.fi' &&
      (url.pathname.startsWith('/percentage/') || url.pathname.startsWith('/prices/current/')),
    route => {
      const url = new URL(route.request().url())
      const requestedIds = new Set(decodeURIComponent(url.pathname).split('/').at(-1)?.split(','))
      const percentage = url.pathname.startsWith('/percentage/')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          coins: Object.fromEntries(
            Object.entries(marketById)
              .filter(([marketId]) => requestedIds.has(marketId))
              .map(([marketId, value]) => [
                marketId,
                percentage
                  ? value.percent24h
                  : { price: value.price, timestamp: Math.floor(Date.now() / 1_000) }
              ])
          )
        })
      })
    }
  )
  let releaseProtocolCatalog = () => {}
  const protocolCatalogGate = new Promise<void>(resolve => {
    releaseProtocolCatalog = resolve
  })
  let protocolCatalogRequests = 0
  await context.route('**/get_multichain_lending_tokens_data**', async route => {
    protocolCatalogRequests += 1
    await protocolCatalogGate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(protocolTokens) })
  })

  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  const initialPortfolioRefresh = popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_PORTFOLIO', action: 'refresh' })
  )
  await expect.poll(() => protocolCatalogRequests).toBeGreaterThan(0)
  releaseProtocolCatalog()
  const initialPortfolioResponse = await initialPortfolioRefresh
  expect(initialPortfolioResponse).toHaveProperty('result.model')
  expect(
    (
      initialPortfolioResponse as {
        result: {
          model: {
            chains: Array<{
              chain: { id: string }
              assets: Array<{ asset: { id: string }; balance: { totalRaw: string } }>
            }>
          }
        }
      }
    ).result.model.chains
      .find(chain => chain.chain.id === SOLANA_NETWORKS.mainnet.chainId)
      ?.assets.find(
        asset => asset.asset.id === `${SOLANA_NETWORKS.mainnet.chainId}/token:${solanaUsdcMint}`
      )?.balance.totalRaw
  ).toBe('2500000')
  await popup.getByRole('button', { name: 'Manage Tokens' }).click()
  await expect(popup.getByRole('heading', { name: 'Manage Tokens' })).toBeVisible()
  await expect(popup.getByRole('switch', { name: 'Disable USDC on Solana' })).toBeVisible({
    timeout: 30_000
  })
  await expect(popup.getByRole('switch', { name: 'Disable USDT on NEAR' })).toBeVisible()
  await popup.getByRole('button', { name: 'Manage Tokens network: All Networks' }).click()
  await popup.getByRole('menuitemradio', { name: 'Solana', exact: true }).click()
  await expect(popup.getByRole('switch', { name: 'Disable USDC on Solana' })).toBeVisible()
  await expect(popup.getByRole('switch', { name: 'Disable USDT on NEAR' })).toHaveCount(0)
  await popup.getByRole('button', { name: 'Manage Tokens network: Solana' }).click()
  await popup.getByRole('menuitemradio', { name: 'All Networks', exact: true }).click()
  await expect(popup.getByRole('switch', { name: 'Disable USDT on NEAR' })).toBeVisible()
  const gnosisUsdcSwitch = popup.getByRole('switch', { name: 'Disable USDC on Gnosis' })
  await expect(gnosisUsdcSwitch).toBeVisible()
  await gnosisUsdcSwitch.click()
  const enableGnosisUsdc = popup.getByRole('switch', { name: 'Enable USDC on Gnosis' })
  await expect(enableGnosisUsdc).toBeVisible()
  await enableGnosisUsdc.click()
  await expect(popup.getByRole('switch', { name: 'Disable USDC on Gnosis' })).toBeVisible()
  await expect(popup.getByText('Token Could Not Be Enabled', { exact: true })).toHaveCount(0)
  const jupSwitch = popup.getByRole('switch', { name: 'Disable JUP on Solana' })
  await expect(jupSwitch).toBeVisible()

  const jupAssetId = `${SOLANA_NETWORKS.mainnet.chainId}/token:${solanaJupMint}`
  await expect
    .poll(async () => {
      const response = (await popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_MANAGED_TOKEN_ASSETS' })
      )) as { result?: { hiddenAssetIds?: readonly string[] } }
      return response.result?.hiddenAssetIds?.includes(jupAssetId) ?? true
    })
    .toBe(false)

  await popup.getByRole('button', { name: 'Back' }).click()
  const solanaUsdcRow = popup.getByRole('button', { name: 'View USDC details on Solana' })
  await expect(solanaUsdcRow).toBeVisible({
    timeout: 30_000
  })
  const refreshedAssetPrices = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_ASSET_PRICES', action: 'refresh' })
  )
  expect(refreshedAssetPrices).toHaveProperty('result.quotes')
  await expect
    .poll(async () => {
      const state = (await popup.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_ASSET_PRICES',
          action: 'read'
        })
        return { response }
      })) as {
        response?: {
          result?: {
            quotes?: Array<{
              assetId: string
              marketChange?: { source: string; percent24h: string }
            }>
          }
        }
      }
      const quote = state.response?.result?.quotes?.find(
        candidate =>
          candidate.assetId === `${SOLANA_NETWORKS.mainnet.chainId}/token:${solanaUsdcMint}`
      )
      return quote?.marketChange
    })
    .toEqual(expect.objectContaining({ source: 'defi-llama', percent24h: '0.01' }))
  await expect
    .poll(() =>
      solanaUsdcRow.locator('img[alt="USDC"]').evaluate(image => {
        const icon = image as HTMLImageElement
        return icon.complete && icon.naturalWidth > 0
      })
    )
    .toBe(true)
  await expect(solanaUsdcRow.getByText('$2.5', { exact: true })).toBeVisible()
  await expect(solanaUsdcRow.getByText('+0.01%', { exact: true })).toBeVisible()
  await expect(solanaUsdcRow.getByText('Solana', { exact: true })).toHaveCount(0)
  const solanaJupRow = popup.getByRole('button', { name: 'View JUP details on Solana' })
  await expect(solanaJupRow).toBeVisible()
  await expect(solanaJupRow.getByText('$3', { exact: true })).toBeVisible()
  await expect(solanaJupRow.getByText('-2.5%', { exact: true })).toBeVisible()
  await solanaJupRow.click()
  await expect(popup.getByRole('heading', { name: 'JUP', exact: true })).toBeVisible()
  await expect(popup.getByRole('img', { name: '1D price history' })).toBeVisible()
  expect(
    coinGeckoHistoryRequests.some(request =>
      new URL(request).pathname.endsWith('/coins/jupiter-exchange-solana/market_chart')
    )
  ).toBe(true)
  await popup.getByRole('button', { name: 'Back' }).click()
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible()
  const nearUsdtRow = popup.getByRole('button', { name: 'View USDT details on NEAR' })
  await expect(nearUsdtRow).toBeVisible()
  await expect(nearUsdtRow.getByText('$4.5', { exact: true })).toBeVisible()
  await expect(popup.getByRole('button', { name: 'View rNEAR details on NEAR' })).toBeVisible()
  const portfolioResponse = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_PORTFOLIO', action: 'refresh' })
  )
  expect(portfolioResponse).toHaveProperty('result.model')
  const model = (
    portfolioResponse as {
      result: {
        model: {
          chains: Array<{
            chain: { id: string }
            status: string
            errorCodes: readonly string[]
            assets: Array<{ asset: { id: string }; balance: { totalRaw: string } }>
          }>
        }
      }
    }
  ).result.model
  const solanaChain = model.chains.find(chain => chain.chain.id === SOLANA_NETWORKS.mainnet.chainId)
  const nearChain = model.chains.find(chain => chain.chain.id === NEAR_NETWORKS.mainnet.chainId)
  const solanaUsdcAssetId = `${SOLANA_NETWORKS.mainnet.chainId}/token:${solanaUsdcMint}`
  const nearUsdtAssetId = `${NEAR_NETWORKS.mainnet.chainId}/nep141:usdt.tether-token.near`
  expect({
    found: solanaChain !== undefined,
    status: solanaChain?.status,
    errorCodes: solanaChain?.errorCodes,
    assetBalances: Object.fromEntries(
      solanaChain?.assets.map(asset => [asset.asset.id, asset.balance.totalRaw]) ?? []
    )
  }).toEqual({
    found: true,
    status: 'ready',
    errorCodes: [],
    assetBalances: expect.objectContaining({
      [solanaUsdcAssetId]: '2500000',
      [jupAssetId]: '3000000'
    })
  })
  expect({
    found: nearChain !== undefined,
    status: nearChain?.status,
    errorCodes: nearChain?.errorCodes,
    assetBalances: Object.fromEntries(
      nearChain?.assets.map(asset => [asset.asset.id, asset.balance.totalRaw]) ?? []
    )
  }).toEqual({
    found: true,
    status: 'ready',
    errorCodes: [],
    assetBalances: expect.objectContaining({
      [nearUsdtAssetId]: '4500000',
      [rnearAssetId]: '200000000000000000000000'
    })
  })
  await popup.getByRole('tab', { name: 'Activity' }).click()
  const solanaUsdcActivity = popup.getByRole('button', {
    name: 'View Received USDC details on Solana'
  })
  await expect(solanaUsdcActivity).toBeVisible({ timeout: 30_000 })
  await expect(solanaUsdcActivity.getByText('+2.5 USDC', { exact: true })).toBeVisible()
  await expect(solanaUsdcActivity.locator('img[alt="USDC"]')).toBeVisible()
  const rnearActivity = popup.getByRole('button', { name: 'View Received rNEAR details on NEAR' })
  await expect(rnearActivity).toBeVisible({ timeout: 30_000 })
  await expect(rnearActivity.getByText('+0.2 rNEAR', { exact: true })).toBeVisible()
  expect(directSolanaHistoryMethods).toContain('getSignaturesForAddress')
  expect(directSolanaHistoryMethods).toContain('getTransaction')
  expect(directNearHistoryRequests).toBeGreaterThan(0)
  expect(unexpectedHistoryProxyRequests).toEqual([])
  await rnearActivity.click()
  const rnearActivityDetail = popup.locator('[data-activity-detail-id]')
  await expect(rnearActivityDetail.getByText('+0.2 rNEAR', { exact: true })).toBeVisible()
  await expect(rnearActivityDetail.getByText('Amount unavailable', { exact: true })).toHaveCount(0)
  await captureScreenshot(popup, 'release-default-rnear-activity.png')
  await popup.getByRole('button', { name: 'Close' }).click()

  await popup.getByRole('tab', { name: 'Assets' }).click()
  await popup.getByRole('button', { name: 'Manage Tokens' }).click()
  await popup.getByRole('button', { name: 'Add Token' }).click()
  let addTokenDialog = popup.getByRole('dialog')
  await addTokenDialog.getByRole('button', { name: 'Token network' }).click()
  const solanaTokenNetwork = popup.getByRole('menuitemradio', { name: /^Solana/ })
  await expect(solanaTokenNetwork).toBeVisible()
  await expect(popup.getByRole('menuitemradio', { name: /^NEAR/ })).toBeVisible()
  await solanaTokenNetwork.scrollIntoViewIfNeeded()
  await captureScreenshot(popup, 'REF-13204-near-solana-token-network-menu.png')
  await solanaTokenNetwork.click()
  await addTokenDialog.getByLabel('SPL Token mint address').fill(solanaJupMint)
  await addTokenDialog.getByRole('button', { name: 'Verify Token' }).click()
  await expect(addTokenDialog.getByText('JUP · 6 decimals', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'REF-13204-solana-spl-token-verified.png')
  await addTokenDialog.getByRole('button', { name: 'Add Token' }).click()
  await expect(addTokenDialog).toBeHidden()

  await popup.getByRole('button', { name: 'Add Token' }).click()
  addTokenDialog = popup.getByRole('dialog')
  await addTokenDialog.getByRole('button', { name: 'Token network' }).click()
  await popup.getByRole('menuitemradio', { name: /^NEAR/ }).click()
  await addTokenDialog.getByLabel('NEP-141 contract account').fill('jambo-1679.meme-cooking.near')
  await addTokenDialog.getByRole('button', { name: 'Verify Token' }).click()
  await expect(addTokenDialog.getByText('JAMBO · 18 decimals', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'REF-13204-near-nep141-token-verified.png')
  await addTokenDialog.getByRole('button', { name: 'Add Token' }).click()
  await expect(addTokenDialog).toBeHidden()
  await popup.getByRole('button', { name: 'Back' }).click()

  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('heading', { name: 'Swap' })).toBeVisible()
  await popup.getByRole('button', { name: 'To asset' }).click()
  const assetSelector = popup.getByRole('dialog')
  await expect(assetSelector.getByText('Powered by CoinGecko', { exact: true })).toHaveCount(0)
  const [tokenSearchBox, networkFilterBox] = await Promise.all([
    assetSelector.getByPlaceholder('Search tokens').boundingBox(),
    assetSelector
      .getByRole('button', { name: 'Filter assets by network: All Networks' })
      .boundingBox()
  ])
  if (!tokenSearchBox || !networkFilterBox) {
    throw new Error('Swap asset selector controls do not have layout boxes')
  }
  expect(tokenSearchBox.y).toBeLessThan(networkFilterBox.y)
  await assetSelector
    .getByRole('button', { name: 'Filter assets by network: All Networks' })
    .click()
  await popup.getByRole('menuitemradio', { name: 'Gnosis', exact: true }).click()
  const tokenSearch = assetSelector.getByPlaceholder('Search tokens')
  await tokenSearch.fill('gnosis')
  await expect(assetSelector.getByText('No destination assets are available')).toBeVisible()
  await tokenSearch.fill('USDC')
  await expect(assetSelector.getByRole('button', { name: /^USDC on Gnosis/ })).toBeVisible()
  await assetSelector.getByRole('button', { name: 'Filter assets by network: Gnosis' }).click()
  await popup.getByRole('menuitemradio', { name: 'NEAR', exact: true }).click()
  await tokenSearch.fill('NEAR')
  await assetSelector.getByRole('button', { name: /^NEAR on NEAR/ }).click()
  const nearReceiveAddress = popup
    .getByText('Receive address', { exact: true })
    .locator('..')
    .locator('span[title]')
  await expect(nearReceiveAddress).toHaveAttribute('title', /^[a-f0-9]{64}$/)
  await expect(popup.getByText('Custom address', { exact: true })).toHaveCount(0)

  await popup.getByRole('button', { name: 'Back' }).click()
  await popup.getByRole('button', { name: 'Swap', exact: true }).click()
  await expect(popup.getByRole('status', { name: 'Loading swap assets' })).toHaveCount(0)
  await expect(popup.getByRole('button', { name: 'To asset' })).toContainText('NEAR')

  await popup.getByRole('button', { name: 'From asset' }).click()
  let sourceSelector = popup.getByRole('dialog')
  await sourceSelector
    .getByRole('button', { name: 'Filter assets by network: All Networks' })
    .click()
  await popup.getByRole('menuitemradio', { name: 'Gnosis', exact: true }).click()
  await sourceSelector.getByPlaceholder('Search tokens').fill('USDC')
  await sourceSelector.getByRole('button', { name: /^USDC on Gnosis/ }).click()
  await popup.getByRole('button', { name: 'Choose source account, current main' }).click()
  await popup
    .getByRole('dialog', { name: 'Choose source account' })
    .getByRole('radio', { name: /Confidential account/ })
    .click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current private' })
  ).toBeVisible()

  await popup.getByRole('button', { name: 'From asset' }).click()
  sourceSelector = popup.getByRole('dialog')
  await sourceSelector
    .getByRole('button', { name: 'Filter assets by network: All Networks' })
    .click()
  await popup.getByRole('menuitemradio', { name: 'Solana', exact: true }).click()
  await sourceSelector.getByPlaceholder('Search tokens').fill('USDC')
  await sourceSelector.getByRole('button', { name: /^USDC on Solana/ }).click()
  await expect(
    popup.getByRole('button', { name: 'Choose source account, current private' })
  ).toHaveCount(0)
  const solanaSourceCard = popup.locator('section').filter({
    has: popup.getByRole('button', { name: 'From asset' })
  })
  await expect(solanaSourceCard.getByText('USDC', { exact: true })).toBeVisible()
  await expect(solanaSourceCard.getByRole('button', { name: /Choose source account/ })).toHaveCount(
    0
  )
  await captureScreenshot(popup, 'REF-13212-solana-source-uses-main-account.png')
})

async function openExtensionPopup(context: BrowserContext): Promise<{
  readonly extensionId: string
  readonly popup: Page
}> {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 375, height: 600 })
  await popup.goto(`chrome-extension://${extensionId}/index.html`)
  return { extensionId, popup }
}

test('loads a quiet chain when another chain fills the shared History page', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  const requests = await mockEvmHistoryProxy(context, 0, true)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  const chains = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1', 'eip155:8453']
    })
    if (response.error) throw new Error('Activity refresh failed')
    return response.result.items.flatMap(
      (item: { segments: Array<{ target: { kind: string; chainId?: string } }> }) =>
        item.segments.flatMap(segment =>
          segment.target.kind === 'onchain' ? [segment.target.chainId] : []
        )
    ) as string[]
  })
  expect(chains).toContain('eip155:1')
  expect(chains).toContain('eip155:8453')
  expect(
    requests.some(
      request =>
        request.method === 'ankr_getTransactionsByAddress' &&
        request.blockchains.length === 1 &&
        request.blockchains[0] === 'base'
    )
  ).toBe(true)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  await expect(popup.getByText('+0.001 ETH', { exact: true })).toBeVisible()
  await captureScreenshot(popup, 'history-quiet-chain-after-shared-page.png')
})

test('keeps equal EVM transaction hashes from different chains in Activity', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  await mockEvmHistoryProxy(context, 0, true, true)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const matchingItems = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1', 'eip155:8453']
    })
    if (response.error) throw new Error('Activity refresh failed')
    return response.result.items
      .filter((item: { segments: Array<{ evidence?: { transactionHash?: string } }> }) =>
        item.segments.some(segment => segment.evidence?.transactionHash === '0x' + 'a'.repeat(64))
      )
      .map((item: { id: string; segments: Array<{ target: { chainId?: string } }> }) => ({
        id: item.id,
        chainId: item.segments[0]?.target.chainId
      }))
  })
  expect(matchingItems).toEqual(
    expect.arrayContaining([
      { id: `rpc:evm:eip155:1:0x${'a'.repeat(64)}:native`, chainId: 'eip155:1' },
      { id: `rpc:evm:eip155:8453:0x${'a'.repeat(64)}:native`, chainId: 'eip155:8453' }
    ])
  )
  expect(matchingItems).toHaveLength(2)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  for (const item of matchingItems) {
    await expect(popup.locator(`[data-activity-id="${item.id}"]`)).toBeVisible()
  }
  await captureScreenshot(popup, 'history-equal-evm-hashes-two-chains.png')
})

test('retains a persisted wallet transaction when EVM History returns 503', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  await mockEvmHistoryProxy(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)

  const localId = await popup.evaluate(async () => {
    const activity = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1']
    })
    if (activity.error) throw new Error('Activity refresh failed')
    const scope = activity.result.scope as { keyDomainId: string; accountId: string }
    const transactionId = 'transaction:history-local-fallback'
    const segmentId = 'segment:history-local-fallback'
    const now = Date.now()
    const graph = {
      root: {
        id: transactionId,
        scope,
        kind: 'transfer',
        status: 'broadcast',
        segmentIds: [segmentId],
        createdAt: now,
        updatedAt: now,
        revision: 0,
        intent: {
          schemaVersion: 1,
          direction: 'outgoing',
          primaryAmount: { assetId: 'eip155:1/slip44:60', amountRaw: '2000000000000000' }
        }
      },
      segments: [
        {
          id: segmentId,
          transactionId,
          role: 'origin',
          target: { kind: 'onchain', chainId: 'eip155:1' },
          status: 'broadcast',
          requiredForFinality: true,
          dependsOn: [],
          evidence: { transactionHash: `0x${'e'.repeat(64)}` },
          createdAt: now,
          updatedAt: now,
          revision: 0
        }
      ]
    }
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('noir-wallet-transactions-v2-db', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('graphs', 'readwrite')
        transaction.objectStore('graphs').put({
          schemaVersion: 1,
          transactionId,
          accountKey: JSON.stringify([scope.keyDomainId, scope.accountId]),
          chainIds: ['eip155:1'],
          status: 'broadcast',
          createdAt: now,
          updatedAt: now,
          graph
        })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
    const historyCache = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('noir-wallet-evm-history-cache')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = historyCache.transaction('records', 'readwrite')
        const cursor = transaction.objectStore('records').openCursor()
        cursor.onsuccess = () => {
          if (!cursor.result) return
          const record = cursor.result.value
          if (
            record.chainId === 'eip155:1' &&
            record.scope.keyDomainId === scope.keyDomainId &&
            record.scope.accountId === scope.accountId
          ) {
            cursor.result.update({
              ...record,
              lastAttemptAt: 0,
              successfulSyncAt: 0,
              retryAfter: 0
            })
          }
          cursor.result.continue()
        }
        cursor.onerror = () => reject(cursor.error)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      historyCache.close()
    }
    return transactionId
  })

  let failedHistoryRequests = 0
  await context.route(
    url => EVM_HISTORY_PROXY_ORIGINS.has(url.origin) && url.pathname === '/',
    async route => {
      const request = route.request().postDataJSON() as { method?: unknown }
      if (
        request.method === 'ankr_getTransactionsByAddress' ||
        request.method === 'ankr_getTokenTransfers'
      ) {
        failedHistoryRequests += 1
      }
      await route.fulfill({ status: 503, body: 'History temporarily unavailable' })
    }
  )
  const readLocalItem = (action: 'read' | 'refresh') =>
    popup.evaluate(async action => {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ACTIVITY',
        action,
        executionMode: 'main',
        chainIds: ['eip155:1']
      })
      if (response.error) throw new Error('Activity request failed')
      const item = response.result.items.find(
        (item: { id: string }) => item.id === 'transaction:history-local-fallback'
      ) as { id: string; source: string } | undefined
      return item ? { id: item.id, source: item.source } : null
    }, action)
  expect(await readLocalItem('read')).toEqual({
    id: localId,
    source: 'wallet-v2'
  })
  expect(await readLocalItem('refresh')).toEqual({
    id: localId,
    source: 'wallet-v2'
  })
  expect(failedHistoryRequests).toBeGreaterThan(0)
  await popup.getByRole('tab', { name: 'Activity' }).click()
  await expect(popup.locator(`[data-activity-id="${localId}"]`)).toBeVisible()
  await captureScreenshot(popup, 'history-local-transaction-after-proxy-503.png')
  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()
  await waitForBackgroundWalletInitialization(popup)
  expect(await readLocalItem('read')).toEqual({
    id: localId,
    source: 'wallet-v2'
  })
  await popup.getByRole('tab', { name: 'Activity' }).click()
  await expect(popup.locator(`[data-activity-id="${localId}"]`)).toBeVisible()
})

test('retains current EVM address history during failed refresh and popup reload', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  await mockEvmHistoryProxy(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  await seedFreshAssetPrices(popup)
  const seeded = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1']
    })
    const model = response.result
    if (!model?.items.length) throw new Error('Expected current history to be cached')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('noir-wallet-evm-history-cache')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('records', 'readwrite')
        const cursor = transaction.objectStore('records').openCursor()
        cursor.onsuccess = () => {
          if (!cursor.result) return
          const record = cursor.result.value
          if (
            record.scope.keyDomainId === model.scope.keyDomainId &&
            record.scope.accountId === model.scope.accountId
          ) {
            cursor.result.update({
              ...record,
              lastAttemptAt: 0,
              successfulSyncAt: 0,
              retryAfter: 0
            })
          }
          cursor.result.continue()
        }
        cursor.onerror = () => reject(cursor.error)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
    return model.items.map((item: { id: string }) => item.id) as string[]
  })
  const readIds = () =>
    popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ACTIVITY',
        action: 'read',
        executionMode: 'all'
      })
      if (response.error) throw new Error('Activity read failed')
      return response.result.items.map((item: { id: string }) => item.id) as string[]
    })
  let releaseRefresh: () => void = () => {}
  let failedHistoryRequests = 0
  const refreshGate = new Promise<void>(resolve => {
    releaseRefresh = resolve
  })
  await context.route(
    url => EVM_HISTORY_PROXY_ORIGINS.has(url.origin) && url.pathname === '/',
    async route => {
      await refreshGate
      failedHistoryRequests += 1
      await route.fulfill({ status: 503, body: 'History temporarily unavailable' })
    }
  )
  await popup.getByRole('tab', { name: 'Activity' }).click()
  try {
    await expect(popup.getByText('+0.005872 ETH', { exact: true }).first()).toBeVisible()
    await expect(popup.getByText('No activity yet', { exact: true })).toHaveCount(0)
    await captureScreenshot(popup, 'history-activity-cached-refresh.png')
  } finally {
    releaseRefresh()
  }
  await expect.poll(() => failedHistoryRequests).toBeGreaterThan(0)
  await expect(popup.getByRole('status', { name: 'Loading activity' })).toHaveCount(0, {
    timeout: 30_000
  })
  for (const id of seeded) expect(await readIds()).toContain(id)
  await popup.getByRole('tab', { name: 'Assets' }).click()
  await popup.getByRole('tab', { name: 'Activity' }).click()
  await expect(popup.getByText('+0.005872 ETH', { exact: true }).first()).toBeVisible()
  await popup.reload()
  await popup.getByRole('tab', { name: 'Activity' }).click()
  await expect(popup.getByText('+0.005872 ETH', { exact: true }).first()).toBeVisible()
  for (const id of seeded) expect(await readIds()).toContain(id)
  await expect(popup.getByText('No activity yet', { exact: true })).toHaveCount(0)
  await captureScreenshot(popup, 'history-activity-retained-after-reload.png')
})

test('retains Bitcoin history when EVM fills the shared window and Bitcoin refresh fails', async ({
  context,
  popup
}) => {
  test.skip(!bitcoinEnabled, 'Requires an explicit Bitcoin verification profile')
  test.setTimeout(120_000)
  const unexpectedHistoryProxyRequests: string[] = []
  context.on('request', request => {
    const url = new URL(request.url())
    if (
      EVM_HISTORY_PROXY_ORIGINS.has(url.origin) &&
      /^\/(?:bitcoin|solana|near|evm)(?:\/|$)/.test(url.pathname)
    ) {
      unexpectedHistoryProxyRequests.push(request.url())
    }
  })
  await mockEvmHistoryProxy(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  const usedAddress = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
  for (const origin of ['https://mempool.space/api/', 'https://blockstream.info/api/']) {
    await context.route(`${origin}tx/${'e'.repeat(64)}/status`, route =>
      route.fulfill({ contentType: 'application/json', body: '{"confirmed":false}' })
    )
    await context.route(`${origin}address/${usedAddress}`, route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          address: usedAddress,
          chain_stats: {
            tx_count: 1,
            funded_txo_count: 1,
            funded_txo_sum: 1000,
            spent_txo_count: 1,
            spent_txo_sum: 1000
          },
          mempool_stats: {
            tx_count: 0,
            funded_txo_count: 0,
            funded_txo_sum: 0,
            spent_txo_count: 0,
            spent_txo_sum: 0
          }
        })
      })
    )
  }
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  const seeded = await popup.evaluate(async bitcoinChainId => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1']
    })
    const model = response.result
    const source = model?.items.find((item: { source: string }) => item.source === 'rpc')
    if (!source) throw new Error('Expected current EVM history')
    const discovery = await chrome.runtime.sendMessage({
      type: 'SET_ACTIVE_BITCOIN_ADDRESS_TYPE',
      walletId: model.scope.keyDomainId,
      accountId: model.scope.accountId,
      addressType: 'p2wpkh'
    })
    if (discovery.error) throw new Error('Bitcoin discovery failed')
    const discoveryDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('noir-wallet-bitcoin-discovery-v1-db', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const found = await new Promise<boolean>((resolve, reject) => {
        const transaction = discoveryDatabase.transaction('observations', 'readwrite')
        const request = transaction.objectStore('observations').openCursor()
        let matched = false
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          const record = cursor.value
          if (record.observation.derived.address === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu') {
            matched = true
            cursor.update({
              ...record,
              observation: {
                ...record.observation,
                activity: {
                  confirmedTransactionCount: 1,
                  mempoolTransactionCount: 0,
                  used: true
                }
              }
            })
          }
          cursor.continue()
        }
        transaction.oncomplete = () => resolve(matched)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      if (!found) throw new Error('Expected active p2wpkh Bitcoin discovery observation')
    } finally {
      discoveryDatabase.close()
    }
    const mutate = async (name: string, update: (store: IDBObjectStore) => void) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('records', 'readwrite')
          update(transaction.objectStore('records'))
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
      } finally {
        database.close()
      }
    }
    await mutate('noir-wallet-evm-history-cache', store => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const record = cursor.value
        if (record.chainId === 'eip155:1' && record.scope.accountId === model.scope.accountId) {
          const items = Array.from({ length: 50 }, (_, index) => {
            const hash = '0x' + (index + 1).toString(16).padStart(64, '0')
            const id = 'rpc:evm:eip155:1:' + hash + ':native'
            return {
              ...source,
              id,
              segments: source.segments.map((segment: { evidence: Record<string, unknown> }) => ({
                ...segment,
                id: id + ':origin',
                evidence: { ...segment.evidence, transactionHash: hash }
              }))
            }
          })
          cursor.update({ ...record, items, lastAttemptAt: 0, successfulSyncAt: 0, retryAfter: 0 })
        }
        cursor.continue()
      }
    })
    const hash = 'd'.repeat(64)
    const bitcoinId = 'rpc:bitcoin:' + hash
    const cacheKey =
      'activity_history_cache_v3:mainnet:' +
      model.scope.keyDomainId +
      ':' +
      model.scope.accountId +
      ':active-address-p2wpkh-v2'
    await mutate('noir-wallet-activity-history-cache', store => {
      store.put(
        {
          schemaVersion: 2,
          refreshedAtByChainId: { [bitcoinChainId]: Date.now() },
          items: [
            {
              id: bitcoinId,
              source: 'rpc',
              scope: model.scope,
              kind: 'transfer',
              status: 'final',
              snapshot: {
                schemaVersion: 1,
                direction: 'incoming',
                primaryAmount: { assetId: bitcoinChainId + '/slip44:0', amountRaw: '1000' }
              },
              segments: [
                {
                  id: bitcoinId + ':origin',
                  role: 'origin',
                  target: { kind: 'onchain', chainId: bitcoinChainId },
                  status: 'final',
                  evidence: {
                    transactionHash: hash,
                    blockHash: 'b'.repeat(64),
                    blockHeight: 1,
                    confirmations: 6,
                    requiredConfirmations: 6
                  }
                }
              ],
              completeness: 'partial',
              createdAt: 1000,
              updatedAt: 1000
            }
          ]
        },
        cacheKey
      )
    })
    const localId = 'transaction:bitcoin-history-fallback'
    const segmentId = 'segment:bitcoin-history-fallback'
    const now = Date.now()
    const graph = {
      root: {
        id: localId,
        scope: model.scope,
        kind: 'transfer',
        status: 'broadcast',
        segmentIds: [segmentId],
        createdAt: now,
        updatedAt: now,
        revision: 0,
        intent: {
          schemaVersion: 1,
          direction: 'outgoing',
          primaryAmount: { assetId: bitcoinChainId + '/slip44:0', amountRaw: '1000' },
          sender: { chainId: bitcoinChainId, address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' }
        }
      },
      segments: [
        {
          id: segmentId,
          transactionId: localId,
          role: 'origin',
          target: { kind: 'onchain', chainId: bitcoinChainId },
          status: 'broadcast',
          requiredForFinality: true,
          dependsOn: [],
          evidence: { transactionHash: 'e'.repeat(64) },
          createdAt: now,
          updatedAt: now,
          revision: 0
        }
      ]
    }
    const graphDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('noir-wallet-transactions-v2-db', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = graphDatabase.transaction('graphs', 'readwrite')
        transaction.objectStore('graphs').put({
          schemaVersion: 1,
          transactionId: localId,
          accountKey: JSON.stringify([model.scope.keyDomainId, model.scope.accountId]),
          chainIds: [bitcoinChainId],
          status: 'broadcast',
          createdAt: now,
          updatedAt: now,
          graph
        })
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      graphDatabase.close()
    }
    const refreshed = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1']
    })
    if (refreshed.error) throw new Error('EVM refresh failed')
    return {
      bitcoinId,
      localId,
      cacheKey,
      evmItemCount: refreshed.result.items.filter((item: { id: string }) =>
        item.id.startsWith('rpc:evm:')
      ).length
    }
  }, BITCOIN_MAINNET_CHAIN_ID)
  expect(seeded.evmItemCount).toBe(50)
  const readBitcoinIds = (expire = false) =>
    popup.evaluate(
      async ({ cacheKey, expire }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('noir-wallet-activity-history-cache')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          return await new Promise<string[]>((resolve, reject) => {
            const transaction = database.transaction('records', expire ? 'readwrite' : 'readonly')
            const store = transaction.objectStore('records')
            const request = store.get(cacheKey)
            let ids: string[] = []
            request.onsuccess = () => {
              const record = request.result
              ids = record?.items.map((item: { id: string }) => item.id) ?? []
              if (expire && record) store.put({ ...record, refreshedAtByChainId: {} }, cacheKey)
            }
            transaction.oncomplete = () => resolve(ids)
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error)
          })
        } finally {
          database.close()
        }
      },
      { cacheKey: seeded.cacheKey, expire }
    )
  expect(await readBitcoinIds(true)).toContain(seeded.bitcoinId)
  let failedBitcoinRequests = 0
  for (const origin of ['https://mempool.space/api/', 'https://blockstream.info/api/']) {
    await context.route(`${origin}address/*/txs`, async route => {
      failedBitcoinRequests += 1
      await route.fulfill({ status: 503, body: 'History temporarily unavailable' })
    })
  }
  const retained = await popup.evaluate(async chainId => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: [chainId]
    })
    if (response.error) throw new Error('Bitcoin refresh failed')
    return response.result.items.map((item: { id: string; source: string }) => ({
      id: item.id,
      source: item.source
    }))
  }, BITCOIN_MAINNET_CHAIN_ID)
  expect(failedBitcoinRequests).toBeGreaterThan(0)
  expect(await readBitcoinIds()).toContain(seeded.bitcoinId)
  expect(retained).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: seeded.localId, source: 'wallet-v2' })])
  )
  await popup.getByRole('tab', { name: 'Activity' }).click()
  await expect(popup.locator(`[data-activity-id="${seeded.localId}"]`)).toBeVisible()
  expect(unexpectedHistoryProxyRequests).toEqual([])
  await captureScreenshot(popup, 'history-bitcoin-local-retained-after-direct-rpc-failure.png')
})

test('discards old beta History caches and retains current records across worker restart', async ({
  context,
  popup
}) => {
  test.setTimeout(120_000)
  await mockEvmHistoryProxy(context)
  await mockReleasedEvmRpc(context)
  await mockReleasedBitcoinEsplora(context)
  await waitForBackgroundWalletInitialization(popup)
  await importTestWallet(popup)
  const seeded = await popup.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_ACTIVITY',
      action: 'refresh',
      executionMode: 'main',
      chainIds: ['eip155:1']
    })
    const model = response.result
    const source = model?.items.find((item: { source: string }) => item.source === 'rpc')
    if (!source) throw new Error('Expected a current EVM history record')
    const scope = model.scope
    const hash = '0x' + 'c'.repeat(64)
    const oldId = 'rpc:evm:' + hash + ':native'
    const oldItem = {
      ...source,
      id: oldId,
      segments: source.segments.map((segment: { evidence: Record<string, unknown> }) => ({
        ...segment,
        id: oldId + ':origin',
        evidence: { ...segment.evidence, transactionHash: hash }
      }))
    }
    const oldRecord = {
      schemaVersion: 2,
      refreshedAtByChainId: { 'eip155:1': Date.now() },
      items: [oldItem]
    }
    const legacyKey =
      'activity_history_cache_v2:mainnet:' +
      scope.keyDomainId +
      ':' +
      scope.accountId +
      ':active-address-p2wpkh-v2-evm-main'
    const otherLegacyKey = 'activity_history_cache_v2:testnet:old-beta-wallet:old-account:default'
    const mixedKey =
      'activity_history_cache_v3:mainnet:' +
      scope.keyDomainId +
      ':' +
      scope.accountId +
      ':active-address-p2wpkh-v2'
    await chrome.storage.local.set({ [legacyKey]: oldRecord, [otherLegacyKey]: oldRecord })
    const put = async (name: string, key: string, record: unknown) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction('records', 'readwrite')
          transaction.objectStore('records').put(record, key)
          transaction.oncomplete = () => resolve()
          transaction.onerror = () => reject(transaction.error)
          transaction.onabort = () => reject(transaction.error)
        })
      } finally {
        database.close()
      }
    }
    await put('noir-wallet-activity-history-cache', mixedKey, oldRecord)
    const address = source.snapshot.recipient.address.toLowerCase()
    const unscopedKey = 'eip155:1:' + address
    await put('noir-wallet-evm-history-cache', unscopedKey, {
      schemaVersion: 1,
      chainId: 'eip155:1',
      address,
      scope,
      lastAttemptAt: 0,
      successfulSyncAt: null,
      retryAfter: 0,
      items: [oldItem]
    })
    const alternateAddress = '0x1111111111111111111111111111111111111111'
    const scopedLegacyKey =
      scope.keyDomainId + ':' + scope.accountId + ':eip155:1:' + alternateAddress
    await put('noir-wallet-evm-history-cache', scopedLegacyKey, {
      schemaVersion: 1,
      chainId: 'eip155:1',
      address: alternateAddress,
      scope,
      lastAttemptAt: 0,
      successfulSyncAt: null,
      retryAfter: 0,
      items: [oldItem]
    })
    return {
      oldId,
      scope,
      legacyKeys: [legacyKey, otherLegacyKey],
      mixedKey,
      unscopedKey,
      scopedLegacyKey,
      currentIds: model.items.map((item: { id: string }) => item.id) as string[]
    }
  })
  const readIds = () =>
    popup.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ACTIVITY',
        action: 'read',
        executionMode: 'all'
      })
      if (response.error) throw new Error('Activity read failed')
      return response.result.items.map((item: { id: string }) => item.id) as string[]
    })
  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()
  await waitForBackgroundWalletInitialization(popup)
  const first = await readIds()
  expect(first).not.toContain(seeded.oldId)
  for (const id of seeded.currentIds) expect(first).toContain(id)
  const cleanup = await popup.evaluate(
    async ({ legacyKeys, mixedKey, unscopedKey, scopedLegacyKey }) => {
      const legacy = await chrome.storage.local.get(legacyKeys)
      const get = async (name: string, key: string) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          return await new Promise<unknown>((resolve, reject) => {
            const request = database
              .transaction('records', 'readonly')
              .objectStore('records')
              .get(key)
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
        } finally {
          database.close()
        }
      }
      return {
        legacyKeys: Object.keys(legacy),
        mixedRecord: await get('noir-wallet-activity-history-cache', mixedKey),
        unscopedRecord: await get('noir-wallet-evm-history-cache', unscopedKey),
        scopedLegacyRecord: await get('noir-wallet-evm-history-cache', scopedLegacyKey)
      }
    },
    seeded
  )
  expect(cleanup.legacyKeys).toEqual([])
  expect(cleanup.mixedRecord).toBeUndefined()
  expect(cleanup.unscopedRecord).toBeUndefined()
  expect(cleanup.scopedLegacyRecord).toBeUndefined()
  await terminateExtensionServiceWorker(context, popup)
  await popup.reload()
  await waitForBackgroundWalletInitialization(popup)
  const rebuilt = await readIds()
  expect(rebuilt).not.toContain(seeded.oldId)
  for (const id of seeded.currentIds) expect(rebuilt).toContain(id)
})

test('round-trips the installed package across global modes without mixing network data', async () => {
  test.skip(
    !bitcoinEnabled || !solanaEnabled || !nearEnabled,
    'This mixed-chain journey requires an explicit five-chain verification profile'
  )
  test.setTimeout(240_000)
  const profileDirectory = await mkdtemp(path.join(tmpdir(), 'noir-network-mode-'))
  let context: BrowserContext | null = null
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    })
    await mockBetaInviteApi(context)
    await mockExternalAssetIcons(context)
    await mockReleasedEvmRpc(context)
    const initial = await openExtensionPopup(context)
    const popup = initial.popup
    await waitForBackgroundWalletInitialization(popup)
    await importTestWallet(popup)
    await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({ timeout: 30_000 })

    const before = await popup.evaluate(async () => {
      const raw = (await chrome.storage.local.get('wallet_state')).wallet_state
      const state = typeof raw === 'string' ? JSON.parse(raw).state : raw?.state
      const wallet = state.wallets.find(
        (candidate: { id: string }) => candidate.id === state.currentWalletId
      )
      const account = wallet.accounts.find(
        (candidate: { id: string }) => candidate.id === state.currentAccountId
      )
      return {
        currentNetwork: state.currentNetwork,
        walletId: state.currentWalletId,
        accountId: state.currentAccountId,
        transparent: account.addresses.transparent,
        shielded: account.addresses.shielded
      }
    })
    expect(before.currentNetwork).toBe('mainnet')
    expect(before.transparent).toMatch(/^t1/)
    expect(before.shielded).toMatch(/^u1/)

    const importedPrivateAccounts = await popup.evaluate(
      async ({
        evmPrivateKey,
        bitcoinPrivateKey,
        solanaPrivateKey,
        nearPrivateKey,
        walletId,
        accountId
      }) => {
        for (const input of [
          {
            privateKey: evmPrivateKey,
            chainFamily: 'eip155',
            displayName: 'Mode EVM Private'
          },
          {
            privateKey: bitcoinPrivateKey,
            chainFamily: 'bip122',
            displayName: 'Mode Bitcoin Mainnet Private'
          },
          {
            privateKey: solanaPrivateKey,
            chainFamily: 'solana',
            displayName: 'Mode Solana Mainnet Private'
          },
          {
            privateKey: nearPrivateKey,
            chainFamily: 'near',
            displayName: 'Mode NEAR Mainnet Private'
          }
        ]) {
          const result = await chrome.runtime.sendMessage({
            type: 'IMPORT_PRIVATE_KEY_WALLET',
            ...input
          })
          if (result?.success !== true)
            throw new Error(result?.error ?? 'Private-key import failed')
        }
        const catalog = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
        const selection = await chrome.runtime.sendMessage({
          type: 'SWITCH_ACCOUNT',
          walletId,
          accountId
        })
        if (selection?.success !== true) {
          throw new Error(selection?.error ?? 'Original Account selection failed')
        }
        return catalog.result?.accounts
          ?.filter((entry: { walletDisplayName?: string }) =>
            entry.walletDisplayName?.startsWith('Mode ')
          )
          .map(
            (entry: {
              walletDisplayName: string
              walletSource: unknown
              networks: readonly { chainId: string }[]
            }) => ({
              walletDisplayName: entry.walletDisplayName,
              walletSource: entry.walletSource,
              chainIds: entry.networks.map(network => network.chainId)
            })
          )
      },
      {
        evmPrivateKey: `0x${'00'.repeat(31)}01`,
        bitcoinPrivateKey: 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn',
        solanaPrivateKey: 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx',
        nearPrivateKey: 'ed25519:cGfHiC6Kgg3FpFZvgwGcswsCRtp4aBP2fzuXRQPizuN',
        walletId: before.walletId,
        accountId: before.accountId
      }
    )
    expect(importedPrivateAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletDisplayName: 'Mode EVM Private',
          walletSource: { kind: 'private-key', chainFamily: 'eip155' },
          chainIds: expect.arrayContaining(['eip155:1', 'eip155:56'])
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode Bitcoin Mainnet Private',
          walletSource: {
            kind: 'private-key',
            chainFamily: 'bip122',
            bitcoinNetwork: 'mainnet'
          },
          chainIds: [BITCOIN_MAINNET_CHAIN_ID]
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode Solana Mainnet Private',
          walletSource: { kind: 'private-key', chainFamily: 'solana' },
          chainIds: [SOLANA_NETWORKS.mainnet.chainId]
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode NEAR Mainnet Private',
          walletSource: { kind: 'private-key', chainFamily: 'near' },
          chainIds: [NEAR_NETWORKS.mainnet.chainId]
        })
      ])
    )

    const mainnetEndpointSettings = {
      schemaVersion: 1,
      customEvmNetworks: [],
      overrides: [
        {
          chainId: BITCOIN_MAINNET_CHAIN_ID,
          explorer: {
            label: 'Mainnet release explorer',
            baseUrl: 'https://mainnet-explorer.noir.test/bitcoin',
            transactionPath: 'tx'
          }
        }
      ]
    }
    await expect(
      popup.evaluate(
        settings => chrome.runtime.sendMessage({ type: 'APPLY_CHAIN_ENDPOINT_SETTINGS', settings }),
        mainnetEndpointSettings
      )
    ).resolves.toEqual({ result: mainnetEndpointSettings })
    await expect(readPersistedEndpointModes(popup)).resolves.toEqual(['mainnet'])
    const mainnetAccountKey = `mainnet_${before.walletId}_${before.accountId}`
    const mainnetTransactionHash = '11'.repeat(32)
    await expect(
      popup.evaluate(
        ({ accountKey, transaction }) =>
          chrome.runtime.sendMessage({ type: 'ADD_TRANSACTION', accountKey, transaction }),
        {
          accountKey: mainnetAccountKey,
          transaction: {
            txHash: mainnetTransactionHash,
            status: 'success',
            type: 'send',
            amount: '0.01',
            to: before.transparent,
            from: before.transparent,
            fromType: 'transparent',
            fee: '0.0001',
            timestamp: 1_700_000_000_000,
            network: 'mainnet'
          }
        }
      )
    ).resolves.toMatchObject({ success: true })

    await popup.getByRole('button', { name: 'Settings', exact: true }).click()
    await popup.getByRole('button', { name: 'Developer Settings' }).click()
    await expect(popup.getByRole('heading', { name: 'Developer Settings' })).toBeVisible()
    await popup.getByRole('switch', { name: 'Testnet Mode' }).click()
    await expect(popup.getByRole('heading', { name: 'Enable Testnet Mode?' })).toBeVisible()

    await popup.getByRole('button', { name: 'Enable & Restart' }).click()
    await expect.poll(() => popup.isClosed(), { timeout: 90_000 }).toBe(true)
    await context.close()
    context = null

    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    })
    await mockBetaInviteApi(context)
    await context.route('https://provider-release.noir.test/**', serveSdkExample)
    await mockExternalAssetIcons(context)
    await mockReleasedEvmRpc(context, 'testnet')
    const restarted = await openExtensionPopup(context)
    expect(restarted.extensionId).toBe(initial.extensionId)
    const restartedPopup = restarted.popup
    await expect(restartedPopup.getByText('TESTNET', { exact: true })).toBeVisible({
      timeout: 90_000
    })
    await expect(restartedPopup.getByRole('heading', { name: 'Enter your password' })).toBeVisible()
    await restartedPopup.getByPlaceholder('Enter Password').fill(TEST_PASSWORD)
    await restartedPopup.getByRole('button', { name: 'Unlock' }).click()
    await expect(restartedPopup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({
      timeout: 90_000
    })

    const after = await restartedPopup.evaluate(async () => {
      const local = await chrome.storage.local.get(['wallet_state', 'wallet_settings'])
      const walletState =
        typeof local.wallet_state === 'string'
          ? JSON.parse(local.wallet_state).state
          : local.wallet_state?.state
      const settingsState =
        typeof local.wallet_settings === 'string'
          ? JSON.parse(local.wallet_settings).state
          : local.wallet_settings?.state
      const wallet = walletState.wallets.find(
        (candidate: { id: string }) => candidate.id === walletState.currentWalletId
      )
      const account = wallet.accounts.find(
        (candidate: { id: string }) => candidate.id === walletState.currentAccountId
      )
      const networks = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
      const activeAccount = networks.result?.accounts?.find(
        (entry: { active?: boolean }) => entry.active === true
      )
      return {
        currentNetwork: walletState.currentNetwork,
        networkMode: settingsState.networkMode,
        activeTransparent: account.addresses.transparent,
        activeShielded: account.addresses.shielded,
        mainnetTransparent: account.networkAddresses.mainnet.transparent,
        mainnetShielded: account.networkAddresses.mainnet.shielded,
        networkChainIds: activeAccount?.networks?.map((entry: { chainId: string }) => entry.chainId)
      }
    })
    expect(after.currentNetwork).toBe('testnet')
    expect(after.networkMode).toBe('testnet')
    expect(after.activeTransparent).toMatch(/^tm/)
    expect(after.activeShielded).toMatch(/^utest1/)
    expect(after.mainnetTransparent).toBe(before.transparent)
    expect(after.mainnetShielded).toBe(before.shielded)
    expect(after.networkChainIds).toEqual(
      expect.arrayContaining([ZCASH_TESTNET_CHAIN_ID, BITCOIN_TESTNET_CHAIN_ID, 'eip155:11155111'])
    )
    expect(after.networkChainIds).not.toContain(ZCASH_MAINNET_CHAIN_ID)
    expect(after.networkChainIds).not.toContain(BITCOIN_MAINNET_CHAIN_ID)

    const testnetDApp = await context.newPage()
    await testnetDApp.goto('https://provider-release.noir.test/example/')
    await testnetDApp.waitForFunction(() => 'noirwallet' in window)
    await testnetDApp.getByRole('button', { name: 'Testnet', exact: true }).click()
    await testnetDApp.getByRole('button', { name: 'Solana Devnet', exact: true }).click()
    await expect(testnetDApp.getByRole('heading', { name: 'Solana dApp provider' })).toBeVisible()
    await expect(
      testnetDApp.getByText("Balance and token reads use the dApp's own Solana RPC client.")
    ).toBeVisible()
    await testnetDApp.getByRole('button', { name: 'NEAR Testnet', exact: true }).click()
    await expect(testnetDApp.getByRole('heading', { name: 'NEAR dApp provider' })).toBeVisible()
    await expect(
      testnetDApp.getByText("Balance and token reads use the dApp's own NEAR RPC client.")
    ).toBeVisible()
    await testnetDApp.close()

    const testnetPrivateAccounts = await restartedPopup.evaluate(async () => {
      const catalog = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
      return catalog.result?.accounts
        ?.filter((entry: { walletDisplayName?: string }) =>
          entry.walletDisplayName?.startsWith('Mode ')
        )
        .map((entry: { walletDisplayName: string; networks: readonly { chainId: string }[] }) => ({
          walletDisplayName: entry.walletDisplayName,
          chainIds: entry.networks.map(network => network.chainId)
        }))
    })
    expect(testnetPrivateAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletDisplayName: 'Mode EVM Private',
          chainIds: expect.arrayContaining(['eip155:11155111', 'eip155:97'])
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode Bitcoin Mainnet Private',
          chainIds: []
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode Solana Mainnet Private',
          chainIds: []
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode NEAR Mainnet Private',
          chainIds: []
        })
      ])
    )
    const ethereumAsset = restartedPopup.getByRole('button', {
      name: 'View ETH details on Ethereum'
    })
    await expect(ethereumAsset).toBeVisible({ timeout: 60_000 })
    await ethereumAsset.scrollIntoViewIfNeeded()
    const ethereumTokenIcon = ethereumAsset.getByRole('img', { name: 'ETH', exact: true })
    await expect
      .poll(() => ethereumTokenIcon.evaluate(image => (image as HTMLImageElement).naturalWidth), {
        timeout: 15_000
      })
      .toBeGreaterThan(0)
    const ethereumChainIcon = ethereumAsset.getByRole('img', { name: 'Ethereum', exact: true })
    await expect(ethereumChainIcon).toHaveAttribute(
      'src',
      'https://assets.zknoir.com/chain/ethereum.svg'
    )
    await expect
      .poll(() => ethereumChainIcon.evaluate(image => (image as HTMLImageElement).naturalWidth), {
        timeout: 15_000
      })
      .toBeGreaterThan(0)
    await captureScreenshot(restartedPopup, 'release-default-testnet-mode.png')

    await expect(
      restartedPopup.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'GET_CHAIN_ENDPOINT_SETTINGS' })
      )
    ).resolves.toEqual({
      result: { schemaVersion: 1, customEvmNetworks: [], overrides: [] }
    })
    await expect(readPersistedEndpointModes(restartedPopup)).resolves.toEqual(['mainnet'])
    const testnetEndpointSettings = {
      schemaVersion: 1,
      customEvmNetworks: [],
      overrides: [
        {
          chainId: BITCOIN_TESTNET_CHAIN_ID,
          explorer: {
            label: 'Testnet release explorer',
            baseUrl: 'https://testnet-explorer.noir.test/bitcoin',
            transactionPath: 'tx'
          }
        }
      ]
    }
    await expect(
      restartedPopup.evaluate(
        settings => chrome.runtime.sendMessage({ type: 'APPLY_CHAIN_ENDPOINT_SETTINGS', settings }),
        testnetEndpointSettings
      )
    ).resolves.toEqual({ result: testnetEndpointSettings })
    await expect(readPersistedEndpointModes(restartedPopup)).resolves.toEqual([
      'mainnet',
      'testnet'
    ])
    const testnetAccountKey = `testnet_${before.walletId}_${before.accountId}`
    const testnetTransactionHash = '22'.repeat(32)
    await expect(
      restartedPopup.evaluate(
        ({ accountKey, transaction }) =>
          chrome.runtime.sendMessage({ type: 'ADD_TRANSACTION', accountKey, transaction }),
        {
          accountKey: testnetAccountKey,
          transaction: {
            txHash: testnetTransactionHash,
            status: 'success',
            type: 'send',
            amount: '0.02',
            to: after.activeTransparent,
            from: after.activeTransparent,
            fromType: 'transparent',
            fee: '0.0001',
            timestamp: 1_700_000_000_001,
            network: 'testnet'
          }
        }
      )
    ).resolves.toMatchObject({ success: true })
    await expect(readLocalTransactions(restartedPopup, mainnetAccountKey)).resolves.toEqual([
      expect.objectContaining({ txHash: mainnetTransactionHash, network: 'mainnet' })
    ])
    await expect(readLocalTransactions(restartedPopup, testnetAccountKey)).resolves.toEqual([
      expect.objectContaining({ txHash: testnetTransactionHash, network: 'testnet' })
    ])

    await restartedPopup.getByRole('button', { name: 'Settings', exact: true }).click()
    await restartedPopup.getByRole('button', { name: 'Developer Settings' }).click()
    await restartedPopup.getByRole('switch', { name: 'Testnet Mode' }).click()
    await expect(restartedPopup.getByRole('heading', { name: 'Return to Mainnet?' })).toBeVisible()
    await expect(readPersistedEndpointModes(restartedPopup)).resolves.toEqual([
      'mainnet',
      'testnet'
    ])
    await restartedPopup.getByRole('button', { name: 'Switch & Restart' }).click()
    await expect.poll(() => restartedPopup.isClosed(), { timeout: 90_000 }).toBe(true)
    await context.close()
    context = null

    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    })
    await mockBetaInviteApi(context)
    const restored = await openExtensionPopup(context)
    expect(restored.extensionId).toBe(initial.extensionId)
    const restoredPopup = restored.popup
    await expect(restoredPopup.getByRole('heading', { name: 'Enter your password' })).toBeVisible({
      timeout: 90_000
    })
    await expect(restoredPopup.getByText('TESTNET', { exact: true })).toHaveCount(0)
    await restoredPopup.getByPlaceholder('Enter Password').fill(TEST_PASSWORD)
    await restoredPopup.getByRole('button', { name: 'Unlock' }).click()
    await expect(restoredPopup.getByRole('heading', { name: 'Portfolio' })).toBeVisible({
      timeout: 90_000
    })

    const restoredState = await restoredPopup.evaluate(async () => {
      const local = await chrome.storage.local.get(['wallet_state', 'wallet_settings'])
      const walletState =
        typeof local.wallet_state === 'string'
          ? JSON.parse(local.wallet_state).state
          : local.wallet_state?.state
      const settingsState =
        typeof local.wallet_settings === 'string'
          ? JSON.parse(local.wallet_settings).state
          : local.wallet_settings?.state
      const wallet = walletState.wallets.find(
        (candidate: { id: string }) => candidate.id === walletState.currentWalletId
      )
      const account = wallet.accounts.find(
        (candidate: { id: string }) => candidate.id === walletState.currentAccountId
      )
      const networks = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
      const activeAccount = networks.result?.accounts?.find(
        (entry: { active?: boolean }) => entry.active === true
      )
      const endpoints = await chrome.runtime.sendMessage({
        type: 'GET_CHAIN_ENDPOINT_SETTINGS'
      })
      return {
        currentNetwork: walletState.currentNetwork,
        networkMode: settingsState.networkMode,
        activeTransparent: account.addresses.transparent,
        activeShielded: account.addresses.shielded,
        testnetTransparent: account.networkAddresses.testnet.transparent,
        testnetShielded: account.networkAddresses.testnet.shielded,
        networkChainIds: activeAccount?.networks?.map(
          (entry: { chainId: string }) => entry.chainId
        ),
        endpoints: endpoints.result,
        endpointModes: Object.keys(settingsState.chainEndpointSettingsByNetwork).sort()
      }
    })
    expect(restoredState).toMatchObject({
      currentNetwork: 'mainnet',
      networkMode: 'mainnet',
      activeTransparent: before.transparent,
      activeShielded: before.shielded,
      testnetTransparent: after.activeTransparent,
      testnetShielded: after.activeShielded,
      endpoints: mainnetEndpointSettings,
      endpointModes: ['mainnet', 'testnet']
    })
    expect(restoredState.networkChainIds).toEqual(
      expect.arrayContaining([ZCASH_MAINNET_CHAIN_ID, BITCOIN_MAINNET_CHAIN_ID, 'eip155:1'])
    )
    expect(restoredState.networkChainIds).not.toContain(ZCASH_TESTNET_CHAIN_ID)
    expect(restoredState.networkChainIds).not.toContain(BITCOIN_TESTNET_CHAIN_ID)
    const restoredPrivateAccounts = await restoredPopup.evaluate(async () => {
      const catalog = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNT_NETWORKS' })
      return catalog.result?.accounts
        ?.filter((entry: { walletDisplayName?: string }) =>
          entry.walletDisplayName?.startsWith('Mode ')
        )
        .map((entry: { walletDisplayName: string; networks: readonly { chainId: string }[] }) => ({
          walletDisplayName: entry.walletDisplayName,
          chainIds: entry.networks.map(network => network.chainId)
        }))
    })
    expect(restoredPrivateAccounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletDisplayName: 'Mode EVM Private',
          chainIds: expect.arrayContaining(['eip155:1', 'eip155:56'])
        }),
        expect.objectContaining({
          walletDisplayName: 'Mode Bitcoin Mainnet Private',
          chainIds: [BITCOIN_MAINNET_CHAIN_ID]
        })
      ])
    )
    await expect(readLocalTransactions(restoredPopup, mainnetAccountKey)).resolves.toEqual([
      expect.objectContaining({ txHash: mainnetTransactionHash, network: 'mainnet' })
    ])
    await expect(readLocalTransactions(restoredPopup, testnetAccountKey)).resolves.toEqual([
      expect.objectContaining({ txHash: testnetTransactionHash, network: 'testnet' })
    ])
    await captureScreenshot(restoredPopup, 'release-default-mainnet-restored.png')
  } finally {
    await context?.close().catch(() => {})
    await rm(profileDirectory, { recursive: true, force: true })
  }
})
