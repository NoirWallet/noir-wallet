import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WALLETCONNECT_CHAIN,
  approvedNamespaces,
  parsePairingUri,
  providerRequest,
  walletConnectResult
} from '../src/core/walletconnect/protocol.ts'
import { WalletConnectController } from '../src/core/walletconnect/controller.ts'
import { WalletConnectStorage } from '../src/core/walletconnect/storage.ts'
import { isExtensionPageSender } from '../src/lib/extension-sender.ts'

const topic = 'session-topic'
const account = {
  walletId: 'wallet-1',
  accountId: 'account-1',
  label: 'Account 1',
  addresses: { transparent: 't1-address', shielded: 'u1-address' }
}
const binding = {
  ...account,
  topic,
  name: 'Example',
  url: 'https://example.com'
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('Expected asynchronous operation did not occur')
}

function proposal(id = 1, changes = {}) {
  return {
    id,
    expiryTimestamp: Math.floor(Date.now() / 1000) + 3600,
    proposer: { metadata: { name: 'Example', url: 'https://example.com/path' } },
    requiredNamespaces: {
      bip122: {
        chains: [WALLETCONNECT_CHAIN],
        methods: ['zcash_getBalance'],
        events: []
      }
    },
    optionalNamespaces: {},
    ...changes
  }
}

function request(id, method = 'zcash_getBalance', changes = {}) {
  return {
    topic,
    id,
    params: {
      chainId: WALLETCONNECT_CHAIN,
      request: { method, params: {} }
    },
    ...changes
  }
}

function harness({
  saved = [],
  savedConsumed = [],
  active = false,
  storedClient = true,
  requestHandler
} = {}) {
  let selectedAccount = account
  let persisted = structuredClone(saved)
  let persistedConsumed = structuredClone(savedConsumed)
  const listeners = new Map()
  const calls = {
    pair: [],
    approve: [],
    reject: [],
    disconnect: [],
    respond: [],
    request: [],
    failed: []
  }
  const sessions = active
    ? {
        [topic]: {
          topic,
          peer: { metadata: { name: 'Example', url: 'https://example.com' } },
          namespaces: { bip122: { methods: ['zcash_getBalance', 'zcash_signMessage'] } }
        }
      }
    : {}
  const proposals = {}
  const pendingRequests = []
  const fake = {
    on(event, handler) {
      listeners.set(event, handler)
    },
    async pair(value) {
      calls.pair.push(value)
    },
    async approveSession(value) {
      calls.approve.push(value)
      sessions[topic] = { topic, namespaces: value.namespaces }
      return { topic }
    },
    async rejectSession(value) {
      calls.reject.push(value)
    },
    async updateSession() {},
    async respondSessionRequest(value) {
      calls.respond.push(value)
    },
    async disconnectSession(value) {
      calls.disconnect.push(value)
      delete sessions[value.topic]
    },
    getActiveSessions() {
      return sessions
    },
    getPendingSessionProposals() {
      return Object.values(proposals)
    },
    getPendingSessionRequests() {
      return pendingRequests
    }
  }
  const controller = new WalletConnectController({
    enabled: true,
    createClient: async () => fake,
    getAccount: async () => selectedAccount,
    loadBindings: async () => structuredClone(persisted),
    loadConsumedRequests: async () => structuredClone(persistedConsumed),
    hasStoredClient: async () => storedClient,
    saveBindings: async next => {
      persisted = structuredClone(next)
    },
    saveConsumedRequests: async next => {
      persistedConsumed = structuredClone(next)
    },
    request: async (authorization, translated) => {
      calls.request.push({ authorization, translated })
      return requestHandler ? requestHandler(authorization, translated) : { available: '1' }
    },
    updated() {},
    async proposalReceived() {},
    failed(stage) {
      calls.failed.push(stage)
    }
  })
  return {
    controller,
    fake,
    calls,
    sessions,
    proposals,
    pendingRequests,
    emit(event, value) {
      listeners.get(event)?.(value)
    },
    setAccount(value) {
      selectedAccount = value
    },
    get persisted() {
      return persisted
    },
    get persistedConsumed() {
      return persistedConsumed
    }
  }
}

