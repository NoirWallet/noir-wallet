import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

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
  const previousWarn = console.warn
  console.warn = () => {}
  t.after(() => {
    globalThis.chrome = previousChrome
    console.warn = previousWarn
  })

  const local = new Map()
  const session = new Map()
  const effects = []
  let rejectCredentialSet = false
  let failPartialCredentialSet = false
  let rehydrate = async () => {}
  function area(entries, kind) {
    return {
      async get(keys) {
        const selected = keys == null ? [...entries.keys()] : Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(
          selected.filter(key => entries.has(key)).map(key => [key, entries.get(key)])
        )
      },
      async set(values) {
        if (
          kind === 'local' &&
          rejectCredentialSet &&
          Object.keys(values).some(key => key.startsWith('seed_') || key.startsWith('hw_'))
        ) {
          throw new Error('storage unavailable')
        }
        if (kind === 'local' && failPartialCredentialSet) {
          failPartialCredentialSet = false
          const [key, value] = Object.entries(values)[0]
          entries.set(key, value)
          throw new Error('storage interrupted')
        }
        for (const [key, value] of Object.entries(values)) entries.set(key, value)
        effects.push(`${kind}:set`)
      },
      async remove(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key)
      }
    }
  }
  globalThis.chrome = {
    storage: { local: area(local, 'local'), session: area(session, 'session') },
    runtime: { async sendMessage() {} }
  }

  const phraseA = Array.from({ length: 24 }, (_, index) => `alpha${index}`).join(' ')
  const phraseB = Array.from({ length: 24 }, (_, index) => `beta${index}`).join(' ')
  const phraseC = Array.from({ length: 24 }, (_, index) => `gamma${index}`).join(' ')
  const phrases = [phraseA, phraseB, phraseC]
  const config = {
    SECURITY: { LOGIN_ATTEMPTS: { MAX_ATTEMPTS: 5, LOCKOUT_DURATION_MS: 60_000 } },
    MNEMONIC_LENGTH: 24
  }
  const { SecureStorage } = loadModule('../src/core/wallet/secure-storage.ts', {
    '@/config/wallet': { WALLET_CONFIG: config },
    './session-state': { SESSION_PASSWORD_STORAGE_KEY: 'session_password' }
  })
  const derived = []
  const core = {
    accountIndex: 0,
    async initialize() {},
    async ensureInitialized() {},
    async reset() {},
    async getLatestBlock() {
      return 100
    },
    async createAccount(phrase, index) {
      derived.push({ phrase, index })
    },
    async getAddresses(phrase, _network, index = 0) {
      const source = phrase ?? derived.at(-1)?.phrase
      return { transparent: `t-${phrases.indexOf(source)}-${index}`, shielded: 'shielded' }
    },
    hasAccount() {
      return true
    },
    setSeedPhrase() {},
    setWatchOnly() {},
    async getNextShieldedAddress() {
      return { shielded: 'shielded-next', fullUnified: 'unified-next' }
    },
    async persistDb() {}
  }
  const walletState = {
    wallets: [],
    currentWalletId: null,
    currentAccountId: null,
    getWallet(id) {
      return this.wallets.find(wallet => wallet.id === id)
    },
    getAccount(walletId, accountId) {
      return this.getWallet(walletId)?.accounts.find(account => account.id === accountId)
    },
    setWallets(wallets) {
      this.wallets = wallets
    },
    addWallet(wallet) {
      this.wallets.push(wallet)
    },
    setCurrentAccount(walletId, accountId) {
      this.currentWalletId = walletId
      this.currentAccountId = accountId
    },
    setCurrentNetwork() {},
    updateWallet(id, updater) {
      this.wallets = this.wallets.map(wallet => (wallet.id === id ? updater(wallet) : wallet))
    },
    updateAccountInWallets(walletId, accountId, updates) {
      this.updateWallet(walletId, wallet => ({
        ...wallet,
        accounts: wallet.accounts.map(account =>
          account.id === accountId ? { ...account, ...updates } : account
        )
      }))
    }
  }
  const logger = { log() {}, warn() {}, error() {}, async refreshCache() {} }
  const manager = loadModule('../src/core/wallet/account-manager.ts', {
    './secure-storage': { SecureStorage },
    './mnemonic': {
      MnemonicGenerator: {
        async generateSecurePhrase() {
          return phraseA.split(' ')
        },
        async validate(phrase) {
          return phrases.includes(phrase)
        }
      }
    },
    '@/lib/logger': { logger },
    '@/store/wallet-store': {
      useWalletStore: { getState: () => walletState },
      rehydrateWalletStore: () => rehydrate()
    },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/config/wallet': { WALLET_CONFIG: config },
    '@/lib/errors': { withRetry: operation => operation() },
    '../worker/client': { getWorkerClient: () => ({ abortPendingInit() {} }) },
    '@/lib/hardware-capabilities': {
      isHardwareKeySource: source => source === 'ledger' || source === 'keystone'
    },
    '@/store/account-data-store': {
      buildAccountKey: (_, walletId, accountId) => `${walletId}:${accountId}`
    }
  }).accountManager
  manager.isInitialized = true
  manager.getOrCreateWalletCore = () => core
  manager.ensureSingleWalletSyncTarget = async () => {}
  manager.startSyncFor = () => {}
  manager.requestSync = () => {}
  manager.ensureWalletCoreAccount = async () => {}
  manager.waitForAccountReady = async () => {}
  manager.persistWalletDbDuringSync = async () => {}
  manager.notifyShieldedAddressChanged = () => {}
  manager.switchWallet = async id => {
    effects.push('switchWallet')
    walletState.setCurrentAccount(id, walletState.getWallet(id).accounts[0].id)
  }

  return {
    manager,
    SecureStorage,
    local,
    session,
    effects,
    walletState,
    derived,
    phraseA,
    phraseB,
    phraseC,
    setRehydrate(callback) {
      rehydrate = callback
    },
    rejectCredentialWrites(value) {
      rejectCredentialSet = value
    },
    failPartialCredentialWriteOnce() {
      failPartialCredentialSet = true
    }
  }
}

