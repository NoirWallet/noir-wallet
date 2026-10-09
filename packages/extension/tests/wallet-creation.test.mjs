import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')
const { create } = require('zustand')

function loadModule(path, dependencies) {
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

function createHarness(t) {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })

  const stored = new Map()
  const storageWrites = []
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          return { [key]: stored.get(key) }
        },
        async set(values) {
          storageWrites.push(values)
          for (const [key, value] of Object.entries(values)) stored.set(key, value)
        }
      }
    },
    runtime: { async sendMessage() {} }
  }

  const phraseA = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' ')
  const phraseB = Array.from({ length: 24 }, (_, i) => `other${i}`).join(' ')
  const generated = [phraseA, phraseB]
  const worker = {
    generationCount: 0,
    async generateMnemonic() {
      return generated[this.generationCount++] ?? phraseB
    },
    async validateMnemonic(phrase) {
      return phrase === phraseA || phrase === phraseB
    }
  }
  const walletConfig = {
    MNEMONIC_LENGTH: 24,
    SECURITY: { LOGIN_ATTEMPTS: { MAX_ATTEMPTS: 5, LOCKOUT_DURATION_MS: 60_000 } }
  }
  const { SecureStorage } = loadModule('../src/core/wallet/secure-storage.ts', {
    '@/config/wallet': { WALLET_CONFIG: walletConfig },
    './session-state': { SESSION_PASSWORD_STORAGE_KEY: 'session_password' }
  })
  const { MnemonicGenerator } = loadModule('../src/core/wallet/mnemonic.ts', {
    '../worker/client': { getOffscreenClient: () => worker },
    '@/config/wallet': { WALLET_CONFIG: walletConfig },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' }
  })
  const walletState = {
    wallets: [],
    currentWalletId: null,
    getWallet(walletId) {
      return this.wallets.find(wallet => wallet.id === walletId)
    },
    addWallet(wallet) {
      this.wallets.push(wallet)
    },
    setCurrentAccount(walletId, accountId) {
      this.currentWalletId = walletId
      this.currentAccountId = accountId
    }
  }
  const logger = { log() {}, warn() {}, error() {}, async refreshCache() {} }
  const { accountManager } = loadModule('../src/core/wallet/account-manager.ts', {
    './secure-storage': { SecureStorage },
    './mnemonic': { MnemonicGenerator },
    '@/lib/logger': { logger },
    '@/store/wallet-store': { useWalletStore: { getState: () => walletState } },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/config/wallet': { WALLET_CONFIG: walletConfig },
    '@/lib/errors': { withRetry: operation => operation() },
    '@/lib/hardware-capabilities': { isHardwareKeySource: () => false }
  })
  accountManager.password = 'test-only-password'
  accountManager.isInitialized = true
  accountManager.ensureSingleWalletSyncTarget = async () => {}
  const derived = []
  accountManager.getOrCreateWalletCore = () => ({
    async ensureInitialized() {},
    async reset() {},
    async initialize() {},
    async getLatestBlock() {
      return 1000
    },
    async createAccount(phrase) {
      derived.push(phrase)
    },
    async getAddresses(phrase) {
      return { transparent: `t:${phrase ?? derived.at(-1)}`, shielded: 'shielded' }
    }
  })
  accountManager.setPrimaryWalletState = async wallet => {
    walletState.wallets = [wallet]
    walletState.setCurrentAccount(wallet.id, wallet.accounts[0].id)
  }

  const { useOnboardingStore } = loadModule('../src/store/onboarding-store.ts', {
    zustand: { create },
    '@/core/wallet/account-manager': { accountManager },
    '@/core/wallet/mnemonic': { MnemonicGenerator },
    '@/config/wallet': { WALLET_CONFIG: walletConfig },
    '@/lib/analytics': {
      ANALYTICS_EVENTS: { WALLET_CREATED: 'wallet_created' },
      sendAnalyticsEvent() {}
    },
    '@/lib/async-utils': loadModule('../src/lib/async-utils.ts', {}),
    '@/lib/errors': { classifyError: error => ({ userMessage: error.message }) }
  })

  return {
    accountManager,
    derived,
    phraseA,
    SecureStorage,
    storageWrites,
    walletState,
    worker,
    useOnboardingStore
  }
}

test('adding a wallet saves the recovery phrase shown and verified by the user', async t => {
  const { accountManager, derived, phraseA, walletState, worker, useOnboardingStore } =
    createHarness(t)
  const onboarding = useOnboardingStore.getState()
  await onboarding.generateSeedPhrase()
  assert.equal(useOnboardingStore.getState().seedPhrase.join(' ') === phraseA, true)
  for (const index of useOnboardingStore.getState().verificationIndices) {
    onboarding.selectWord(index)
  }
  assert.equal(useOnboardingStore.getState().verifySeedPhrase(), true)

  assert.equal(await onboarding.addWallet(), true)
  const wallet = walletState.wallets[0]
  assert.equal(
    (await accountManager.getSeedPhrase('test-only-password', wallet.id)) === phraseA,
    true
  )
  assert.equal(wallet.accounts[0].addresses.transparent === `t:${phraseA}`, true)
  assert.equal(derived.length, 0)
  assert.equal(worker.generationCount, 1)
})

test('first wallet creation uses the recovery phrase shown during onboarding', async t => {
  const { accountManager, derived, phraseA, walletState, worker, useOnboardingStore } =
    createHarness(t)
  const onboarding = useOnboardingStore.getState()
  await onboarding.generateSeedPhrase()
  onboarding.setPassword('test-only-password')
  for (const index of useOnboardingStore.getState().verificationIndices) {
    onboarding.selectWord(index)
  }
  assert.equal(useOnboardingStore.getState().verifySeedPhrase(), true)

  assert.equal(await onboarding.createWallet(), true)
  const wallet = walletState.wallets[0]
  assert.equal(
    (await accountManager.getSeedPhrase('test-only-password', wallet.id)) === phraseA,
    true
  )
  assert.equal(wallet.accounts[0].addresses.transparent === `t:${phraseA}`, true)
  assert.equal(derived.length === 1 && derived[0] === phraseA, true)
  assert.equal(worker.generationCount, 1)
})

test('invalid or missing phrase cannot create a wallet or write storage', async t => {
  const { accountManager, storageWrites, walletState, worker } = createHarness(t)

  for (const phrase of ['', 'invalid phrase']) {
    await assert.rejects(
      accountManager.addNewWallet(phrase),
      /recovery phrase|seed phrase|mnemonic/i
    )
  }
  assert.equal(walletState.wallets.length, 0)
  assert.equal(storageWrites.length, 0)
  assert.equal(worker.generationCount, 0)
})

test('wallet creation reports failure when the credential cannot be stored', async t => {
  const { walletState, useOnboardingStore } = createHarness(t)
  const onboarding = useOnboardingStore.getState()
  await onboarding.generateSeedPhrase()
  for (const index of useOnboardingStore.getState().verificationIndices) {
    onboarding.selectWord(index)
  }
  assert.equal(useOnboardingStore.getState().verifySeedPhrase(), true)
  globalThis.chrome.storage.local.set = async () => {
    throw new Error('storage unavailable')
  }

  assert.equal(await onboarding.addWallet(), false)
  assert.equal(walletState.wallets.length, 0)
  assert.match(useOnboardingStore.getState().error, /storage unavailable/)
})
