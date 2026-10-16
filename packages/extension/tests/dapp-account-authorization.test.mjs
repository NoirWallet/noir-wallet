import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')
const Big = require('big.js')
const ORIGIN = 'https://wallet-app.example'

function loadModule(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const { outputText } = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022
    }
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  return module.exports
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function createHarness(t, connection) {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })

  const stored = new Map([['connectedDApps', [connection]]])
  globalThis.chrome = {
    runtime: { async sendMessage() {} },
    storage: {
      local: {
        async get(key) {
          return { [key]: stored.get(key) }
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) stored.set(key, value)
        }
      }
    },
    tabs: {
      async query() {
        return []
      }
    }
  }

  const accountA = {
    id: 'account-a',
    name: 'Account A',
    addresses: { transparent: 'transparent-a', shielded: 'shielded-a' }
  }
  const accountB = {
    id: 'account-b',
    name: 'Account B',
    addresses: { transparent: 'transparent-b', shielded: 'shielded-b' }
  }
  const accountC = {
    id: 'account-c',
    name: 'Account C',
    addresses: { transparent: 'transparent-c', shielded: 'shielded-c' }
  }
  const wallet = { id: 'wallet-a', name: 'Wallet A', accounts: [accountA, accountB, accountC] }
  const walletState = {
    currentWalletId: wallet.id,
    currentAccountId: accountA.id,
    currentNetwork: 'mainnet',
    wallets: [wallet],
    accountDisplayNames: {},
    getCurrentWallet() {
      return walletState.wallets.find(candidate => candidate.id === walletState.currentWalletId)
    },
    getWallet(walletId) {
      return walletState.wallets.find(candidate => candidate.id === walletId)
    },
    getAccount(walletId, accountId) {
      return walletState.getWallet(walletId)?.accounts.find(a => a.id === accountId)
    }
  }
  const accountManager = {
    isLocked: () => false,
    getCurrentAccount: () =>
      walletState.getCurrentWallet()?.accounts.find(a => a.id === walletState.currentAccountId),
    async waitForAccountReady() {}
  }
  const balance = {
    transparent: '1',
    shielded: '2',
    total: '3',
    spendable: '2',
    available: '2',
    confirmed: { transparent: '1', shielded: '2' },
    pending: { transparent: '0', shielded: '0', total: '0' }
  }
  const managerModule = loadModule('../src/core/dapp/dapp-manager.ts')
  const dappManager = managerModule.DAppManager.getInstance()
  const walletRpcErrors = loadModule('../src/core/zcash/wallet-rpc-errors.ts', {
    './shielding': { MIN_SHIELDING_BALANCE_MESSAGE: 'Insufficient balance' },
    '@/lib/errors': { isRpcEndpointError: () => false }
  })
  const transactions = {
    added: [],
    updated: [],
    async addTransaction(value) {
      transactions.added.push(value)
      return { id: 'tx-1' }
    },
    async updateTransaction(...args) {
      transactions.updated.push(args)
    }
  }
  const scheduler = {
    requestPassiveSync() {},
    pauseForTx() {},
    async waitForWalletSyncIdle() { return true },
    resumeAfterTx() {}
  }
  const { DAppHandler } = loadModule('../src/background/dapp-handler.ts', {
    '../core/wallet/account-manager': { accountManager },
    '../core/dapp/dapp-manager': { ...managerModule, dappManager },
    './sync-scheduler': { syncScheduler: scheduler },
    '@/store/wallet-store': {
      useWalletStore: { getState: () => walletState },
      rehydrateWalletStore: async () => {}
    },
    '@/store/account-data-store': {
      useAccountDataStore: { getState: () => ({ getBalance: () => balance }) },
      buildAccountKey: (...parts) => parts.join(':')
    },
    '@/lib/hardware-capabilities': {
      getHardwareDAppMethodUnavailableReason: () => null,
      isHardwareKeySource: () => false
    },
    '@/lib/analytics': {
      trackEvent() {},
      ANALYTICS_EVENTS: { DAPP_MESSAGE_SIGNED: 'signed' },
      PAGE_IDS: {}
    },
    '@/config/dapp-matches': loadModule('../src/config/dapp-matches.ts'),
    '@/config/wallet': {
      WALLET_CONFIG: {
        NETWORK_FEE: '0.0001',
        SYNC: { DAPP_BALANCE_SYNC_STALE_MS: 30_000, MAX_BLOCKING_WAIT_MS: 30_000 }
      }
    },
    '@/config/fee': loadModule('../src/config/fee.ts'),
    '@/lib/big': { safeBig: value => new Big(value ?? '0') },
    '@/lib/async-utils': { TimeoutError: class TimeoutError extends Error {} },
    '@/lib/funding-source': { getFundingSourceUnavailableReason: () => undefined },
    './transaction-recorder': { transactionRecorder: transactions },
    '@/lib/logger': { logger: { log() {}, warn() {}, error() {} } },
    '@/core/zcash/wallet-rpc-errors': walletRpcErrors
  })

  return { dappManager, handler: new DAppHandler(), walletState, balance, accountManager, transactions }
}

