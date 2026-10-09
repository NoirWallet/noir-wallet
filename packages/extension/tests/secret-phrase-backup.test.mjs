import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

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

const { getWalletsNeedingSecretPhraseBackup } = loadModule(
  '../src/core/wallet/secret-phrase-backup.ts'
)
const cutoff = Date.parse('2026-09-24T00:00:00+08:00')

function wallet(id, updates = {}) {
  return {
    id,
    name: `Wallet ${cutoff}`,
    seedPhraseKey: `seed_${id}`,
    createdAt: cutoff,
    isPinned: false,
    accounts: [{ id: `${id}-account`, name: 'Account 1', derivationIndex: 0 }],
    ...updates
  }
}

test('legacy candidates use creation time and raw metadata, independent of list position', () => {
  const later = wallet('later', { createdAt: cutoff + 10 })
  const equalB = wallet('b')
  const equalA = wallet('a')
  const first = wallet('first', { name: 'Wallet 1', createdAt: cutoff - 1 })
  const wallets = [later, first, equalB, equalA]
  assert.deepEqual(
    getWalletsNeedingSecretPhraseBackup(wallets).map(item => item.id),
    ['a', 'b', 'later']
  )
  assert.deepEqual(
    getWalletsNeedingSecretPhraseBackup(wallets.filter(item => item.id !== 'first')).map(
      item => item.id
    ),
    ['a', 'b', 'later']
  )
  assert.equal(
    getWalletsNeedingSecretPhraseBackup([wallet('before', { createdAt: cutoff - 1 })]).length,
    0
  )
  assert.equal(getWalletsNeedingSecretPhraseBackup([wallet('boundary')]).length, 1)
})

test('imports, hardware, renamed raw wallets, and ambiguous primary accounts are excluded', () => {
  const candidates = [
    wallet('first', { name: 'Wallet 1' }),
    wallet('renamed', { name: 'Savings' }),
    wallet('custom', { name: 'Wallet custom' }),
    wallet('imported', {
      accounts: [{ id: 'a', name: 'Imported Account', derivationIndex: 0 }]
    }),
    wallet('hardware', { keySource: 'ledger' }),
    wallet('unknown-source', { keySource: 'unknown' }),
    wallet('ambiguous', {
      accounts: [
        { id: 'a', name: 'Account 1', derivationIndex: 0 },
        { id: 'b', name: 'Account 1', derivationIndex: 0 }
      ]
    }),
    wallet('derived-only', { accounts: [{ id: 'a', name: 'Account 1', derivationIndex: 1 }] }),
    wallet('software', { keySource: 'software' })
  ]
  assert.deepEqual(
    getWalletsNeedingSecretPhraseBackup(candidates).map(item => item.id),
    ['software']
  )
})

test('valid markers suppress reminders while malformed markers do not', () => {
  for (const field of ['secretPhraseCreationRevision', 'secretPhraseBackupVerifiedAt']) {
    for (const value of [1, 2, 1_800_000_000_000]) {
      assert.equal(
        getWalletsNeedingSecretPhraseBackup([wallet('marked', { [field]: value })]).length,
        0
      )
    }
    for (const value of [0, -1, 0.5, '1', null, NaN, Infinity]) {
      assert.equal(
        getWalletsNeedingSecretPhraseBackup([wallet('malformed', { [field]: value })]).length,
        1
      )
    }
  }
})

