import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const typescript = require('typescript')
const { create } = require('zustand')

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
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createHarness(t) {
  const previousChrome = globalThis.chrome
  t.after(() => {
    globalThis.chrome = previousChrome
  })
  t.mock.method(crypto, 'getRandomValues', values => {
    values.fill(0)
    return values
  })
  const notifications = []
  const events = []
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        notifications.push(message.type)
      }
    }
  }
  const words = Array.from({ length: 24 }, (_, index) => `backup${index}`)
  let generations = 0
  const generator = {
    async generateSecurePhrase() {
      generations += 1
      return [...words]
    }
  }
  const mutations = []
  const manager = Object.fromEntries(
    ['importWallet', 'addNewWallet', 'addImportedWallet'].map(method => [
      method,
      async (...args) => {
        mutations.push({ method, args })
      }
    ])
  )
  const { useOnboardingStore } = loadModule('../src/store/onboarding-store.ts', {
    zustand: { create },
    '@/core/wallet/account-manager': { accountManager: manager },
    '@/core/wallet/mnemonic': { MnemonicGenerator: generator },
    '@/config/wallet': {
      WALLET_CONFIG: { MNEMONIC_LENGTH: 24, SECURITY: { MIN_PASSWORD_LENGTH: 8 } }
    },
    '@/lib/async-utils': loadModule('../src/lib/async-utils.ts'),
    '@/lib/errors': { classifyError: cause => ({ userMessage: cause.message }) },
    '@/lib/analytics': {
      ANALYTICS_EVENTS: { WALLET_CREATED: 'wallet_created' },
      sendAnalyticsEvent: (...args) => events.push(args)
    }
  })
  return {
    store: useOnboardingStore,
    actions: useOnboardingStore.getState(),
    generator,
    manager,
    words,
    mutations,
    notifications,
    events,
    generationCount: () => generations
  }
}

test('concurrent backup generation shares one phrase and one random confirmation', async t => {
  const { actions, store, generator, words } = createHarness(t)
  const generation = deferred()
  let calls = 0
  generator.generateSecurePhrase = async () => {
    calls += 1
    return generation.promise
  }
  const first = actions.generateSeedPhrase()
  const second = actions.generateSeedPhrase()
  assert.equal(calls, 1)
  assert.equal(store.getState().isLoading, true)
  generation.resolve(words)
  await Promise.all([first, second])
  assert.equal(store.getState().seedPhrase.join(' ') === words.join(' '), true)
  assert.deepEqual(store.getState().verificationIndices, [0, 1])
  assert.equal(store.getState().isLoading, false)
})

test('reset prevents an older generation from replacing the next flow backup', async t => {
  const { actions, store, generator, words } = createHarness(t)
  const oldGeneration = deferred()
  const newWords = words.map(word => `new-${word}`)
  generator.generateSecurePhrase = () => oldGeneration.promise
  const oldRequest = actions.generateSeedPhrase()
  actions.reset()
  generator.generateSecurePhrase = async () => newWords
  await actions.generateSeedPhrase()
  oldGeneration.resolve(words)
  await oldRequest
  assert.equal(store.getState().seedPhrase.join(' ') === newWords.join(' '), true)
  assert.equal(store.getState().error, null)
})

test('a late generation error cannot clear the loading state of a new flow', async t => {
  const { actions, store, generator, words } = createHarness(t)
  const oldGeneration = deferred()
  const nextGeneration = deferred()
  generator.generateSecurePhrase = () => oldGeneration.promise
  const oldRequest = actions.generateSeedPhrase()
  actions.reset()
  generator.generateSecurePhrase = () => nextGeneration.promise
  const newRequest = actions.generateSeedPhrase()
  oldGeneration.reject(new Error('obsolete generation error'))
  await oldRequest
  assert.equal(store.getState().isLoading, true)
  assert.equal(store.getState().error, null)
  nextGeneration.resolve(words)
  await newRequest
  assert.equal(store.getState().isLoading, false)
})

test('generation errors and malformed output cannot enable confirmation and can be retried', async t => {
  const { actions, store, generator, words } = createHarness(t)
  for (const output of [[], new Array(24), [...words.slice(0, 23), '']]) {
    generator.generateSecurePhrase = async () => output
    await actions.generateSeedPhrase()
    assert.equal(store.getState().seedPhrase.length, 0)
    assert.equal(actions.verifySeedPhrase(), false)
    assert.equal(store.getState().isLoading, false)
  }
  generator.generateSecurePhrase = async () => {
    throw new Error('generation unavailable')
  }
  await actions.generateSeedPhrase()
  assert.equal(store.getState().error, 'generation unavailable')
  generator.generateSecurePhrase = async () => words
  await actions.generateSeedPhrase()
  assert.equal(store.getState().error, null)
  assert.equal(store.getState().seedPhrase.length, 24)
})

test('duplicate recovery words are independently selectable and deselectable by position', async t => {
  const { actions, store, generator, words } = createHarness(t)
  words[1] = words[0]
  generator.generateSecurePhrase = async () => words
  await actions.generateSeedPhrase()
  actions.selectWord(0)
  actions.selectWord(1)
  assert.deepEqual(store.getState().selectedWordIndices, [0, 1])
  assert.equal(actions.verifySeedPhrase(), true)
  actions.selectWord(0)
  assert.deepEqual(store.getState().selectedWordIndices, [1])
  assert.equal(actions.verifySeedPhrase(), false)
})