function connection(overrides = {}) {
  return {
    id: 'site-connection',
    name: 'Example',
    host: 'wallet-app.example',
    origin: ORIGIN,
    favicon: '',
    connectedAt: 1,
    lastActiveAt: 1,
    ...overrides
  }
}

test('an accountless legacy connection cannot silently read or restore the current account', async t => {
  const { handler, dappManager, walletState } = createHarness(t, connection())
  await handler.initialize()
  await handler.restorePermissionsFromStorage()

  assert.equal(await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN }), null)
  for (const method of ['zcash_getBalance', 'zcash_getAddresses']) {
    await assert.rejects(handler.handleRequest({ method, origin: ORIGIN }), /zcash_requestAccounts/)
  }

  walletState.currentAccountId = 'account-b'
  assert.equal(await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN }), null)

  // Explicit Connect approval persists the selected account through this manager API.
  await dappManager.setAuthorizedAccounts(ORIGIN, {}, [
    { walletId: 'wallet-a', accountId: 'account-b' }
  ])
  const reconnected = await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN })
  assert.equal(reconnected.transparent, 'transparent-b')
  assert.deepEqual(
    reconnected.accounts.map(a => a.accountId),
    ['account-b']
  )
})

test('a bound single-account connection survives restore but denies another active account', async t => {
  const { handler, walletState, balance } = createHarness(
    t,
    connection({ boundWalletId: 'wallet-a', boundAccountId: 'account-a' })
  )
  await handler.initialize()
  await handler.restorePermissionsFromStorage()

  const connected = await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN })
  assert.equal(connected.transparent, 'transparent-a')
  assert.deepEqual(
    connected.accounts.map(a => a.accountId),
    ['account-a']
  )
  assert.equal(
    (await handler.handleRequest({ method: 'zcash_getBalance', origin: ORIGIN })).total,
    balance.total
  )

  walletState.currentAccountId = 'account-b'
  assert.equal(await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN }), null)
  await assert.rejects(
    handler.handleRequest({ method: 'zcash_getBalance', origin: ORIGIN }),
    /zcash_requestAccounts/
  )
})

test('multi-account authorization accepts only selected accounts', async t => {
  const { handler, walletState } = createHarness(
    t,
    connection({
      boundWalletId: 'wallet-a',
      boundAccountId: 'account-a',
      authorizedAccounts: [
        { walletId: 'wallet-a', accountId: 'account-a' },
        { walletId: 'wallet-a', accountId: 'account-b' }
      ]
    })
  )
  await handler.initialize()
  walletState.currentAccountId = 'account-b'

  const connected = await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN })
  assert.equal(connected.transparent, 'transparent-b')
  assert.deepEqual(
    connected.accounts.map(a => a.accountId),
    ['account-a', 'account-b']
  )

  walletState.currentAccountId = 'account-c'
  assert.equal(await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN }), null)
})

test('an account binding cannot authorize the same account ID in another wallet', async t => {
  const { handler, walletState } = createHarness(
    t,
    connection({ boundWalletId: 'wallet-a', boundAccountId: 'account-a' })
  )
  walletState.wallets.push({
    id: 'wallet-b',
    name: 'Wallet B',
    accounts: [
      {
        ...walletState.wallets[0].accounts[0],
        addresses: { transparent: 'transparent-other-wallet', shielded: 'shielded-other-wallet' }
      }
    ]
  })
  await handler.initialize()
  await handler.restorePermissionsFromStorage()
  walletState.currentWalletId = 'wallet-b'
  assert.equal(await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN }), null)
  await assert.rejects(
    handler.handleRequest({ method: 'zcash_getBalance', origin: ORIGIN }),
    /zcash_requestAccounts/
  )
})

test('the exact trusted origin still auto-connects all wallet accounts', async t => {
  const trustedOrigin = 'https://app.zknoir.com'
  const { handler, dappManager } = createHarness(
    t,
    connection({ origin: trustedOrigin, host: 'app.zknoir.com' })
  )
  await handler.initialize()

  const connected = await handler.handleRequest({
    method: 'zcash_getAccounts',
    origin: trustedOrigin
  })
  assert.deepEqual(
    connected.accounts.map(a => a.accountId),
    ['account-a', 'account-b', 'account-c']
  )
  assert.deepEqual(await dappManager.getAuthorizedAccounts(trustedOrigin), [
    { walletId: 'wallet-a', accountId: 'account-a' },
    { walletId: 'wallet-a', accountId: 'account-b' },
    { walletId: 'wallet-a', accountId: 'account-c' }
  ])
})

