import { after, test } from 'node:test'
import assert from 'node:assert/strict'

const originalLocks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks')
Object.defineProperty(globalThis.navigator, 'locks', {
  configurable: true,
  value: { request: async (_name, operation) => operation() }
})
after(() => {
  if (originalLocks === undefined) delete globalThis.navigator.locks
  else Object.defineProperty(globalThis.navigator, 'locks', originalLocks)
})

test('failed lending identity lookup remains retryable with cached markets and clears on reset', async () => {
  const originalChrome = globalThis.chrome
  const originalSetTimeout = globalThis.setTimeout
  const storageArea = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {}
  }
  globalThis.chrome = {
    storage: {
      local: storageArea,
      session: storageArea,
      onChanged: { addListener: () => {}, removeListener: () => {} }
    },
    runtime: {
      sendMessage: async () => {
        throw new Error('Request timed out')
      }
    }
  }
  globalThis.setTimeout = callback => {
    queueMicrotask(callback)
    return 0
  }

  try {
    const { useWalletStore } = await import('../../../src/store/wallet-store.ts')
    const { useLendingStore } = await import('../../../src/store/lending-store.ts')
    useWalletStore.setState({ currentWalletId: 'wallet', currentAccountId: 'account' })
    useLendingStore.setState({
      accountScope: 'wallet:account',
      dataLoaded: true,
      lastRefreshedAt: Date.now()
    })

    await useLendingStore.getState().checkMcaStatus()
    assert.equal(useLendingStore.getState().mcaChecked, false)
    assert.equal(useLendingStore.getState().mcaError, 'Request timed out')
    assert.equal(useLendingStore.getState().dataLoaded, true)

    useLendingStore.getState().reset()
    assert.equal(useLendingStore.getState().mcaError, null)
    assert.equal(useLendingStore.getState().mcaChecked, false)
  } finally {
    await new Promise(resolve => setImmediate(resolve))
    globalThis.setTimeout = originalSetTimeout
    globalThis.chrome = originalChrome
  }
})
