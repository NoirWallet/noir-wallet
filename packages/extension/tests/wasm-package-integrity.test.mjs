import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
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

function localBuildFixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'noir-wasm-local-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const sourceRoot = path.join(directory, 'packages/zcash-wallet-wasm')
  const sourceDir = path.join(sourceRoot, 'pkg')
  const packageDir = path.join(directory, 'packages/extension/src/lib/wasm-pkg')
  const lockPath = path.join(directory, 'wasm-package.lock.json')
  const script = path.join(directory, 'scripts/wasm-package.mjs')
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(packageDir, { recursive: true })
  mkdirSync(path.dirname(script), { recursive: true })
  copyFileSync(new URL('../../../scripts/wasm-package.mjs', import.meta.url), script)
  createFixture(sourceDir)
  createFixture(packageDir)
  writeFileSync(path.join(sourceRoot, '.gitignore'), '/pkg/\n')
  writeFileSync(path.join(sourceRoot, 'Cargo.toml'), '# synthetic source\n')
  const git = (...args) =>
    execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim()
  git('init', '--quiet', '--initial-branch=main')
  git('remote', 'add', 'origin', 'https://github.com/NoirWallet/zcash-wallet-wasm.git')
  git('add', '.gitignore', 'Cargo.toml')
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'test: source fixture'
  )
  git('tag', 'v1.2.3')
  const commit = git('rev-parse', 'HEAD')
  writeFileSync(
    lockPath,
    JSON.stringify(
      createPackageLock(packageDir, {
        repository: 'https://github.com/NoirWallet/zcash-wallet-wasm',
        commit: '0'.repeat(40),
        ref: 'previous',
        target: 'web',
        profile: 'release',
        features: ['wasm-parallel']
      })
    )
  )
  writeFileSync(path.join(sourceDir, 'zcash_wallet_wasm.js'), 'export default "new build"')
  const originalLock = readFileSync(lockPath, 'utf8')
  const update = (ref = 'v1.2.3', source = sourceDir) =>
    spawnSync(
      process.execPath,
      [
        script,
        'update-local',
        '--',
        '--ref',
        ref,
        '--features',
        'wasm-parallel',
        '--source',
        source
      ],
      { encoding: 'utf8' }
    )
  const assertUnchanged = () => {
    assert.equal(readFileSync(lockPath, 'utf8'), originalLock)
    assert.doesNotThrow(() => verifyWasmPackage({ packageDir, lockPath }))
  }
  return { sourceRoot, sourceDir, packageDir, lockPath, commit, git, update, assertUnchanged }
}

test('local WASM adoption accepts a tag or full commit at a clean HEAD', t => {
  const fixture = localBuildFixture(t)
  for (const ref of ['v1.2.3', fixture.commit]) {
    const result = fixture.update(ref)
    assert.equal(result.status, 0, result.stderr)
    const lock = verifyWasmPackage(fixture)
    assert.equal(lock.source.commit, fixture.commit)
    assert.equal(lock.source.ref, ref)
    assert.equal(lock.source.repository, 'https://github.com/NoirWallet/zcash-wallet-wasm')
    assert.equal(
      readFileSync(path.join(fixture.packageDir, 'zcash_wallet_wasm.js'), 'utf8'),
      'export default "new build"'
    )
  }
})

test('local WASM adoption rejects tracked and untracked source changes without replacing the package', t => {
  const fixture = localBuildFixture(t)
  writeFileSync(path.join(fixture.sourceRoot, 'Cargo.toml'), '# changed source\n')
  let result = fixture.update()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /source checkout must be clean/)
  fixture.assertUnchanged()

  fixture.git('restore', 'Cargo.toml')
  writeFileSync(path.join(fixture.sourceRoot, 'new-source.rs'), '// untracked source\n')
  result = fixture.update()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /source checkout must be clean/)
  fixture.assertUnchanged()
})

test('local WASM adoption rejects a ref pointing away from HEAD without replacing the package', t => {
  const fixture = localBuildFixture(t)
  writeFileSync(path.join(fixture.sourceRoot, 'Cargo.toml'), '# next source version\n')
  fixture.git('add', 'Cargo.toml')
  fixture.git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'test: next source fixture'
  )
  const result = fixture.update()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /HEAD does not match --ref v1\.2\.3/)
  fixture.assertUnchanged()
})

test('local WASM adoption rejects package directories inheriting an ancestor repository', t => {
  const fixture = localBuildFixture(t)
  const source = path.join(fixture.sourceRoot, 'build/pkg')
  mkdirSync(source, { recursive: true })
  createFixture(source)
  const result = fixture.update('v1.2.3', source)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /must belong to a separate source repository/)
  fixture.assertUnchanged()
})