test('pairing accepts only current WalletConnect v2 links with one valid key', () => {
  const root = 'a'.repeat(64)
  const key = 'b'.repeat(64)
  const valid = `wc:${root}@2?relay-protocol=irn&symKey=${key}&expiryTimestamp=2000000000`
  assert.equal(parsePairingUri(` ${valid} `, 1_900_000_000_000), valid)
  for (const invalid of [
    `wc:${root}@1?relay-protocol=irn&symKey=${key}`,
    `wc:${root}@2?relay-protocol=other&symKey=${key}`,
    `wc:${root}@2?relay-protocol=irn&symKey=short`,
    `wc:${root}@2?relay-protocol=irn&symKey=${key}&symKey=${key}`,
    `wc:${root}@2?relay-protocol=irn&symKey=${key}&expiryTimestamp=broken`,
    `wc:${root}@2?relay-protocol=irn&symKey=${key}&expiryTimestamp=1899999999`
  ]) {
    assert.throws(() => parsePairingUri(invalid, 1_900_000_000_000))
  }
})

test('required namespaces reject other chains and unsupported methods', () => {
  const addresses = account.addresses
  assert.throws(
    () =>
      approvedNamespaces(
        proposal(1, {
          requiredNamespaces: {
            bip122: { chains: ['bip122:testnet'], methods: ['zcash_getBalance'] }
          }
        }),
        addresses
      ),
    /mainnet/
  )
  assert.throws(
    () =>
      approvedNamespaces(
        proposal(1, {
          requiredNamespaces: {
            bip122: { chains: [WALLETCONNECT_CHAIN], methods: ['zcash_deleteWallet'] }
          }
        }),
        addresses
      ),
    /Unsupported method/
  )
})

test('optional namespaces grant only requested supported mainnet capabilities', () => {
  const namespaces = approvedNamespaces(
    proposal(1, {
      optionalNamespaces: {
        bip122: {
          chains: [WALLETCONNECT_CHAIN, 'bip122:testnet'],
          methods: ['zcash_signMessage'],
          events: ['accountsChanged']
        }
      }
    }),
    account.addresses
  )
  assert.deepEqual(namespaces.bip122.methods, ['zcash_getBalance', 'zcash_signMessage'])
  assert.equal(namespaces.bip122.methods.includes('zcash_transfer'), false)
  assert.deepEqual(namespaces.bip122.chains, [WALLETCONNECT_CHAIN])
})

test('provider requests preserve the approved signing mode and precise parameters', () => {
  assert.deepEqual(providerRequest('zcash_getPublicKey', { signingMode: 'derived' }), {
    method: 'zcash_getPublicKey',
    params: [{ signingMode: 'derived' }]
  })
  assert.deepEqual(
    providerRequest('zcash_signMessage', { message: 'hello', signingMode: 'legacy_index0' }),
    {
      method: 'zcash_signMessage',
      params: ['hello', { signingMode: 'legacy_index0' }]
    }
  )
  assert.deepEqual(
    providerRequest('zcash_transfer', { to: 'u1', amount: '1', fundingSource: 'shielded' }),
    {
      method: 'zcash_sendTransaction',
      params: [{ to: 'u1', amount: '1', fundingSource: 'shielded' }]
    }
  )
  assert.deepEqual(providerRequest('zcash_getAddress', { type: 'transparent' }), {
    method: 'zcash_getAddresses',
    params: []
  })
  assert.deepEqual(
    walletConnectResult(
      'zcash_getAddress',
      { type: 'transparent' },
      {
        transparent: 't1',
        shielded: 'u1'
      }
    ),
    { account: `${WALLETCONNECT_CHAIN}:t1`, address: 't1', type: 'transparent' }
  )
  assert.throws(
    () => providerRequest('zcash_signMessage', { message: 'hello', signingMode: 'all' }),
    /signing mode/
  )
  assert.throws(
    () => providerRequest('zcash_transfer', { to: 'u1', amount: '1', walletId: 'other' }),
    /parameters/
  )
})