test('first wallet and added wallets preserve supplied phrases and derived addresses', async t => {
  const { manager, SecureStorage, walletState, derived, phraseA, phraseB, phraseC } =
    createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const first = walletState.wallets[0]
  assert.equal(first.secretPhraseCreationRevision, 1)
  assert.equal(first.secretPhraseBackupVerifiedAt, undefined)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(first.id, 'old-password')) === phraseA,
    true
  )
  assert.equal(first.accounts[0].addresses.transparent, 't-0-0')
  assert.equal(derived[0].phrase === phraseA, true)

  const secondId = await manager.addImportedWallet(phraseB)
  const second = walletState.getWallet(secondId)
  assert.equal(second.secretPhraseCreationRevision, 1)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(secondId, 'old-password')) === phraseB,
    true
  )
  assert.equal(second.accounts[0].addresses.transparent, 't-1-0')
  const added = await manager.addNewWallet(phraseC)
  assert.equal(added.seedPhrase === phraseC, true)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(added.walletId, 'old-password')) === phraseC,
    true
  )
  assert.equal(walletState.getWallet(added.walletId).accounts[0].addresses.transparent, 't-2-0')
  assert.equal(walletState.getWallet(added.walletId).secretPhraseCreationRevision, 1)
  assert.equal(walletState.wallets.length, 3)
})

test('generated first wallet derives and stores the phrase it returns', async t => {
  const { manager, SecureStorage, walletState, derived, phraseA } = createHarness(t)
  const returned = await manager.createNewWallet('old-password')
  const wallet = walletState.wallets[0]
  assert.equal(wallet.secretPhraseCreationRevision, 1)
  assert.equal(returned === phraseA, true)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(wallet.id, 'old-password')) === phraseA,
    true
  )
  assert.equal(derived[0].phrase === phraseA, true)
  assert.equal(wallet.accounts[0].addresses.transparent, 't-0-0')
})

