import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function loadModule(path, dependencies) {
  const { outputText } = typescript.transpileModule(
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2022
      }
    }
  )
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(
    specifier => dependencies[specifier] ?? {},
    module,
    module.exports
  )
  return module.exports
}

function wallet(keySource, name, accountName) {
  return {
    id: `wallet-${keySource}`,
    name,
    keySource,
    seedPhraseKey: '',
    createdAt: 1,
    isPinned: false,
    accounts: [
      {
        id: `account-${keySource}`,
        name: accountName,
        addresses: { transparent: '', shielded: '' },
        derivationIndex: 0,
        birthdayHeight: 100
      }
    ]
  }
}

async function harness(wallets = [], accountDisplayNames = {}) {
  const stored = new Map([
    ['wallet_state', { version: 0, state: { wallets, accountDisplayNames } }]
  ])
  const storage = {
    async getItem(key) {
      return structuredClone(stored.get(key) ?? null)
    },
    async setItem(key, value) {
      stored.set(key, structuredClone(value))
    },
    async removeItem(key) {
      stored.delete(key)
    }
  }
  const { useWalletStore, waitForHydration } = loadModule('../src/store/wallet-store.ts', {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/lib/chrome-storage-adapter': { createChromeStorageAdapter: () => storage },
    '@/lib/wallet-metadata-storage': {
      async refreshWalletMetadata(hydrate) {
        await hydrate()
      }
    }
  })
  await waitForHydration()
  const credentials = new Map()
  const imports = []
  const { accountManager } = loadModule('../src/core/wallet/account-manager.ts', {
    '@/store/wallet-store': {
      useWalletStore,
      rehydrateWalletStore: () => useWalletStore.persist.rehydrate()
    },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/config/wallet': { WALLET_CONFIG: {} },
    '@/lib/logger': { logger: { log() {}, async refreshCache() {} } },
    './secure-storage': {
      SecureStorage: {
        async saveHardwareWalletData(id, data) {
          credentials.set(id, data)
        },
        async loadHardwareWalletData(id) {
          return credentials.get(id) ?? null
        },
        async removeHardwareWalletData(id) {
          credentials.delete(id)
        },
        async saveSessionPassword() {},
        async saveLastActivityTime() {}
      }
    }
  })
  accountManager.password = 'fixture-password'
  accountManager.isInitialized = true
  accountManager.getOrCreateWalletCore = () => ({
    async initialize() {},
    async createAccountFromUfvk(params) {
      imports.push(params)
    },
    async getUnifiedAddresses() {
      return { transparent: 'fixture-transparent', shielded: 'fixture-shielded' }
    },
    async getAccountBirthday() {
      return 100
    }
  })
  accountManager.startSyncFor = () => {}
  accountManager.switchWallet = async id => {
    const selected = useWalletStore.getState().getWallet(id)
    useWalletStore.getState().setCurrentAccount(id, selected.accounts[0].id)
  }
  return { accountManager, useWalletStore, stored, imports, credentials }
}

test('hardware imports persist the chosen name on both wallet and visible account', async () => {
  for (const keySource of ['ledger', 'keystone']) {
    const { accountManager, useWalletStore, stored } = await harness()
    const name = `${keySource} 0`
    const id = await accountManager.createHardwareWallet({
      name: ` ${name} `,
      ufvk: 'fixture-ufvk',
      accountHdIndex: 0,
      keySource
    })
    const state = useWalletStore.getState()
    assert.equal(state.getWallet(id).name, name)
    assert.equal(state.getCurrentAccount().name, name)
    assert.equal(stored.get('wallet_state').state.wallets[0].accounts[0].name, name)
    await useWalletStore.persist.rehydrate()
    assert.equal(useWalletStore.getState().getCurrentAccount().name, name)
  }
})

test('an empty hardware wallet name cannot create credentials or a wallet', async () => {
  const { accountManager, useWalletStore, credentials, imports } = await harness()
  await assert.rejects(
    accountManager.createHardwareWallet({
      name: '  ',
      ufvk: 'fixture-ufvk',
      accountHdIndex: 0,
      keySource: 'ledger'
    }),
    /wallet name/
  )
  assert.equal(credentials.size, 0)
  assert.equal(imports.length, 0)
  assert.equal(useWalletStore.getState().wallets.length, 0)
})