test('unknown proposals and invalid verification cannot be approved', async () => {
  const h = harness()
  await h.controller.start()
  await assert.rejects(h.controller.approve(999), /no longer available/)
  h.proposals[1] = proposal()
  h.emit('session_proposal', {
    id: 1,
    params: h.proposals[1],
    verifyContext: {
      verified: { validation: 'INVALID', origin: 'https://example.com', isScam: false }
    }
  })
  await until(() => h.calls.reject.length === 1)
  assert.equal((await h.controller.state()).proposals.length, 0)
  await assert.rejects(h.controller.approve(1), /no longer available/)
  assert.equal(h.calls.approve.length, 0)
})

test('unsupported proposal chains and required methods are rejected before approval', async () => {
  for (const [id, requiredNamespaces] of [
    [1, { bip122: { chains: ['bip122:testnet'], methods: ['zcash_getBalance'] } }],
    [2, { bip122: { chains: [WALLETCONNECT_CHAIN], methods: ['zcash_deleteWallet'] } }]
  ]) {
    const h = harness()
    await h.controller.start()
    h.proposals[id] = proposal(id, { requiredNamespaces })
    h.emit('session_proposal', {
      id,
      params: h.proposals[id],
      verifyContext: { verified: { validation: 'UNKNOWN', origin: 'https://example.com' } }
    })
    await until(() => h.calls.reject.length === 1)
    assert.equal((await h.controller.state()).proposals.length, 0)
    await assert.rejects(h.controller.approve(id), /no longer available/)
    assert.equal(h.calls.approve.length, 0)
  }
})

test('account switching during session approval revokes the newly opened session', async () => {
  const pending = deferred()
  const h = harness()
  h.proposals[1] = proposal()
  h.fake.approveSession = async value => {
    h.calls.approve.push(value)
    await pending.promise
    h.sessions[topic] = { topic, namespaces: value.namespaces }
    return { topic }
  }
  const approving = h.controller.approve(1)
  await until(() => h.calls.approve.length === 1)
  h.setAccount({ ...account, accountId: 'account-2' })
  pending.resolve()
  await assert.rejects(approving, /Account changed/)
  assert.deepEqual(h.persisted, [])
  assert.equal(h.calls.disconnect.length, 1)
})

test('a request emitted before approveSession resolves waits for persisted authorization', async () => {
  const pending = deferred()
  const h = harness()
  h.proposals[1] = proposal()
  h.fake.approveSession = async value => {
    h.calls.approve.push(value)
    h.sessions[topic] = { topic, namespaces: value.namespaces }
    h.emit('session_request', request(7))
    await pending.promise
    return { topic }
  }
  const approving = h.controller.approve(1)
  await until(() => h.calls.approve.length === 1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.request.length, 0)
  assert.equal(h.calls.respond.length, 0)
  pending.resolve()
  await approving
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.request.length, 1)
  assert.equal(h.calls.respond[0].response.error, undefined)
  assert.equal(h.persisted.length, 1)
})

test('metadata URL and orphan SDK sessions never create local authorization', async () => {
  const h = harness({ active: true, storedClient: true })
  h.fake.disconnectSession = async value => {
    h.calls.disconnect.push(value)
    throw new Error('relay offline')
  }
  await h.controller.start()
  assert.deepEqual((await h.controller.state()).sessions, [])
  assert.equal(h.calls.disconnect.length, 1)
  assert.deepEqual(h.persisted, [])
  h.emit('session_request', request(1))
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.request.length, 0)
})

test('worker restart restores only the persisted account binding', async () => {
  const h = harness({ saved: [binding], active: true })
  await h.controller.start()
  assert.equal((await h.controller.state()).sessions[0].topic, topic)
  assert.equal(h.calls.disconnect.length, 0)
  h.emit('session_request', request(1))
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.request.length, 1)
})

test('unknown sessions, ungranted methods and chains fail before reaching the wallet', async () => {
  const h = harness({ saved: [binding], active: true })
  await h.controller.start()
  h.emit('session_request', { ...request(1), topic: 'unknown-topic' })
  h.emit('session_request', request(2, 'zcash_transfer'))
  h.emit(
    'session_request',
    request(3, 'zcash_getBalance', {
      params: { ...request(3).params, chainId: 'bip122:testnet' }
    })
  )
  await until(() => h.calls.respond.length === 3)
  assert.equal(h.calls.request.length, 0)
  assert.deepEqual(
    h.calls.respond.map(item => item.response.error.code),
    [4100, 4100, 5100]
  )
})

