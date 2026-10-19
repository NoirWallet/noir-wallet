import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')

function loadManager(dependencies) {
  const source = readFileSync(
    new URL('../src/core/wallet/account-manager.ts', import.meta.url),
    'utf8'
  )
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
  return module.exports.accountManager
}

function createHarness(t) {
  const previousChrome = globalThis.chrome
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const lockQueues = new Map()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request(name, callback) {
          const result = (lockQueues.get(name) ?? Promise.resolve()).then(callback)
          lockQueues.set(
            name,
            result.catch(() => {})
          )
          return result
        }
      }
    }
  })
  t.after(() => {
    globalThis.chrome = previousChrome
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete globalThis.navigator
  })

  const stored = new Map()
  const pendingCleanup = new Set()
  const deletedWallets = new Set()
  const deletedAccounts = new Set()
  const effects = []
  const actualWords = Array.from({ length: 24 }, (_, index) => `actual${index}`)
  const displayedWords = Array.from({ length: 24 }, (_, index) => `displayed${index}`)
  const credentials = new Map([
    ['target', actualWords.join(' ')],
    ['other', displayedWords.join(' ')]
  ])
  stored.set('target', 'encrypted-target-credential')
  stored.set('other', 'encrypted-other-credential')
  const wallets = [
    { id: 'target', keySource: 'software', accounts: [{ id: 'target-account' }] },
    { id: 'other', keySource: 'software', accounts: [{ id: 'other-account' }] }
  ]
  let holdIntentsProgress = null
  let removalError = null
  let failWalletPurge = false
  let resetError = null
  const walletState = {
    wallets,
    currentWalletId: 'other',
    currentAccountId: 'other-account',
    getWallet(id) {
      return this.wallets.find(wallet => wallet.id === id)
    },
    getCurrentWallet() {
      return this.getWallet(this.currentWalletId) ?? null
    },
    removeWallet(id) {
      effects.push('removeWallet')
      this.wallets = this.wallets.filter(wallet => wallet.id !== id)
      deletedWallets.add(id)
    },
    updateWallet(id, updater) {
      effects.push('updateWallet')
      this.wallets = this.wallets.map(wallet => (wallet.id === id ? updater(wallet) : wallet))
    },
    setCurrentAccount(walletId, accountId) {
      effects.push('setCurrentAccount')
      this.currentWalletId = walletId
      this.currentAccountId = accountId
    }
  }
  globalThis.chrome = {
    storage: {
      local: {
        async get() {
          return {
            wallet_cleanup_pending_ids: [...pendingCleanup],
            wallet_deleted_ids: [...deletedWallets],
            wallet_deleted_account_keys: [...deletedAccounts]
          }
        }
      }
    },
    runtime: {
      async sendMessage(message) {
        effects.push(message.type)
        if (message.type === 'REMOVE_INTENTS_PROGRESS_FOR_ACCOUNTS' && holdIntentsProgress) {
          await holdIntentsProgress
        }
        if (
          message.type === 'WALLET_REMOVED' ||
          message.type === 'WALLET_REMOVAL_COMMITTED' ||
          message.type === 'PREPARE_ACCOUNT_REMOVAL' ||
          message.type === 'FINISH_ACCOUNT_REMOVAL'
        ) {
          return removalError ? { error: removalError } : { success: true }
        }
      }
    }
  }
  let unreadable = false
  const SecureStorage = {
    async loadWalletSeedPhrase(id, password) {
      if (unreadable || password !== 'session-password') return null
      return stored.has(id) ? (credentials.get(id) ?? null) : null
    },
    async removeWalletSeedPhrase(id) {
      effects.push('removeSeed')
      stored.delete(id)
    },
    async removeHardwareWalletData() {
      effects.push('removeHardware')
    }
  }
  const dependencies = {
    './secure-storage': { SecureStorage },
    '@/store/wallet-store': {
      useWalletStore: { getState: () => walletState },
      async rehydrateWalletStore() {}
    },
    '@/store/account-data-store': {
      useAccountDataStore: {
        getState: () => ({
          async deleteAccountData() {
            effects.push('deleteAccountData')
          },
          async deleteWalletData() {
            effects.push('deleteWalletData')
          }
        })
      },
      buildAccountKey: (_, walletId, accountId) => `${walletId}:${accountId}`
    },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/lib/hardware-capabilities': {
      isHardwareKeySource: source => source === 'ledger' || source === 'keystone'
    },
    '@/lib/wallet-metadata-storage': {
      async setWalletCleanupPending(id, pending) {
        if (pending) pendingCleanup.add(id)
        else pendingCleanup.delete(id)
      },
      async setAccountDeleted(key, deleted) {
        if (deleted) deletedAccounts.add(key)
        else deletedAccounts.delete(key)
      }
    },
    '@/lib/indexed-db': {
      async blockWalletRecords() {},
      async unblockWalletRecords() {},
      async blockAccountRecords() {},
      async unblockAccountRecords() {},
      async nextUnusedDerivationIndex(_network, _walletId, highest) {
        return highest + 1
      },
      async deleteWalletRecords() {
        effects.push('deleteWalletRecords')
        if (failWalletPurge) throw new Error('IndexedDB unavailable')
      }
    },
    '../worker/client': {
      getWorkerClient: () => ({
        async reset(options) {
          effects.push(`reset:${options?.force}:${options?.strict}`)
          if (resetError) throw resetError
        }
      })
    },
    '@/lib/sync-abort': { async signalSyncAbort() {} },
    '@/lib/sync-job-store': { syncJobStore: { async remove() {} } }
  }
  const newManager = () => {
    const instance = loadManager(dependencies)
    instance.password = 'session-password'
    instance.clearRuntimeCaches = () => effects.push('clearCaches')
    instance.purgeWalletData = async () => effects.push('purgeWalletData')
    instance.discardWalletSnapshotForAccountRemoval = async () =>
      effects.push('discardWalletSnapshot')
    return instance
  }
  const manager = newManager()

  return {
    manager,
    newManager,
    SecureStorage,
    stored,
    pendingCleanup,
    deletedAccounts,
    effects,
    walletState,
    actualWords,
    displayedWords,
    setUnreadable(value) {
      unreadable = value
    },
    setRemovalError(value) {
      removalError = value
    },
    setFailWalletPurge(value) {
      failWalletPurge = value
    },
    setResetError(value) {
      resetError = value
    },
    holdIntentsProgress() {
      let release
      holdIntentsProgress = new Promise(resolve => {
        release = resolve
      })
      return release
    }
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('Expected operation did not start')
}

