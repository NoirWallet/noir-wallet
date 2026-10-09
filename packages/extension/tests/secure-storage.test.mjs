import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { SecureStorage } from '../src/core/wallet/secure-storage.ts'

const firstPhrase = Array.from({ length: 24 }, (_, index) => `first${index}`).join(' ')
const secondPhrase = Array.from({ length: 24 }, (_, index) => `second${index}`).join(' ')
const firstPassword = 'fixture-password-one'
const secondPassword = 'fixture-password-two'

const originalChrome = globalThis.chrome
let local
let session

function storageArea() {
  const values = new Map()
  const failures = { get: false, set: false, remove: false }
  return {
    values,
    failures,
    async get(keys) {
      if (failures.get) throw new Error('Storage read failed')
      const requested = typeof keys === 'string' ? [keys] : keys
      return Object.fromEntries(
        requested.filter(key => values.has(key)).map(key => [key, structuredClone(values.get(key))])
      )
    },
    async set(entries) {
      if (failures.set) throw new Error('Storage write failed')
      for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value))
    },
    async remove(keys) {
      if (failures.remove) throw new Error('Storage removal failed')
      for (const key of typeof keys === 'string' ? [keys] : keys) values.delete(key)
    }
  }
}

beforeEach(async () => {
  local = storageArea()
  session = storageArea()
  globalThis.chrome = { storage: { local, session } }
  await SecureStorage.clearSessionPassword()
})

afterEach(() => {
  globalThis.chrome = originalChrome
})

test('stores independent encrypted recovery phrases and loads each exact phrase', async () => {
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  await SecureStorage.saveWalletSeedPhrase('second', secondPhrase, secondPassword)

  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('first', firstPassword)) === firstPhrase,
    true
  )
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('second', secondPassword)) === secondPhrase,
    true
  )
  assert.equal(local.values.size, 2)
  const persisted = JSON.stringify([...local.values])
  for (const sensitive of [firstPhrase, secondPhrase, firstPassword, secondPassword]) {
    assert.equal(persisted.includes(sensitive), false)
  }
  for (const credential of local.values.values()) {
    assert.equal(typeof credential.encryptedData, 'string')
    assert.equal(typeof credential.salt, 'string')
    assert.equal(typeof credential.iv, 'string')
  }
})

test('wrong passwords, missing entries, and damaged ciphertext cannot reveal a phrase', async () => {
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  assert.equal(await SecureStorage.loadWalletSeedPhrase('first', secondPassword), null)
  assert.equal(await SecureStorage.loadWalletSeedPhrase('first', null), null)
  assert.equal(await SecureStorage.loadWalletSeedPhrase('missing', firstPassword), null)

  const credential = local.values.get('seed_first')
  local.values.set('seed_first', { ...credential, encryptedData: 'damaged' })
  assert.equal(await SecureStorage.loadWalletSeedPhrase('first', firstPassword), null)
  local.values.set('seed_first', { salt: credential.salt, iv: credential.iv })
  assert.equal(await SecureStorage.loadWalletSeedPhrase('first', firstPassword), null)
})

test('credential inspection separates absence, invalid structure, and authentication failure', async () => {
  assert.deepEqual(await SecureStorage.inspectEncryptedCredential('seed_first', firstPassword), {
    status: 'missing'
  })
  local.values.set('seed_first', { salt: 'invalid' })
  assert.deepEqual(await SecureStorage.inspectEncryptedCredential('seed_first', firstPassword), {
    status: 'invalid'
  })
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  assert.deepEqual(await SecureStorage.inspectEncryptedCredential('seed_first', secondPassword), {
    status: 'wrong_password'
  })
  assert.deepEqual(await SecureStorage.inspectEncryptedCredential('seed_first', firstPassword), {
    status: 'valid',
    data: { seedPhrase: firstPhrase }
  })
})

test('malformed decrypted seed payloads are rejected at the storage boundary', async () => {
  for (const payload of [
    null,
    {},
    { seedPhrase: 42 },
    { seedPhrase: [] },
    { seedPhrase: '' },
    { seedPhrase: '   ' }
  ]) {
    local.values.set(
      'seed_first',
      await SecureStorage.encrypt(JSON.stringify(payload), firstPassword)
    )
    assert.equal(await SecureStorage.loadWalletSeedPhrase('first', firstPassword), null)
  }
})

test('removing one recovery phrase leaves other wallet credentials available', async () => {
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  await SecureStorage.saveWalletSeedPhrase('second', secondPhrase, secondPassword)
  await SecureStorage.removeWalletSeedPhrase('first')

  assert.equal(await SecureStorage.loadWalletSeedPhrase('first', firstPassword), null)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('second', secondPassword)) === secondPhrase,
    true
  )
})

test('storage failures propagate without substituting an incorrect recovery phrase', async () => {
  local.failures.set = true
  await assert.rejects(SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword))
  assert.equal(local.values.has('seed_first'), false)

  local.failures.set = false
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  local.failures.get = true
  await assert.rejects(SecureStorage.loadWalletSeedPhrase('first', firstPassword))
  local.failures.get = false
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('first', firstPassword)) === firstPhrase,
    true
  )
})

test('re-encrypting a phrase for a new password preserves it and rejects the previous password', async () => {
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  const recovered = await SecureStorage.loadWalletSeedPhrase('first', firstPassword)
  assert.equal(recovered === firstPhrase, true)
  await SecureStorage.saveWalletSeedPhrase('first', recovered, secondPassword)

  assert.equal(await SecureStorage.loadWalletSeedPhrase('first', firstPassword), null)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('first', secondPassword)) === firstPhrase,
    true
  )
})

test('session password stays encrypted in session storage and clear preserves persistent seeds', async () => {
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  await SecureStorage.saveSessionPassword(firstPassword)

  assert.equal((await SecureStorage.getSessionPassword()) === firstPassword, true)
  assert.equal(local.values.has('session_password'), false)
  assert.equal(local.values.has('session_key_material'), false)
  assert.equal(JSON.stringify([...session.values]).includes(firstPassword), false)
  assert.equal(session.values.has('session_password'), true)
  assert.equal(session.values.has('session_key_material'), true)
  const { SecureStorage: otherContext } =
    await import('../src/core/wallet/secure-storage.ts?session-context')
  assert.equal((await otherContext.getSessionPassword()) === firstPassword, true)

  await SecureStorage.clearSessionPassword()
  assert.equal(await SecureStorage.getSessionPassword(), null)
  assert.equal(session.values.size, 0)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('first', firstPassword)) === firstPhrase,
    true
  )
})

test('lost session storage does not expose a password and persistent seed remains recoverable', async () => {
  await SecureStorage.saveWalletSeedPhrase('first', firstPhrase, firstPassword)
  await SecureStorage.saveSessionPassword(firstPassword)
  session.values.clear()

  assert.equal(await SecureStorage.getSessionPassword(), null)
  assert.equal(
    (await SecureStorage.loadWalletSeedPhrase('first', firstPassword)) === firstPhrase,
    true
  )
  await SecureStorage.clearSessionPassword()
})

test('derived encryption keys cannot be exported', async () => {
  const key = await SecureStorage.deriveKey(firstPassword, new Uint8Array(16))
  assert.equal(key.extractable, false)
  await assert.rejects(crypto.subtle.exportKey('raw', key))
})
