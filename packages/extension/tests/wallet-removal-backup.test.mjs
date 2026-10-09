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
  t.after(() => {
    globalThis.chrome = previousChrome
  })

  const stored = new Map()
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
    runtime: {
      async sendMessage(message) {
        effects.push(message.type)
        if (message.type === 'REMOVE_INTENTS_PROGRESS_FOR_ACCOUNTS' && holdIntentsProgress) {
          await holdIntentsProgress
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
  const manager = loadManager({
    './secure-storage': { SecureStorage },
    '@/store/wallet-store': { useWalletStore: { getState: () => walletState } },
    '@/store/account-data-store': {
      useAccountDataStore: {
        getState: () => ({
          async deleteAccountData() {
            effects.push('deleteAccountData')
          }
        })
      },
      buildAccountKey: (_, walletId, accountId) => `${walletId}:${accountId}`
    },
    '@/config/networks': { DEFAULT_NETWORK: 'mainnet' },
    '@/lib/hardware-capabilities': {
      isHardwareKeySource: source => source === 'ledger' || source === 'keystone'
    }
  })
  manager.password = 'session-password'
  manager.clearRuntimeCaches = () => effects.push('clearCaches')
  manager.purgeWalletData = async () => effects.push('purgeWalletData')

  return {
    manager,
    SecureStorage,
    stored,
    effects,
    walletState,
    actualWords,
    displayedWords,
    setUnreadable(value) {
      unreadable = value
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
    manager.setSessionPassword(null)
    manager.setSessionPassword('session-password')
    releaseLoad()
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
  const { manager, stored, walletState } = createHarness(t)
  walletState.getWallet('target').accounts.push({ id: 'derived' })
  await manager.removeAccount('target', 'derived')
  assert.equal(walletState.getWallet('target').accounts.length, 1)
  assert.equal(stored.has('target'), true)

  walletState.getWallet('target').keySource = 'ledger'
  await manager.removeAccount('target', 'target-account')
  assert.equal(walletState.getWallet('target'), undefined)

  walletState.getWallet('other').keySource = 'keystone'
  await manager.removeWallet('other')
  assert.equal(walletState.getWallet('other'), undefined)
})