test('metadata deletion failure never erases hardware credentials', async t => {
  const { manager, walletState, effects, stored } = createHarness(t)
  walletState.getWallet('target').keySource = 'keystone'
  walletState.removeWallet = async () => {
    throw new Error('metadata unavailable')
  }
  await assert.rejects(manager.removeAccount('target', 'target-account'), /metadata unavailable/)
  assert.equal(stored.has('target'), true)
  assert.equal(walletState.getWallet('target').keySource, 'keystone')
  assert.equal(effects.includes('removeSeed'), false)
  assert.equal(effects.includes('removeHardware'), false)
})

test('legacy displayed backup cannot delete a wallet with a different stored credential', async t => {
  const { manager, stored, effects, walletState, actualWords, displayedWords } = createHarness(t)
  const indices = await manager.getWalletBackupWordIndices('target')
  assert.equal(indices.length, 2)
  assert.notEqual(indices[0], indices[1])
  assert.ok(indices.every(index => Number.isInteger(index) && index >= 0 && index < 24))

  await assert.rejects(
    manager.removeAccount('target', 'target-account', {
      wordIndices: indices,
      words: indices.map(index => displayedWords[index])
    }),
    /Backup words do not match this wallet/
  )
  assert.equal(walletState.wallets.length, 2)
  assert.equal(stored.get('target') === 'encrypted-target-credential', true)
  assert.deepEqual(effects, [])
})