test('invalid imports have no credential, wallet, or sync side effects', async t => {
  const { manager, local, effects, walletState } = createHarness(t)
  await assert.rejects(manager.importWallet('invalid', 'old-password'), /Invalid seed phrase/)
  manager.password = 'old-password'
  await assert.rejects(manager.addNewWallet('invalid'), /Invalid seed phrase/)
  await assert.rejects(manager.addImportedWallet('invalid'), /Invalid seed phrase/)
  assert.equal(walletState.wallets.length, 0)
  assert.equal(
    [...local.keys()].some(key => key.startsWith('seed_')),
    false
  )
  assert.deepEqual(effects, [])
})

test('duplicate import selects existing wallet without another credential', async t => {
  const { manager, walletState, local, effects, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const firstId = walletState.wallets[0].id
  const existingKeys = [...local.keys()].filter(key => key.startsWith('seed_'))
  const duplicateId = await manager.addImportedWallet(phraseA)
  assert.equal(duplicateId, firstId)
  const duplicateNew = await manager.addNewWallet(phraseA)
  assert.equal(duplicateNew.walletId, firstId)
  assert.equal(walletState.wallets.length, 1)
  assert.deepEqual(
    [...local.keys()].filter(key => key.startsWith('seed_')),
    existingKeys
  )
  assert.equal(effects.includes('switchWallet'), true)
})

test('recovery phrase lookup binds wallet id and handles wrong, missing, and hardware credentials', async t => {
  const { manager, SecureStorage, local, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const firstId = walletState.wallets[0].id
  const secondId = await manager.addImportedWallet(phraseB)
  assert.equal((await manager.getSeedPhrase('old-password', secondId)) === phraseB, true)
  assert.equal((await manager.getSeedPhrase('old-password', firstId)) === phraseA, true)
  assert.equal(await manager.getSeedPhrase('wrong-password', secondId), null)
  const secondCiphertext = local.get(`seed_${secondId}`)
  local.set(`seed_${secondId}`, { ...secondCiphertext, encryptedData: 'invalid' })
  assert.equal(await manager.getSeedPhrase('old-password', secondId), null)
  local.delete(`seed_${secondId}`)
  assert.equal(await manager.getSeedPhrase('old-password', secondId), null)
  walletState.getWallet(secondId).keySource = 'ledger'
  assert.equal(await manager.getSeedPhrase('old-password', secondId), null)
  const getStored = globalThis.chrome.storage.local.get
  globalThis.chrome.storage.local.get = async keys => {
    if (keys === `seed_${firstId}`) throw new Error('storage read unavailable')
    return getStored(keys)
  }
  await assert.rejects(manager.getSeedPhrase('old-password', firstId), /Incorrect password/)
  globalThis.chrome.storage.local.get = getStored
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(firstId, 'old-password')) === phraseA,
    true
  )
})

test('phrase lookup cannot return a late result after the session ends or wallet changes', async t => {
  const { manager, SecureStorage, walletState, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const walletId = walletState.wallets[0].id
  const load = SecureStorage.loadWalletSeedPhrase
  let release
  SecureStorage.loadWalletSeedPhrase = async (...args) => {
    await new Promise(resolve => {
      release = resolve
    })
    return load.call(SecureStorage, ...args)
  }

  const lockedLookup = manager.getSeedPhrase('old-password', walletId)
  manager.setSessionPassword(null)
  manager.setSessionPassword('old-password')
  release()
  assert.equal(await lockedLookup, null)

  const replacedLookup = manager.getSeedPhrase('old-password', walletId)
  walletState.wallets[0] = { ...walletState.wallets[0], createdAt: Date.now() + 1 }
  release()
  assert.equal(await replacedLookup, null)
})

test('derived account and receive address rotation preserve encrypted wallet credential', async t => {
  const { manager, SecureStorage, local, walletState, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const wallet = walletState.wallets[0]
  const before = local.get(`seed_${wallet.id}`)
  const accountId = await manager.addNewAccount(wallet.id)
  assert.equal(walletState.getAccount(wallet.id, accountId).addresses.transparent, 't-0-1')
  await manager.rotateShieldedReceiveAddress(wallet.id, wallet.accounts[0].id)
  assert.equal(JSON.stringify(local.get(`seed_${wallet.id}`)) === JSON.stringify(before), true)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(wallet.id, 'old-password')) === phraseA,
    true
  )
})