test('invalid persisted account references do not authorize a site', async t => {
  const { handler } = createHarness(
    t,
    connection({
      boundWalletId: 'wallet-a',
      boundAccountId: '',
      authorizedAccounts: [null, { walletId: 'wallet-a', accountId: '' }, 'account-a']
    })
  )
  await handler.initialize()

  assert.equal(await handler.handleRequest({ method: 'zcash_getAccounts', origin: ORIGIN }), null)
  await assert.rejects(
    handler.handleRequest({ method: 'zcash_getBalance', origin: ORIGIN }),
    /zcash_requestAccounts/
  )
})

test('WalletConnect cannot inherit injected-origin permissions or read another account', async t => {
  const { handler, walletState } = createHarness(
    t,
    connection({
      boundWalletId: 'wallet-a',
      boundAccountId: 'account-a'
    })
  )
  const authorization = {
    topic: 'remote-session',
    walletId: 'wallet-a',
    accountId: 'account-a',
    url: ORIGIN,
    name: 'Example',
    label: 'Account A',
    addresses: { transparent: 'transparent-a', shielded: 'shielded-a' },
    isActive: () => true
  }
  const result = await handler.handleWalletConnectRequest(authorization, {
    method: 'zcash_getAddresses',
    params: []
  })
  assert.equal(result.transparent, 'transparent-a')
  walletState.currentAccountId = 'account-b'
  await assert.rejects(
    handler.handleWalletConnectRequest(authorization, {
      method: 'zcash_getAddresses',
      params: []
    }),
    /no longer authorized/
  )
  await assert.rejects(
    handler.handleRequest({
      method: 'zcash_getAddresses',
      origin: 'walletconnect://remote-session'
    }),
    /no longer authorized/
  )
})

test('WalletConnect signing rechecks revocation after wallet-core readiness', async t => {
  const { handler, accountManager } = createHarness(t, connection())
  let active = true
  let signatures = 0
  handler.requestUserApproval = async () => ({
    approved: true,
    walletId: 'wallet-a',
    accountId: 'account-a'
  })
  accountManager.getWalletCore = async () => {
    active = false
    return {
      async signMessage() {
        signatures += 1
        return {}
      }
    }
  }
  await assert.rejects(
    handler.handleWalletConnectRequest(
      {
        topic: 'remote-session',
        walletId: 'wallet-a',
        accountId: 'account-a',
        url: ORIGIN,
        name: 'Example',
        label: 'Account A',
        addresses: { transparent: 'transparent-a', shielded: 'shielded-a' },
        isActive: () => active
      },
      { method: 'zcash_signMessage', params: ['hello'] }
    ),
    /no longer authorized/
  )
  assert.equal(signatures, 0)
})

test('WalletConnect transfer cannot broadcast after authorization is revoked during recording', async t => {
  const { handler, accountManager, transactions } = createHarness(t, connection())
  const recordingStarted = deferred()
  const releaseRecording = deferred()
  let active = true
  let broadcasts = 0

  handler.requestUserApprovalWithId = async () => ({
    approved: true,
    requestId: 'approved-send',
    walletId: 'wallet-a',
    accountId: 'account-a'
  })
  accountManager.getWalletCore = async () => ({
    async sendTransaction() {
      broadcasts += 1
      return { txHash: 'unexpected-broadcast' }
    }
  })
  transactions.addTransaction = async value => {
    transactions.added.push(value)
    recordingStarted.resolve()
    await releaseRecording.promise
    return { id: 'recorded-send' }
  }

  const pending = handler.handleWalletConnectRequest(
    {
      topic: 'remote-session',
      walletId: 'wallet-a',
      accountId: 'account-a',
      url: ORIGIN,
      name: 'Example',
      label: 'Account A',
      addresses: { transparent: 'transparent-a', shielded: 'shielded-a' },
      isActive: () => active
    },
    {
      method: 'zcash_sendTransaction',
      params: [{ to: `t1${'a'.repeat(33)}`, amount: '0.1' }]
    }
  )

  await recordingStarted.promise
  active = false
  releaseRecording.resolve()
  await assert.rejects(pending, /no longer authorized/)
  assert.equal(broadcasts, 0)
  assert.deepEqual(transactions.updated, [
    ['mainnet:wallet-a:account-a', 'recorded-send', { status: 'failed', notified: true }]
  ])
})