test('stored credential words permit removal of the intended software wallet', async t => {
  const { manager, stored, effects, walletState, actualWords } = createHarness(t)
  await manager.removeAccount('target', 'target-account', {
    wordIndices: [2, 19],
    words: [` ${actualWords[2].toUpperCase()} `, actualWords[19]]
  })
  assert.equal(walletState.getWallet('target'), undefined)
  assert.equal(stored.has('target'), false)
  assert.equal(stored.has('other'), true)
  assert.ok(effects.includes('WALLET_REMOVED'))
})

test('background removal failure preserves wallet metadata and credential for retry', async t => {
  const { manager, walletState, stored, effects, setRemovalError } = createHarness(t)
  walletState.getWallet('target').keySource = 'keystone'
  setRemovalError('Sync is still running')
  await assert.rejects(manager.removeAccount('target', 'target-account'), /Sync is still running/)
  assert.ok(walletState.getWallet('target'))
  assert.equal(stored.has('target'), true)
  assert.equal(effects.includes('purgeWalletData'), false)
  setRemovalError(null)
  await manager.removeAccount('target', 'target-account')
  assert.equal(walletState.getWallet('target'), undefined)
})

test('failed local purge clears in-memory tombstone so deletion can retry', async t => {
  const { manager, effects, setFailWalletPurge } = createHarness(t)
  delete manager.purgeWalletData
  manager.waitForSyncIdle = async () => {}
  manager.isWalletActivelySyncing = () => false
  manager.resetWalletCoreSafely = async () => {}
  setFailWalletPurge(true)
  await assert.rejects(manager.purgeWalletRemnants('target'), /IndexedDB unavailable/)
  assert.equal(manager.purgingWalletIds.has('target'), false)
  setFailWalletPurge(false)
  await manager.purgeWalletRemnants('target')
  assert.equal(manager.purgingWalletIds.has('target'), true)
  assert.equal(effects.filter(effect => effect === 'deleteWalletRecords').length, 2)
})

test('purge resets an offscreen wallet without a local core and retries RPC failures', async t => {
  const { manager, effects, setResetError } = createHarness(t)
  delete manager.purgeWalletData
  manager.waitForSyncIdle = async () => {}
  manager.isWalletActivelySyncing = () => false
  setResetError(new Error('Offscreen reset failed'))
  await assert.rejects(manager.purgeWalletRemnants('target'), /Offscreen reset failed/)
  assert.equal(effects.includes('deleteWalletRecords'), false)
  assert.equal(manager.purgingWalletIds.has('target'), false)
  setResetError(null)
  await manager.purgeWalletRemnants('target')
  assert.equal(effects.filter(effect => effect === 'reset:true:true').length, 2)
  assert.equal(effects.filter(effect => effect === 'deleteWalletRecords').length, 1)
})

test('credential failure after metadata deletion is finalized by the same removal action', async t => {
  const { manager, SecureStorage, walletState, pendingCleanup, stored } = createHarness(t)
  walletState.getWallet('target').keySource = 'keystone'
  const removeSeed = SecureStorage.removeWalletSeedPhrase
  let failOnce = true
  SecureStorage.removeWalletSeedPhrase = async id => {
    if (failOnce) {
      failOnce = false
      throw new Error('Credential storage unavailable')
    }
    return removeSeed(id)
  }
  await assert.rejects(manager.removeAccount('target', 'target-account'), /storage unavailable/)
  assert.equal(walletState.getWallet('target'), undefined)
  assert.equal(stored.has('target'), true)
  assert.equal(pendingCleanup.has('target'), true)
  await manager.removeAccount('target', 'target-account')
  assert.equal(stored.has('target'), false)
  assert.equal(pendingCleanup.has('target'), false)
})

test('direct wallet removal can finalize a failed credential deletion', async t => {
  const { manager, SecureStorage, walletState, pendingCleanup, stored } = createHarness(t)
  walletState.getWallet('target').keySource = 'keystone'
  const removeHardware = SecureStorage.removeHardwareWalletData
  let failOnce = true
  SecureStorage.removeHardwareWalletData = async id => {
    if (failOnce) {
      failOnce = false
      throw new Error('Hardware credential storage unavailable')
    }
    return removeHardware(id)
  }
  await assert.rejects(manager.removeWallet('target'), /storage unavailable/)
  assert.equal(walletState.getWallet('target'), undefined)
  assert.equal(pendingCleanup.has('target'), true)
  await manager.removeWallet('target')
  assert.equal(stored.has('target'), false)
  assert.equal(pendingCleanup.has('target'), false)
})

