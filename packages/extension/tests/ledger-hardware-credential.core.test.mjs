import assert from 'node:assert/strict'
import { it } from 'node:test'
import { secp256k1 } from '@noble/curves/secp256k1'
import { HDKey } from '@scure/bip32'
import { publicKeyToAddress } from 'viem/accounts'
import {
  createLedgerMultichainHardwareCredential,
  parseStoredHardwareCredential,
  createLedgerHardwareCredential,
  legacyZcashHardwareWalletData,
  findLedgerPublicAccount
} from '../src/core/wallet/hardware-wallet-data.ts'
import { deriveLedgerBitcoinAddress } from '../src/lib/ledger/bitcoin-model.ts'
import { parseHardwareCredentialMetadata } from '../src/core/keyring/domain/hardware-credential.ts'

const key = `0x${secp256k1.getPublicKey(new Uint8Array(32).fill(3), false).reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), '')}`
const evm = {
  family: 'evm',
  accountIndex: 0,
  derivationPath: "m/44'/60'/7'/0/2",
  publicKey: key,
  address: publicKeyToAddress(key).toLowerCase()
}
const master = HDKey.fromMasterSeed(new Uint8Array(32).fill(5))
const btcRoot = master.derive("m/84'/0'/8'")
const btcReceive = deriveLedgerBitcoinAddress(btcRoot.publicExtendedKey, 'mainnet', false, 0)
const bitcoin = {
  family: 'bitcoin',
  accountIndex: 0,
  derivationPath: "m/84'/0'/8'",
  network: 'mainnet',
  xpub: btcRoot.publicExtendedKey,
  masterFingerprintHex: master.fingerprint.toString(16).padStart(8, '0'),
  publicKey: btcReceive.publicKey,
  address: btcReceive.address
}
const device = { deviceModel: 'nanoX', deviceName: 'Ledger Test' }

it('registers capabilities from actual exports and keeps logical indexes independent of device paths', () => {
  const credential = createLedgerMultichainHardwareCredential({
    ...device,
    accounts: [evm, bitcoin]
  })
  assert.equal(credential.schemaVersion, 3)
  assert.deepEqual(credential.capabilities, ['bitcoin', 'evm'])
  assert.equal(
    findLedgerPublicAccount(credential, { family: 'evm', accountIndex: 0 }).derivationPath,
    evm.derivationPath
  )
  assert.equal(findLedgerPublicAccount(credential, { family: 'solana' }), null)
  assert.deepEqual(parseStoredHardwareCredential(credential), credential)
  assert.deepEqual(
    parseHardwareCredentialMetadata({
      vendor: 'ledger',
      firmwareProfile: 'multi-app',
      capabilities: credential.capabilities
    }).capabilities,
    credential.capabilities
  )
  assert.throws(
    () =>
      parseStoredHardwareCredential({ ...credential, capabilities: ['bitcoin', 'evm', 'near'] }),
    /capabilities/
  )
  assert.throws(
    () =>
      parseHardwareCredentialMetadata({
        vendor: 'ledger',
        firmwareProfile: 'multi-app',
        capabilities: ['tron']
      }),
    /Ledger/
  )
})

it('rejects public-key, Bitcoin network, xpub path and duplicate registration tampering', () => {
  const create = accounts => createLedgerMultichainHardwareCredential({ ...device, accounts })
  assert.throws(() => create([{ ...evm, address: '0x' + '0'.repeat(40) }]), /address/)
  assert.throws(() => create([{ ...evm, derivationPath: "m/44'/60'/07'/0/2" }]), /canonical/)
  assert.throws(() => create([{ ...bitcoin, network: 'testnet' }]), /path/)
  assert.throws(() => create([{ ...bitcoin, derivationPath: "m/84'/0'/7'" }]), /xpub/)
  assert.throws(() => create([evm, { ...evm, accountIndex: 1 }]), /already registered/)
  assert.throws(() => create([{ ...bitcoin, masterFingerprintHex: '0'.repeat(64) }]), /fingerprint/)
})

it('keeps schema-2 Zcash credentials and their unavailable fingerprint intact during upgrade', () => {
  const legacy = createLedgerHardwareCredential({
    ...device,
    ufvk: 'uview1public-unfunded-vector',
    accountHdIndex: 9
  })
  assert.equal(parseStoredHardwareCredential(legacy).schemaVersion, 2)
  assert.equal(legacy.accountExport.seedFingerprintHex, '0'.repeat(64))
  const zcash = {
    family: 'zcash',
    accountIndex: 0,
    derivationPath: "m/32'/133'/9'",
    network: 'mainnet',
    ufvk: legacy.accountExport.ufvk,
    accountHdIndex: 9
  }
  const upgraded = createLedgerMultichainHardwareCredential({ ...device, accounts: [zcash, evm] })
  assert.deepEqual(legacyZcashHardwareWalletData(upgraded), legacyZcashHardwareWalletData(legacy))
  assert.throws(
    () =>
      parseStoredHardwareCredential({
        ...legacy,
        accountExport: { ...legacy.accountExport, seedFingerprintHex: '1'.repeat(64) }
      }),
    /fingerprint/
  )
})
