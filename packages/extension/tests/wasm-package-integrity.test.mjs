import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPackageLock, verifyWasmPackage } from '../../../scripts/wasm-package.mjs'

function createFixture(directory) {
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: 'zcash-wallet-wasm', type: 'module' })
  )
  writeFileSync(path.join(directory, 'zcash_wallet_wasm.js'), 'export default {}')
  writeFileSync(
    path.join(directory, 'zcash_wallet_wasm.d.ts'),
    'export default function init(): void'
  )
  writeFileSync(path.join(directory, 'zcash_wallet_wasm_bg.wasm'), 'wasm fixture')
  writeFileSync(path.join(directory, 'zcash_wallet_wasm_bg.wasm.d.ts'), 'export {}')
}

test('WASM package lock detects generated package changes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'noir-wasm-lock-test-'))
  const packageDir = path.join(directory, 'pkg')
  const lockPath = path.join(directory, 'wasm-package.lock.json')
  mkdirSync(packageDir)

  try {
    createFixture(packageDir)
    const lock = createPackageLock(packageDir, {
      repository: 'https://github.com/NoirWallet/zcash-wallet-wasm',
      commit: '0123456789abcdef0123456789abcdef01234567',
      ref: 'v1.2.3',
      target: 'web',
      profile: 'release',
      features: ['wasm-parallel'],
      artifact: {
        url: 'https://github.com/NoirWallet/zcash-wallet-wasm/releases/download/v1.2.3/pkg.tar.gz',
        sha256: 'a'.repeat(64)
      }
    })
    writeFileSync(lockPath, JSON.stringify(lock))

    assert.doesNotThrow(() => verifyWasmPackage({ packageDir, lockPath }))
    writeFileSync(path.join(packageDir, 'zcash_wallet_wasm.js'), 'changed')
    assert.throws(() => verifyWasmPackage({ packageDir, lockPath }), {
      message: 'WASM package integrity check failed: zcash_wallet_wasm.js'
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