test('a second context cannot finalize wallet cleanup while the owner is deleting credentials', async t => {
  const { manager, newManager, SecureStorage, walletState, pendingCleanup, effects } =
    createHarness(t)
  walletState.getWallet('target').keySource = 'keystone'
  const removeSeed = SecureStorage.removeWalletSeedPhrase
  let releaseSeed
  SecureStorage.removeWalletSeedPhrase = async id => {
    await new Promise(resolve => {
      releaseSeed = resolve
    })
    return removeSeed(id)
  }
  const first = manager.removeAccount('target', 'target-account')
  await waitFor(() => !!releaseSeed)
  const second = newManager().removeAccount('target', 'target-account')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pendingCleanup.has('target'), true)
  assert.equal(effects.filter(effect => effect === 'WALLET_REMOVAL_COMMITTED').length, 1)
  releaseSeed()
  await Promise.all([first, second])
  assert.equal(pendingCleanup.has('target'), false)
  assert.equal(effects.filter(effect => effect === 'WALLET_REMOVAL_COMMITTED').length, 1)
})

test('a stale account removal cannot release another context’s active guard', async t => {
  const { manager, newManager, walletState, pendingCleanup, effects } = createHarness(t)
  walletState.getWallet('target').accounts.push({ id: 'derived', derivationIndex: 1 })
  let releaseSnapshot
  manager.discardWalletSnapshotForAccountRemoval = async () =>
    new Promise(resolve => {
      releaseSnapshot = resolve
    })
  const first = manager.removeAccount('target', 'derived')
  await waitFor(() => !!releaseSnapshot)
  const second = newManager().removeAccount('target', 'derived')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pendingCleanup.has('target'), true)
  assert.equal(effects.includes('FINISH_ACCOUNT_REMOVAL'), false)
  releaseSnapshot()
  await Promise.all([first, second])
  assert.equal(pendingCleanup.has('target'), false)
  assert.equal(effects.filter(effect => effect === 'FINISH_ACCOUNT_REMOVAL').length, 1)
})

test('invalid proof, locked session, and missing or unreadable credential fail before side effects', async t => {
  const { manager, stored, effects, walletState, actualWords, setUnreadable } = createHarness(t)
  const invalid = [
    undefined,
    null,
    [],
    { wordIndices: null, words: actualWords.slice(0, 2) },
    { wordIndices: [0, 1], words: null },
    { wordIndices: '0,1', words: actualWords.slice(0, 2) },
    { wordIndices: [0, 1], words: actualWords.slice(0, 2).join(' ') },
    { wordIndices: new Array(2), words: actualWords.slice(0, 2) },
    { wordIndices: [, 1], words: actualWords.slice(0, 2) },
    { wordIndices: [0, 1], words: new Array(2) },
    { wordIndices: [0, 1], words: [, actualWords[1]] },
    { wordIndices: [0, 0], words: [actualWords[0], actualWords[0]] },
    { wordIndices: [-1, 1], words: [actualWords[0], actualWords[1]] },
    { wordIndices: [0, 24], words: [actualWords[0], actualWords[1]] },
    { wordIndices: [0.5, 1], words: [actualWords[0], actualWords[1]] },
    { wordIndices: [0, 1], words: ['', actualWords[1]] },
    { wordIndices: [0, 1], words: ['two words', actualWords[1]] }
  ]
  for (const proof of invalid) {
    await assert.rejects(manager.removeAccount('target', 'target-account', proof))
  }
  manager.password = null
  await assert.rejects(manager.getWalletBackupWordIndices('target'))
  await assert.rejects(
    manager.removeAccount('target', 'target-account', {
      wordIndices: [0, 1],
      words: actualWords.slice(0, 2)
    })
  )
  manager.password = 'session-password'
  setUnreadable(true)
  await assert.rejects(manager.getWalletBackupWordIndices('target'))
  await assert.rejects(
    manager.removeAccount('target', 'target-account', {
      wordIndices: [0, 1],
      words: actualWords.slice(0, 2)
    })
  )
  setUnreadable(false)
  stored.delete('target')
  await assert.rejects(manager.getWalletBackupWordIndices('target'))
  await assert.rejects(
    manager.removeAccount('target', 'target-account', {
      wordIndices: [0, 1],
      words: actualWords.slice(0, 2)
    })
  )
  assert.equal(walletState.wallets.length, 2)
  assert.deepEqual(effects, [])
})