function createHarness(t) {
  const previousChrome = globalThis.chrome
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const previousError = console.error
  console.error = () => {}
  let lockQueue = Promise.resolve()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(_name, callback) {
          const result = lockQueue.then(() => callback())
          lockQueue = result.catch(() => {})
          return result
        }
      }
    }
  })
  t.after(() => {
    globalThis.chrome = previousChrome
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
    console.error = previousError
  })

  const persisted = new Map()
  let failWrites = false
  let holdWrite = null
  const storage = {
    async getItem(key) {
      return structuredClone(persisted.get(key) ?? null)
    },
    async setItem(key, value) {
      if (holdWrite) await holdWrite.promise
      if (failWrites) throw new Error('storage unavailable')
      persisted.set(key, structuredClone(value))
    },
    async removeItem(key) {
      persisted.delete(key)
    }
  }
  function loadStore() {
    return loadModule('../src/store/wallet-store.ts', {
      zustand: require('zustand'),
      'zustand/middleware': require('zustand/middleware'),
      '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
      '@/lib/chrome-storage-adapter': { createChromeStorageAdapter: () => storage },
      '@/lib/wallet-metadata-storage': {
        async refreshWalletMetadata(hydrate) {
          await hydrate()
        },
        async removeWalletMetadata(id) {
          const saved = await storage.getItem('wallet_state')
          saved.state.wallets = saved.state.wallets.filter(wallet => wallet.id !== id)
          await storage.setItem('wallet_state', saved)
        }
      },
      '@/core/services/lending-home-cache': { clearLendingHomeCache: async () => {} },
      '@/core/wallet/secret-phrase-backup': { getWalletsNeedingSecretPhraseBackup }
    }).useWalletStore
  }
  const store = loadStore()
  const phrases = new Map([
    ['target', Array.from({ length: 24 }, (_, index) => `actual${index}`).join(' ')],
    ['other', Array.from({ length: 24 }, (_, index) => `other${index}`).join(' ')]
  ])
  const SecureStorage = {
    async loadWalletSeedPhrase(id, password) {
      return password === 'session-password' ? (phrases.get(id) ?? null) : null
    },
    async clearSessionPassword() {},
    async clearLastActivityTime() {}
  }
  function createManager(walletStore) {
    const { accountManager: manager } = loadModule('../src/core/wallet/account-manager.ts', {
      './secure-storage': { SecureStorage },
      './secret-phrase-backup': { getWalletsNeedingSecretPhraseBackup },
      '@/lib/async-utils': {
        DedupPromise: loadModule('../src/lib/async-utils.ts').DedupPromise
      },
      '@/lib/logger': { logger: { log() {}, clearCache() {} } },
      '@/store/wallet-store': {
        useWalletStore: walletStore,
        rehydrateWalletStore: () => walletStore.persist.rehydrate()
      },
      '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
      '@/lib/hardware-capabilities': {
        isHardwareKeySource: source => source === 'ledger' || source === 'keystone'
      }
    })
    manager.password = 'session-password'
    manager.clearRuntimeCaches = () => {}
    return manager
  }
  const manager = createManager(store)
  const words = phrases.get('target').split(' ')
  const verification = { wordIndices: [2, 19], words: [words[2], words[19]] }

  return {
    store,
    manager,
    SecureStorage,
    persisted,
    loadStore,
    createManager,
    verification,
    async seed() {
      store.getState().setWallets([wallet('other'), wallet('target')])
      await store.persist.rehydrate()
      await store.setState({ wallets: [wallet('other'), wallet('target')] })
    },
    failWrites(value) {
      failWrites = value
    },
    holdNextWrite() {
      let release
      const promise = new Promise(resolve => {
        release = resolve
      })
      holdWrite = { promise, release }
      return () => {
        holdWrite = null
        release()
      }
    }
  }
}

test('correct words persist only the target marker and survive reload; repeat completion is idempotent', async t => {
  const { store, manager, persisted, loadStore, verification, seed } = createHarness(t)
  await seed()
  await manager.confirmWalletBackup('target', verification)
  const marked = store.getState().getWallet('target')
  assert.ok(marked.secretPhraseBackupVerifiedAt > 0)
  assert.equal(store.getState().getWallet('other').secretPhraseBackupVerifiedAt, undefined)
  assert.equal(getWalletsNeedingSecretPhraseBackup(store.getState().wallets).length, 1)
  assert.ok(
    persisted.get('wallet_state').state.wallets.find(item => item.id === 'target')
      .secretPhraseBackupVerifiedAt
  )
  await manager.confirmWalletBackup('target', verification)
  const reloaded = loadStore()
  await reloaded.persist.rehydrate()
  assert.equal(
    reloaded.getState().getWallet('target').secretPhraseBackupVerifiedAt,
    marked.secretPhraseBackupVerifiedAt
  )
})