test('confirmation rejects wrong order, wrong words, invalid indices, and missing words', async t => {
  const { actions, store, words } = createHarness(t)
  await actions.generateSeedPhrase()
  actions.selectWord(1)
  actions.selectWord(0)
  assert.equal(actions.verifySeedPhrase(), false)
  for (const state of [
    { verificationIndices: [], selectedWords: [] },
    { verificationIndices: [0, 0], selectedWords: [words[0], words[0]] },
    { verificationIndices: [-1, 1], selectedWords: [words[0], words[1]] },
    { verificationIndices: [0, 24], selectedWords: [words[0], words[1]] },
    { verificationIndices: [0, 1], selectedWords: new Array(2) },
    { verificationIndices: [0, 1], selectedWords: [words[2], words[1]] }
  ]) {
    store.setState(state)
    assert.equal(actions.verifySeedPhrase(), false)
  }
  store.setState({ verificationIndices: [0, 1], selectedWords: [words[0], words[1]] })
  assert.equal(actions.verifySeedPhrase(), true)
  assert.equal(store.getState().error, null)
})

test('selection is limited to two real word positions and a replacement clears confirmation', async t => {
  const { actions, store, words } = createHarness(t)
  await actions.generateSeedPhrase()
  for (const index of [-1, 24, 0.5, 0, 1, 2]) actions.selectWord(index)
  assert.deepEqual(store.getState().selectedWordIndices, [0, 1])
  actions.setAcknowledgedWarning(true)
  actions.setSeedPhrase(words.map(word => `new-${word}`))
  assert.equal(store.getState().selectedWords.length, 0)
  assert.equal(store.getState().selectedWordIndices.length, 0)
  assert.equal(store.getState().acknowledgedWarning, false)
  assert.equal(actions.verifySeedPhrase(), false)
})

test('unverified or repeated creation cannot persist a different or duplicate wallet', async t => {
  const { actions, store, manager, words, mutations, notifications, events } = createHarness(t)
  assert.equal(await actions.createWallet(), false)
  assert.equal(await actions.addWallet(), false)
  assert.equal(mutations.length, 0)
  await actions.generateSeedPhrase()
  actions.selectWord(0)
  actions.selectWord(1)
  const creation = deferred()
  manager.addNewWallet = async phrase => {
    mutations.push({ method: 'addNewWallet', args: [phrase] })
    return creation.promise
  }
  const first = actions.addWallet()
  assert.equal(await actions.addWallet(), false)
  actions.selectWord(0)
  assert.deepEqual(store.getState().selectedWordIndices, [0, 1])
  creation.resolve()
  assert.equal(await first, true)
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].args[0] === words.join(' '), true)
  assert.deepEqual(notifications, ['WALLET_CREATED'])
  assert.equal(events.length, 1)
})

test('a creation failure keeps the backed up phrase for a safe retry', async t => {
  const { actions, store, manager, words, notifications, events } = createHarness(t)
  await actions.generateSeedPhrase()
  actions.selectWord(0)
  actions.selectWord(1)
  manager.importWallet = async () => {
    throw new Error('storage unavailable')
  }
  assert.equal(await actions.createWallet(), false)
  assert.equal(store.getState().seedPhrase.join(' ') === words.join(' '), true)
  assert.equal(store.getState().isLoading, false)
  assert.deepEqual(notifications, [])
  assert.equal(events.length, 0)
  manager.importWallet = async () => {}
  assert.equal(await actions.createWallet(), true)
})

for (const [actionName, managerMethod] of [
  ['importWallet', 'importWallet'],
  ['addImportedWallet', 'addImportedWallet']
]) {
  test(`${actionName} passes the supplied backup and birthday without generating another phrase`, async t => {
    const { actions, mutations, words, generationCount } = createHarness(t)
    actions.setImportedSeedPhrase(words.join(' '))
    actions.setPassword('test-password')
    actions.setBirthdayHeight(123)
    assert.equal(await actions[actionName](), true)
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0].method, managerMethod)
    assert.equal(mutations[0].args[0] === words.join(' '), true)
    assert.equal(mutations[0].args.at(-1), 123)
    assert.equal(generationCount(), 0)
  })

  test(`${actionName} ignores an obsolete failure after the backup changes`, async t => {
    const { actions, store, manager, words, notifications, events } = createHarness(t)
    const importResult = deferred()
    manager[managerMethod] = () => importResult.promise
    actions.setImportedSeedPhrase(words.join(' '))
    const request = actions[actionName]()
    actions.setImportedSeedPhrase(words.map(word => `other-${word}`).join(' '))
    importResult.reject(new Error('obsolete import failure'))
    assert.equal(await request, false)
    assert.equal(store.getState().error, null)
    assert.equal(store.getState().isLoading, false)
    assert.deepEqual(notifications, [])
    assert.equal(events.length, 0)
  })
}

test('reset clears all recovery material while preserving the pending dApp request', async t => {
  const { actions, store, words } = createHarness(t)
  await actions.generateSeedPhrase()
  actions.selectWord(0)
  actions.setPassword('test-password')
  actions.setConfirmPassword('test-password')
  actions.setImportedSeedPhrase(words.join(' '))
  actions.setDappRequestId('pending-request')
  actions.reset()
  const state = store.getState()
  assert.equal(state.password.length, 0)
  assert.equal(state.confirmPassword.length, 0)
  assert.equal(state.importedSeedPhrase.length, 0)
  assert.equal(state.seedPhrase.length, 0)
  assert.equal(state.selectedWords.length, 0)
  assert.equal(state.selectedWordIndices.length, 0)
  assert.equal(state.verificationIndices.length, 0)
  assert.equal(state.dappRequestId, 'pending-request')
})