test('locking during credential read cancels removal before any side effect', async t => {
  const { manager, SecureStorage, effects, walletState, actualWords } = createHarness(t)
  const load = SecureStorage.loadWalletSeedPhrase
  let releaseLoad
  SecureStorage.loadWalletSeedPhrase = async (...args) => {
    await new Promise(resolve => {
      releaseLoad = resolve
    })
    return load(...args)
  }
  const removal = manager.removeAccount('target', 'target-account', {
    wordIndices: [0, 1],
    words: actualWords.slice(0, 2)
  })
  await waitFor(() => !!releaseLoad)
  manager.password = null
  releaseLoad()
  await assert.rejects(removal)
  assert.equal(walletState.wallets.length, 2)
  assert.deepEqual(effects, [])
})

test('same-password relocking cancels both challenge loading and removal', async t => {
  const { manager, SecureStorage, effects, walletState, actualWords } = createHarness(t)
  const load = SecureStorage.loadWalletSeedPhrase
  let releaseLoad
  SecureStorage.loadWalletSeedPhrase = async (...args) => {
    await new Promise(resolve => {
      releaseLoad = resolve
    })
    return load(...args)
  }
  for (const start of [
    () => manager.getWalletBackupWordIndices('target'),
    () =>
      manager.removeAccount('target', 'target-account', {
        wordIndices: [0, 1],
        words: actualWords.slice(0, 2)
      })
  ]) {
    const operation = start()
    await waitFor(() => !!releaseLoad)
    manager.setSessionPassword(null)
    manager.setSessionPassword('session-password')
    releaseLoad()
    releaseLoad = undefined
    await assert.rejects(operation)
    assert.equal(walletState.wallets.length, 2)
    assert.deepEqual(effects, [])
  }
})

test('account count change during credential read is rechecked before deletion', async t => {
  const { manager, SecureStorage, effects, walletState, stored, actualWords } = createHarness(t)
  const load = SecureStorage.loadWalletSeedPhrase
  let releaseLoad
  SecureStorage.loadWalletSeedPhrase = async (...args) => {
    await new Promise(resolve => {
      releaseLoad = resolve
    })
    return load(...args)
  }
  const removal = manager.removeAccount('target', 'target-account', {
    wordIndices: [0, 1],
    words: actualWords.slice(0, 2)
  })
  await waitFor(() => !!releaseLoad)
  walletState.getWallet('other').accounts = []
  releaseLoad()
  await assert.rejects(removal, /Cannot remove the last account/)
  assert.equal(walletState.getWallet('target').accounts.length, 1)
  assert.equal(stored.has('target'), true)
  assert.deepEqual(effects, [])
})

test('locking after backup verification stops account removal before wallet purge', async t => {
  const { manager, effects, walletState, stored, actualWords, holdIntentsProgress } =
    createHarness(t)
  const release = holdIntentsProgress()
  const removal = manager.removeAccount('target', 'target-account', {
    wordIndices: [0, 1],
    words: actualWords.slice(0, 2)
  })
  await new Promise(resolve => setImmediate(resolve))
  manager.setSessionPassword(null)
  release()
  await assert.rejects(removal, /changed or locked/)
  assert.equal(walletState.getWallet('target')?.accounts.length, 1)
  assert.equal(stored.has('target'), true)
  assert.deepEqual(effects, ['REMOVE_INTENTS_PROGRESS_FOR_ACCOUNTS'])
})