test('account switch and lock revoke locally even when remote disconnect fails', async () => {
  for (const next of [{ ...account, accountId: 'account-2' }, null]) {
    const h = harness({ saved: [binding], active: true })
    h.fake.disconnectSession = async value => {
      h.calls.disconnect.push(value)
      throw new Error('relay offline')
    }
    await h.controller.start()
    h.setAccount(next)
    await h.controller.accountChanged()
    assert.deepEqual(h.persisted, [])
    assert.deepEqual((await h.controller.state()).sessions, [])
    h.emit('session_request', request(1))
    await until(() => h.calls.respond.length === 1)
    assert.equal(h.calls.request.length, 0)
    assert.equal(h.calls.respond[0].response.error.code, 4100)
  }
})

test('manual disconnect removes the local binding when the relay is offline', async () => {
  const h = harness({ saved: [binding], active: true })
  h.fake.disconnectSession = async value => {
    h.calls.disconnect.push(value)
    throw new Error('relay offline')
  }
  await h.controller.start()
  await h.controller.disconnect(topic)
  assert.deepEqual(h.persisted, [])
  assert.deepEqual((await h.controller.state()).sessions, [])
  h.emit('session_request', request(1))
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.request.length, 0)
})

test('in-flight authorization becomes inactive as soon as account changes', async () => {
  const pending = deferred()
  let authorization
  const h = harness({
    saved: [binding],
    active: true,
    requestHandler: async current => {
      authorization = current
      await pending.promise
      if (!current.isActive()) throw new Error('Connection ended')
      return { available: '1' }
    }
  })
  await h.controller.start()
  h.emit('session_request', request(1))
  await until(() => authorization !== undefined)
  assert.equal(authorization.isActive(), true)
  h.setAccount(null)
  await h.controller.accountChanged()
  assert.equal(authorization.isActive(), false)
  pending.resolve()
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.respond[0].response.error.code, -32603)
})

test('a queued request cannot sign after the selected account changes', async () => {
  const first = deferred()
  const h = harness({
    saved: [binding],
    active: true,
    requestHandler: async (_authorization, translated) => {
      if (translated.method === 'zcash_getBalance') return first.promise
      return 'signed'
    }
  })
  await h.controller.start()
  h.emit('session_request', request(1))
  await until(() => h.calls.request.length === 1)
  h.emit(
    'session_request',
    request(2, 'zcash_signMessage', {
      params: {
        chainId: WALLETCONNECT_CHAIN,
        request: { method: 'zcash_signMessage', params: { message: 'hello' } }
      }
    })
  )
  h.setAccount({ ...account, accountId: 'account-2' })
  first.resolve({ available: '1' })
  await until(() => h.calls.respond.length === 2)
  assert.equal(h.calls.request.length, 1)
  assert.equal(h.calls.respond[1].response.error.code, 4100)
  assert.deepEqual(h.persisted, [])
})

test('duplicate in-flight topic/id request invokes the wallet once', async () => {
  const pending = deferred()
  const h = harness({ saved: [binding], active: true, requestHandler: () => pending.promise })
  await h.controller.start()
  const event = request(10)
  h.emit('session_request', event)
  h.emit('session_request', event)
  await until(() => h.calls.request.length === 1)
  pending.resolve({ available: '1' })
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.request.length, 1)
  assert.equal(h.calls.respond.length, 1)
})

test('replaying a completed topic/id cannot execute the wallet again', async () => {
  const h = harness({ saved: [binding], active: true })
  await h.controller.start()
  const event = request(10)
  h.emit('session_request', event)
  await until(() => h.calls.respond.length === 1)
  await new Promise(resolve => setImmediate(resolve))
  h.emit('session_request', event)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.request.length, 1)
})