test('password change reencrypts every software and hardware credential together', async t => {
  const { manager, SecureStorage, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const firstId = walletState.wallets[0].id
  const secondId = await manager.addImportedWallet(phraseB)
  const hardwareId = 'hardware-wallet'
  const hardware = { ufvk: 'synthetic-ufvk', accountHdIndex: 0 }
  await SecureStorage.saveHardwareWalletData(hardwareId, hardware, 'old-password')
  walletState.wallets.push({
    id: hardwareId,
    keySource: 'ledger',
    accounts: [{ id: 'hardware-account' }]
  })
  manager.unlock = async password => ({
    success: Boolean(await SecureStorage.loadWalletSeedPhrase(firstId, password))
  })

  assert.equal(await manager.changePassword('old-password', 'new-password'), true)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(firstId, 'new-password')) === phraseA,
    true
  )
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(secondId, 'new-password')) === phraseB,
    true
  )
  assert.equal(
    (await SecureStorage.loadHardwareWalletData(hardwareId, 'new-password'))?.ufvk ===
      hardware.ufvk,
    true
  )
  assert.equal(await SecureStorage.loadWalletSeedPhrase(firstId, 'old-password'), null)
  assert.equal(await SecureStorage.loadWalletSeedPhrase(secondId, 'old-password'), null)
  assert.equal(await SecureStorage.loadHardwareWalletData(hardwareId, 'old-password'), null)
  assert.equal((await SecureStorage.getSessionPassword()) === 'new-password', true)
})

test('later unreadable wallet cannot leave an earlier wallet under the new password', async t => {
  const { manager, SecureStorage, local, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const firstId = walletState.wallets[0].id
  const secondId = await manager.addImportedWallet(phraseB)
  manager.unlock = async password => ({
    success: Boolean(await SecureStorage.loadWalletSeedPhrase(firstId, password))
  })
  local.delete(`seed_${secondId}`)

  await assert.rejects(manager.changePassword('old-password', 'new-password'))
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(firstId, 'old-password')) === phraseA,
    true
  )
  assert.equal(await SecureStorage.loadWalletSeedPhrase(firstId, 'new-password'), null)
  assert.equal((await SecureStorage.getSessionPassword()) === 'old-password', true)
})

test('encryption and storage failures preserve every old credential', async t => {
  const {
    manager,
    SecureStorage,
    local,
    walletState,
    phraseA,
    phraseB,
    rejectCredentialWrites,
    failPartialCredentialWriteOnce
  } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const firstId = walletState.wallets[0].id
  const secondId = await manager.addImportedWallet(phraseB)
  manager.unlock = async password => ({
    success: Boolean(await SecureStorage.loadWalletSeedPhrase(firstId, password))
  })
  const before = new Map(local)
  const encrypt = SecureStorage.encrypt
  let encryptions = 0
  SecureStorage.encrypt = async (...args) => {
    if (++encryptions === 2) throw new Error('encryption unavailable')
    return encrypt.apply(SecureStorage, args)
  }
  await assert.rejects(manager.changePassword('old-password', 'new-password'))
  SecureStorage.encrypt = encrypt
  assert.equal(
    [...before].every(([key, value]) => JSON.stringify(local.get(key)) === JSON.stringify(value)),
    true
  )

  rejectCredentialWrites(true)
  await assert.rejects(manager.changePassword('old-password', 'new-password'))
  assert.equal(
    [...before].every(([key, value]) => JSON.stringify(local.get(key)) === JSON.stringify(value)),
    true
  )
  rejectCredentialWrites(false)
  failPartialCredentialWriteOnce()
  await assert.rejects(manager.changePassword('old-password', 'new-password'))
  assert.equal(
    [...before].every(([key, value]) => JSON.stringify(local.get(key)) === JSON.stringify(value)),
    true
  )
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(firstId, 'old-password')) === phraseA,
    true
  )
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(secondId, 'old-password')) === phraseB,
    true
  )
})