test('wallet changes during the first removal message stop direct wallet deletion', async t => {
  const { manager, effects, walletState, stored, actualWords, holdIntentsProgress } =
    createHarness(t)
  const release = holdIntentsProgress()
  const removal = manager.removeWallet('target', {
    wordIndices: [0, 1],
    words: actualWords.slice(0, 2)
  })
  await new Promise(resolve => setImmediate(resolve))
  walletState.wallets[0] = { ...walletState.wallets[0], accounts: [{ id: 'replacement' }] }
  release()
  await assert.rejects(removal, /changed or locked/)
  assert.equal(walletState.getWallet('target')?.accounts[0].id, 'replacement')
  assert.equal(stored.has('target'), true)
  assert.deepEqual(effects, ['REMOVE_INTENTS_PROGRESS_FOR_ACCOUNTS'])
})

test('equivalent wallet metadata refresh does not cancel verified removal', async t => {
  const { manager, walletState, stored, actualWords, holdIntentsProgress } = createHarness(t)
  const release = holdIntentsProgress()
  const removal = manager.removeAccount('target', 'target-account', {
    wordIndices: [0, 1],
    words: actualWords.slice(0, 2)
  })
  await new Promise(resolve => setImmediate(resolve))
  walletState.wallets[0] = {
    ...walletState.wallets[0],
    accounts: walletState.wallets[0].accounts.map(account => ({ ...account }))
  }
  release()
  await removal
  assert.equal(walletState.getWallet('target'), undefined)
  assert.equal(stored.has('target'), false)
})

test('proof is bound to target wallet and direct wallet deletion is guarded', async t => {
  const { manager, stored, effects, walletState, actualWords, displayedWords } = createHarness(t)
  await assert.rejects(manager.removeWallet('target'))
  await assert.rejects(
    manager.removeWallet('target', {
      wordIndices: [3, 8],
      words: [displayedWords[3], displayedWords[8]]
    })
  )
  assert.equal(stored.has('target'), true)
  assert.equal(walletState.wallets.length, 2)
  assert.deepEqual(effects, [])

  await manager.removeWallet('target', {
    wordIndices: [3, 8],
    words: [actualWords[3], actualWords[8]]
  })
  assert.equal(stored.has('target'), false)
  assert.equal(stored.has('other'), true)
  assert.ok(effects.includes('purgeWalletData'))
})

test('derived account and hardware wallet removal remain available without backup proof', async t => {
  const { manager, stored, walletState, effects } = createHarness(t)
  walletState.getWallet('target').accounts.push({ id: 'derived' })
  await manager.removeAccount('target', 'derived')
  assert.equal(walletState.getWallet('target').accounts.length, 1)
  assert.equal(stored.has('target'), true)
  assert.ok(effects.indexOf('PREPARE_ACCOUNT_REMOVAL') < effects.indexOf('discardWalletSnapshot'))
  assert.ok(effects.indexOf('discardWalletSnapshot') < effects.indexOf('deleteAccountData'))
  assert.ok(effects.indexOf('updateWallet') < effects.indexOf('FINISH_ACCOUNT_REMOVAL'))

  walletState.getWallet('target').keySource = 'ledger'
  await manager.removeAccount('target', 'target-account')
  assert.equal(walletState.getWallet('target'), undefined)

  walletState.getWallet('other').keySource = 'keystone'
  await manager.removeWallet('other')
  assert.equal(walletState.getWallet('other'), undefined)
})

test('failed account snapshot discard retains both accounts and permits retry', async t => {
  const { manager, walletState, stored, effects } = createHarness(t)
  walletState.getWallet('target').accounts.push({ id: 'derived' })
  manager.discardWalletSnapshotForAccountRemoval = async () => {
    throw new Error('IndexedDB unavailable')
  }
  await assert.rejects(manager.removeAccount('target', 'derived'), /IndexedDB unavailable/)
  assert.equal(walletState.getWallet('target').accounts.length, 2)
  assert.equal(stored.has('target'), true)
  assert.ok(effects.includes('FINISH_ACCOUNT_REMOVAL'))
  manager.discardWalletSnapshotForAccountRemoval = async () => {}
  await manager.removeAccount('target', 'derived')
  assert.equal(walletState.getWallet('target').accounts.length, 1)
})