test('a sensitive request receipt survives worker restart and prevents a second signature', async () => {
  const sign = request(42, 'zcash_signMessage', {
    params: {
      chainId: WALLETCONNECT_CHAIN,
      request: { method: 'zcash_signMessage', params: { message: 'hello' } }
    }
  })
  const first = harness({ saved: [binding], active: true, requestHandler: async () => 'signature' })
  await first.controller.start()
  first.emit('session_request', sign)
  await until(() => first.calls.respond.length === 1)
  assert.equal(first.calls.request.length, 1)
  assert.ok(first.persistedConsumed.includes(`${topic}:42`))

  const restarted = harness({
    saved: first.persisted,
    savedConsumed: first.persistedConsumed,
    active: true,
    requestHandler: async () => assert.fail('Duplicate request reached the wallet')
  })
  await restarted.controller.start()
  restarted.emit('session_request', sign)
  await until(() => restarted.calls.respond.length === 1)
  assert.equal(restarted.calls.request.length, 0)
  assert.ok(restarted.calls.respond[0].response.error)
})

test('address rotation during approval cannot leave a newly authorized session on stale addresses', async () => {
  const h = harness()
  h.proposals[1] = proposal()
  const approve = h.fake.approveSession
  h.fake.approveSession = async options => {
    const session = await approve(options)
    h.setAccount({ ...account, addresses: { ...account.addresses, shielded: 'new-address' } })
    return session
  }
  await assert.rejects(h.controller.approve(1), /Account changed/)
  assert.deepEqual(h.persisted, [])
  assert.equal(h.calls.disconnect.length, 1)
})

test('a result completed after local revocation is never returned as a success', async () => {
  const pending = deferred()
  const h = harness({ saved: [binding], active: true, requestHandler: () => pending.promise })
  await h.controller.start()
  h.emit('session_request', request(90))
  await until(() => h.calls.request.length === 1)
  await h.controller.disconnect(topic)
  pending.resolve({ available: '1' })
  await until(() => h.calls.respond.length === 1)
  assert.equal(h.calls.respond[0].response.error.code, 4100)
  assert.equal('result' in h.calls.respond[0].response, false)
})

test('revoking one session clears only its sensitive replay receipts', async () => {
  const h = harness({
    saved: [binding],
    active: true,
    savedConsumed: [`${topic}:42`, 'other-topic:11']
  })
  await h.controller.start()
  await h.controller.disconnect(topic)
  assert.deepEqual(h.persistedConsumed, ['other-topic:11'])
})

test('storage adapter only reads and removes its own namespaced keys', async () => {
  const values = { session_password: 'keep', 'walletconnect_v1:pairing': { topic } }
  const area = {
    async get(key) {
      if (key === null) return { ...values }
      return Object.hasOwn(values, key) ? { [key]: values[key] } : {}
    },
    async set(next) {
      Object.assign(values, next)
    },
    async remove(key) {
      delete values[key]
    }
  }
  const storage = new WalletConnectStorage(area)
  assert.deepEqual(await storage.getKeys(), ['pairing'])
  assert.deepEqual(await storage.getEntries(), [['pairing', { topic }]])
  await storage.setItem('new', 'value')
  assert.equal(values['walletconnect_v1:new'], 'value')
  await storage.removeItem('pairing')
  assert.equal(values.session_password, 'keep')
  assert.deepEqual(await storage.getKeys(), ['new'])
})

test('WalletConnect controls accept extension pages but reject content-script senders', t => {
  const previousChrome = globalThis.chrome
  globalThis.chrome = {
    runtime: {
      id: 'extension-id',
      getURL: path => `chrome-extension://extension-id/${path}`
    }
  }
  t.after(() => { globalThis.chrome = previousChrome })

  const contentScript = { id: 'extension-id', url: 'https://example.com/app' }
  const extensionPage = { id: 'extension-id', url: 'chrome-extension://extension-id/index.html#/walletconnect' }
  for (const action of ['WALLETCONNECT_GET_STATE', 'WALLETCONNECT_APPROVE']) {
    assert.equal(isExtensionPageSender(contentScript), false, `${action} from a content script`)
    assert.equal(isExtensionPageSender(extensionPage), true, `${action} from an extension page`)
  }
})