test('session persistence failure restores the original ciphertext and session password', async t => {
  const { manager, SecureStorage, local, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const firstId = walletState.wallets[0].id
  const secondId = await manager.addImportedWallet(phraseB)
  manager.unlock = async password => ({
    success: Boolean(await SecureStorage.loadWalletSeedPhrase(firstId, password))
  })
  const original = new Map(local)
  const saveSession = SecureStorage.saveSessionPassword
  SecureStorage.saveSessionPassword = async password => {
    if (password === 'new-password') throw new Error('session unavailable')
    return saveSession.call(SecureStorage, password)
  }

  await assert.rejects(manager.changePassword('old-password', 'new-password'))
  assert.equal(
    [...original].every(([key, value]) => JSON.stringify(local.get(key)) === JSON.stringify(value)),
    true
  )
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(firstId, 'old-password')) === phraseA,
    true
  )
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(secondId, 'old-password')) === phraseB,
    true
  )
  assert.equal((await SecureStorage.getSessionPassword()) === 'old-password', true)
  assert.equal(manager.getSessionPassword() === 'old-password', true)
})

test('concurrent password changes cannot interleave credential writes', async t => {
  const { manager, SecureStorage, walletState, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'old-password')
  const walletId = walletState.wallets[0].id
  manager.unlock = async password => ({
    success: Boolean(await SecureStorage.loadWalletSeedPhrase(walletId, password))
  })
  const encrypt = SecureStorage.encrypt
  let releaseEncryption
  let signalEncryptionStarted
  const encryptionStarted = new Promise(resolve => {
    signalEncryptionStarted = resolve
  })
  SecureStorage.encrypt = async (...args) => {
    signalEncryptionStarted()
    await new Promise(resolve => {
      releaseEncryption = resolve
    })
    return encrypt.apply(SecureStorage, args)
  }
  const first = manager.changePassword('old-password', 'new-password')
  await encryptionStarted
  await assert.rejects(
    manager.changePassword('old-password', 'another-password'),
    /already in progress/
  )
  releaseEncryption()
  assert.equal(await first, true)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase(walletId, 'new-password')) === phraseA,
    true
  )
})

test('unlock recovers only after decrypting another retained wallet credential', async t => {
  const { manager, SecureStorage, local, walletState, phraseA, phraseB, setRehydrate } =
    createHarness(t)
  await manager.importWallet(phraseA, 'password')
  const missingId = walletState.wallets[0].id
  const retainedId = await manager.addImportedWallet(phraseB)
  const retainedCiphertext = structuredClone(local.get(`seed_${retainedId}`))
  const retainedWallet = walletState.getWallet(retainedId)
  walletState.setCurrentAccount(missingId, walletState.getWallet(missingId).accounts[0].id)
  local.delete(`seed_${missingId}`)
  manager.walletCores.set(retainedId, manager.getOrCreateWalletCore(retainedId))
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()
  setRehydrate(async () => {
    walletState.wallets = [retainedWallet]
  })

  const result = await manager.unlock('password', { allowMissingCredentialRecovery: true })
  assert.equal(result.success, true)
  assert.equal(walletState.currentWalletId, retainedId)
  assert.equal(manager.getSessionPassword(), 'password')
  assert.deepEqual(local.get(`seed_${retainedId}`), retainedCiphertext)
  assert.equal(await SecureStorage.loadWalletSeedPhrase(retainedId, 'password'), phraseB)
})

test('unlock never switches wallets when the selected credential rejects the password', async t => {
  const { manager, SecureStorage, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'password')
  const selectedId = walletState.wallets[0].id
  const otherId = await manager.addImportedWallet(phraseB)
  await SecureStorage.saveWalletSeedPhrase(otherId, phraseB, 'other-password')
  walletState.setCurrentAccount(selectedId, walletState.getWallet(selectedId).accounts[0].id)
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()

  const result = await manager.unlock('other-password', { allowMissingCredentialRecovery: true })
  assert.equal(result.success, false)
  assert.equal(result.failure, 'wrong_password')
  assert.equal(walletState.currentWalletId, selectedId)
  assert.equal(manager.getSessionPassword(), null)
  assert.equal((await SecureStorage.getLoginAttempts()).failedCount, 1)
})