test('concurrent confirmations wait for the same durable write and share its failure', async t => {
  const { store, manager, verification, seed, holdNextWrite, failWrites } = createHarness(t)
  await seed()
  const release = holdNextWrite()
  let firstSettled = false
  let secondSettled = false
  const first = manager.confirmWalletBackup('target', verification).finally(() => {
    firstSettled = true
  })
  const second = manager.confirmWalletBackup('target', verification).finally(() => {
    secondSettled = true
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(firstSettled, false)
  assert.equal(secondSettled, false)
  assert.ok(store.getState().getWallet('target').secretPhraseBackupVerifiedAt)
  failWrites(true)
  release()
  await assert.rejects(first, /storage unavailable/)
  await assert.rejects(second, /storage unavailable/)
  assert.equal(store.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)
})

test('a different proof is checked while another confirmation is persisting', async t => {
  const { manager, verification, seed, holdNextWrite } = createHarness(t)
  await seed()
  const release = holdNextWrite()
  const valid = manager.confirmWalletBackup('target', verification)
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(
    manager.confirmWalletBackup('target', {
      ...verification,
      words: ['incorrect', verification.words[1]]
    }),
    /Backup words do not match/
  )
  release()
  await valid
})

test('two stale contexts keep both wallet markers and their own selection', async t => {
  const { store, manager, persisted, loadStore, createManager, verification, seed, holdNextWrite } =
    createHarness(t)
  await seed()
  await store.setState({ currentWalletId: 'other', currentAccountId: 'other-account' })
  const secondStore = loadStore()
  await secondStore.persist.rehydrate()
  const secondManager = createManager(secondStore)
  const otherWords = Array.from({ length: 24 }, (_, index) => `other${index}`)
  const otherProof = { wordIndices: [2, 19], words: [otherWords[2], otherWords[19]] }
  const release = holdNextWrite()
  const first = manager.confirmWalletBackup('target', verification)
  await new Promise(resolve => setImmediate(resolve))
  const second = secondManager.confirmWalletBackup('other', otherProof)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(secondStore.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)
  assert.equal(secondStore.getState().getWallet('other').secretPhraseBackupVerifiedAt, undefined)
  release()
  await Promise.all([first, second])
  const saved = persisted.get('wallet_state').state
  assert.ok(saved.wallets.every(item => item.secretPhraseBackupVerifiedAt > 0))
  assert.equal(saved.currentWalletId, 'other')
  assert.equal(saved.currentAccountId, 'other-account')
  assert.ok(secondStore.getState().getWallet('target').secretPhraseBackupVerifiedAt > 0)
  const reloaded = loadStore()
  await reloaded.persist.rehydrate()
  assert.ok(reloaded.getState().wallets.every(item => item.secretPhraseBackupVerifiedAt > 0))
})

test('a queued context stops when its session ends before the lock is granted', async t => {
  const { manager, persisted, loadStore, createManager, verification, seed, holdNextWrite } =
    createHarness(t)
  await seed()
  const secondStore = loadStore()
  await secondStore.persist.rehydrate()
  const secondManager = createManager(secondStore)
  const otherProof = { wordIndices: [2, 19], words: ['other2', 'other19'] }
  const release = holdNextWrite()
  const first = manager.confirmWalletBackup('target', verification)
  await new Promise(resolve => setImmediate(resolve))
  const second = secondManager.confirmWalletBackup('other', otherProof)
  await new Promise(resolve => setImmediate(resolve))
  secondManager.setSessionPassword(null)
  release()
  await first
  await assert.rejects(second)
  const saved = persisted.get('wallet_state').state.wallets
  assert.ok(saved.find(item => item.id === 'target').secretPhraseBackupVerifiedAt > 0)
  assert.equal(saved.find(item => item.id === 'other').secretPhraseBackupVerifiedAt, undefined)
})

test('failed idempotent write cannot roll back another context durable marker', async t => {
  const { manager, loadStore, createManager, verification, seed, failWrites, persisted } =
    createHarness(t)
  await seed()
  const secondStore = loadStore()
  await secondStore.persist.rehydrate()
  const secondManager = createManager(secondStore)
  await manager.confirmWalletBackup('target', verification)
  failWrites(true)
  await assert.rejects(
    secondManager.confirmWalletBackup('target', verification),
    /storage unavailable/
  )
  assert.ok(secondStore.getState().getWallet('target').secretPhraseBackupVerifiedAt > 0)
  assert.ok(
    persisted.get('wallet_state').state.wallets.find(item => item.id === 'target')
      .secretPhraseBackupVerifiedAt > 0
  )
})

test('hydrating a historical wallet never adds creation or backup markers', async t => {
  const { store, persisted, loadStore } = createHarness(t)
  const historical = wallet('historical')
  await store.setState({ wallets: [historical] })
  const reloaded = loadStore()
  await reloaded.persist.rehydrate()
  const hydrated = reloaded.getState().getWallet('historical')
  assert.equal(hydrated.secretPhraseCreationRevision, undefined)
  assert.equal(hydrated.secretPhraseBackupVerifiedAt, undefined)
  assert.equal(
    persisted.get('wallet_state').state.wallets[0].secretPhraseCreationRevision,
    undefined
  )
})

test('wrong wallet, wrong words, and invalid positions cannot mark a backup', async t => {
  const { store, manager, verification, seed } = createHarness(t)
  await seed()
  for (const proof of [
    { ...verification, words: ['wrong', verification.words[1]] },
    { ...verification, wordIndices: [2, 2] },
    { ...verification, wordIndices: [-1, 19] },
    { ...verification, words: ['', verification.words[1]] }
  ]) {
    await assert.rejects(manager.confirmWalletBackup('target', proof))
  }
  await assert.rejects(manager.confirmWalletBackup('other', verification))
  assert.equal(store.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)
  assert.equal(store.getState().getWallet('other').secretPhraseBackupVerifiedAt, undefined)
})

test('locking or deleting the target while reading its phrase prevents completion', async t => {
  const { store, manager, SecureStorage, verification, seed } = createHarness(t)
  await seed()
  const load = SecureStorage.loadWalletSeedPhrase
  let release
  SecureStorage.loadWalletSeedPhrase = async (...args) => {
    await new Promise(resolve => {
      release = resolve
    })
    return load(...args)
  }
  const locked = manager.confirmWalletBackup('target', verification)
  manager.setSessionPassword(null)
  release()
  await assert.rejects(locked)
  assert.equal(store.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)

  manager.setSessionPassword('session-password')
  const deleted = manager.confirmWalletBackup('target', verification)
  await store.getState().removeWallet('target')
  release()
  await assert.rejects(deleted)
  assert.equal(store.getState().getWallet('target'), undefined)
})

test('locking and restoring the same password during phrase loading still cancels completion', async t => {
  const { store, manager, SecureStorage, verification, seed } = createHarness(t)
  await seed()
  const load = SecureStorage.loadWalletSeedPhrase
  let release
  SecureStorage.loadWalletSeedPhrase = async (...args) => {
    await new Promise(resolve => {
      release = resolve
    })
    return load(...args)
  }
  const completion = manager.confirmWalletBackup('target', verification)
  await manager.lock()
  manager.setSessionPassword('session-password')
  release()
  await assert.rejects(completion)
  assert.equal(store.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)
})

test('a session change during persistence rolls back the marker', async t => {
  const { store, manager, verification, seed, holdNextWrite } = createHarness(t)
  await seed()
  const release = holdNextWrite()
  const completion = manager.confirmWalletBackup('target', verification)
  await new Promise(resolve => setImmediate(resolve))
  manager.setSessionPassword(null)
  release()
  await assert.rejects(completion)
  assert.equal(store.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)
})

test('storage failure restores only the backup field and keeps other wallet changes', async t => {
  const { store, manager, verification, seed, failWrites, holdNextWrite } = createHarness(t)
  await seed()
  const release = holdNextWrite()
  const completion = manager.confirmWalletBackup('target', verification)
  const rejected = assert.rejects(completion, /storage unavailable/)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(store.getState().getWallet('target').secretPhraseBackupVerifiedAt)
  failWrites(true)
  const pinWrite = assert.rejects(
    store.setState(state => ({
      wallets: state.wallets.map(item => (item.id === 'other' ? { ...item, isPinned: true } : item))
    })),
    /storage unavailable/
  )
  release()
  await Promise.all([rejected, pinWrite])
  assert.equal(store.getState().getWallet('target').secretPhraseBackupVerifiedAt, undefined)
  assert.equal(store.getState().getWallet('other').isPinned, true)
  assert.equal(getWalletsNeedingSecretPhraseBackup(store.getState().wallets).length, 2)
  failWrites(false)
  await manager.confirmWalletBackup('target', verification)
  assert.ok(store.getState().getWallet('target').secretPhraseBackupVerifiedAt)
})