test('post-commit hardware startup failure preserves the selected wallet credential', async () => {
  const { accountManager, useWalletStore, credentials } = await harness()
  accountManager.startSyncFor = () => {
    throw new Error('sync startup failed')
  }
  await assert.rejects(
    accountManager.createHardwareWallet({
      name: 'Keystone',
      ufvk: 'fixture-ufvk',
      accountHdIndex: 0,
      keySource: 'keystone'
    }),
    /sync startup failed/
  )
  const state = useWalletStore.getState()
  assert.equal(state.wallets.length, 1)
  assert.equal(credentials.has(state.currentWalletId), true)
})

test('unreadable existing hardware entry cannot silently create a duplicate', async () => {
  const { accountManager, useWalletStore, credentials } = await harness()
  const params = {
    name: 'Keystone',
    ufvk: 'fixture-ufvk',
    accountHdIndex: 0,
    keySource: 'keystone'
  }
  const id = await accountManager.createHardwareWallet(params)
  credentials.delete(id)
  await assert.rejects(
    accountManager.createHardwareWallet(params),
    /existing hardware wallet cannot be read/
  )
  assert.equal(useWalletStore.getState().wallets.length, 1)
  assert.equal(credentials.size, 0)
})

test('rehydration recovers legacy hardware names and notifies subscribers', async () => {
  const ledger = wallet('ledger', 'ledger 0', 'Ledger Account')
  const keystone = wallet('keystone', 'Keystone savings', 'Keystone Account')
  const { useWalletStore } = await harness([ledger, keystone])
  const recovered = useWalletStore.getState().wallets
  assert.equal(recovered[0].accounts[0].name, ledger.name)
  assert.equal(recovered[1].accounts[0].name, keystone.name)
  assert.deepEqual(recovered[0].accounts[0].addresses, ledger.accounts[0].addresses)
  assert.equal(recovered[0].accounts[0].id, ledger.accounts[0].id)
  assert.equal(recovered[0].accounts[0].birthdayHeight, 100)
  const observed = []
  const unsubscribe = useWalletStore.subscribe(state => {
    observed.push(state.wallets.map(item => item.accounts[0]?.name))
  })
  await useWalletStore.persist.rehydrate()
  unsubscribe()
  assert.deepEqual(useWalletStore.getState().wallets, recovered)
  assert.deepEqual(observed.at(-1), [ledger.name, keystone.name])
})

test('legacy name recovery preserves manual names, software accounts and ambiguous metadata', async () => {
  const cases = [
    [wallet('ledger', 'ledger 0', 'Trading Ledger'), {}],
    [
      wallet('ledger', 'ledger 0', 'Ledger Account'),
      { 'wallet-ledger_account-ledger': 'My Ledger' }
    ],
    [
      wallet('ledger', 'ledger 0', 'Ledger Account'),
      { 'wallet-ledger_account-ledger': 'Ledger Account' }
    ],
    [wallet('software', 'Software wallet', 'Ledger Account'), {}],
    [wallet('ledger', ' ', 'Ledger Account'), {}]
  ]
  const multiple = wallet('ledger', 'ledger 0', 'Ledger Account')
  multiple.accounts.push({ ...multiple.accounts[0], id: 'second-account' })
  cases.push([multiple, {}])
  for (const [original, displayNames] of cases) {
    const { useWalletStore } = await harness([original], displayNames)
    const state = useWalletStore.getState()
    assert.deepEqual(
      state.wallets[0].accounts.map(account => account.name),
      original.accounts.map(account => account.name)
    )
    assert.deepEqual(state.accountDisplayNames, displayNames)
  }
})

test('reimporting the same signer preserves its existing chosen name', async () => {
  const { accountManager, useWalletStore, imports } = await harness()
  const originalId = await accountManager.createHardwareWallet({
    name: 'ledger 0',
    ufvk: 'fixture-ufvk',
    accountHdIndex: 0,
    keySource: 'ledger'
  })
  const reimportedId = await accountManager.createHardwareWallet({
    name: 'Ledger Nano',
    ufvk: 'fixture-ufvk',
    accountHdIndex: 0,
    keySource: 'ledger'
  })
  assert.equal(reimportedId, originalId)
  assert.equal(useWalletStore.getState().wallets.length, 1)
  assert.equal(useWalletStore.getState().getCurrentAccount().name, 'ledger 0')
  assert.equal(imports.length, 1)
})