test('missing credentials do not count as a password failure or create a session', async t => {
  const { manager, SecureStorage, local, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'password')
  const firstId = walletState.wallets[0].id
  const secondId = await manager.addImportedWallet(phraseB)
  walletState.setCurrentAccount(firstId, walletState.getWallet(firstId).accounts[0].id)
  local.delete(`seed_${firstId}`)
  local.delete(`seed_${secondId}`)
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()

  const result = await manager.unlock('password', { allowMissingCredentialRecovery: true })
  assert.equal(result.failure, 'credential_missing')
  assert.equal((await SecureStorage.getLoginAttempts()).failedCount, 0)
  assert.equal(manager.getSessionPassword(), null)
})

test('storage read failure is an unlock operation failure and preserves credentials', async t => {
  const { manager, SecureStorage, local, walletState, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'password')
  const walletId = walletState.wallets[0].id
  const ciphertext = structuredClone(local.get(`seed_${walletId}`))
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()
  const get = globalThis.chrome.storage.local.get
  globalThis.chrome.storage.local.get = async keys => {
    if (keys === `seed_${walletId}`) throw new Error('storage unavailable')
    return get(keys)
  }

  const result = await manager.unlock('password', { allowMissingCredentialRecovery: true })
  assert.equal(result.failure, 'operation_failed')
  assert.equal((await SecureStorage.getLoginAttempts()).failedCount, 0)
  assert.equal(manager.getSessionPassword(), null)
  assert.deepEqual(local.get(`seed_${walletId}`), ciphertext)
})

test('wallet state refresh failure is not recorded as an incorrect password', async t => {
  const { manager, SecureStorage, setRehydrate, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'password')
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()
  setRehydrate(async () => {
    throw new Error('state storage unavailable')
  })

  const result = await manager.unlock('password', { allowMissingCredentialRecovery: true })
  assert.equal(result.failure, 'operation_failed')
  assert.equal((await SecureStorage.getLoginAttempts()).failedCount, 0)
  assert.equal(manager.getSessionPassword(), null)
})

test('a wallet removed during credential verification cannot become the session target', async t => {
  const { manager, SecureStorage, local, walletState, phraseA, phraseB } = createHarness(t)
  await manager.importWallet(phraseA, 'password')
  const missingId = walletState.wallets[0].id
  const retainedId = await manager.addImportedWallet(phraseB)
  walletState.setCurrentAccount(missingId, walletState.getWallet(missingId).accounts[0].id)
  local.delete(`seed_${missingId}`)
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()
  const inspect = SecureStorage.inspectEncryptedCredential
  SecureStorage.inspectEncryptedCredential = async (...args) => {
    const result = await inspect.apply(SecureStorage, args)
    if (args[0] === `seed_${retainedId}`) {
      walletState.wallets = walletState.wallets.filter(wallet => wallet.id !== retainedId)
    }
    return result
  }

  const result = await manager.unlock('password', { allowMissingCredentialRecovery: true })
  assert.equal(result.failure, 'credential_missing')
  assert.equal(manager.getSessionPassword(), null)
  assert.equal(walletState.currentWalletId, missingId)
})

test('normal unlock keeps the selected wallet and authenticates its credential', async t => {
  const { manager, SecureStorage, walletState, phraseA } = createHarness(t)
  await manager.importWallet(phraseA, 'password')
  const walletId = walletState.wallets[0].id
  manager.walletCores.set(walletId, manager.getOrCreateWalletCore(walletId))
  manager.setSessionPassword(null)
  await SecureStorage.clearSessionPassword()

  const result = await manager.unlock('password', { allowMissingCredentialRecovery: true })
  assert.equal(result.success, true)
  assert.equal(walletState.currentWalletId, walletId)
  assert.equal(manager.getSessionPassword(), 'password')
})
