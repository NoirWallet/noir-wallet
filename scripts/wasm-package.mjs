#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const workspaceRoot = path.resolve(scriptDir, '..')
export const defaultSourceDir = path.join(workspaceRoot, 'packages/zcash-wallet-wasm/pkg')
export const defaultPackageDir = path.join(workspaceRoot, 'packages/extension/src/lib/wasm-pkg')
export const defaultLockPath = path.join(workspaceRoot, 'wasm-package.lock.json')

const REQUIRED_FILES = [
  'package.json',
  'zcash_wallet_wasm.js',
  'zcash_wallet_wasm.d.ts',
  'zcash_wallet_wasm_bg.wasm',
  'zcash_wallet_wasm_bg.wasm.d.ts'
]
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    if (entry.name === '.gitignore') continue
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`WASM package must not contain symbolic links: ${relativePath}`)
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    } else {
      throw new Error(`Unsupported WASM package entry: ${relativePath}`)
    }
  }
  return files
}

export function validatePackageDirectory(directory) {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
    throw new Error(`WASM package directory not found: ${directory}`)
  }
  for (const requiredFile of REQUIRED_FILES) {
    if (!existsSync(path.join(directory, requiredFile))) {
      throw new Error(`WASM package is missing required file: ${requiredFile}`)
    }
  }
  const packageJson = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (packageJson.name !== 'zcash-wallet-wasm' || packageJson.type !== 'module') {
    throw new Error('WASM package metadata must describe the zcash-wallet-wasm ES module')
  }
  return listFiles(directory)
}

export function collectPackageFiles(directory) {
  const manifest = {}
  for (const relativePath of validatePackageDirectory(directory)) {
    const absolutePath = path.join(directory, relativePath)
    manifest[relativePath] = {
      size: statSync(absolutePath).size,
      sha256: sha256File(absolutePath)
    }
  }
  return manifest
}

export function createPackageLock(directory, metadata) {
  const lock = {
    schemaVersion: 1,
    source: {
      repository: metadata.repository,
      commit: metadata.commit,
      ref: metadata.ref
    },
    artifact: metadata.artifact ?? null,
    build: {
      target: metadata.target,
      profile: metadata.profile,
      features: [...new Set(metadata.features)].sort()
    },
    package: {
      path: 'packages/extension/src/lib/wasm-pkg',
      files: collectPackageFiles(directory)
    }
  }
  validateLock(lock)
  return lock
}

function validateLock(lock) {
  if (lock?.schemaVersion !== 1) throw new Error('Unsupported WASM package lock schema')
  if (!/^[0-9a-f]{40}$/.test(lock.source?.commit ?? '')) {
    throw new Error('WASM package lock must contain a full source commit SHA')
  }
  if (
    !lock.source?.repository ||
    !lock.source?.ref ||
    lock.build?.target !== 'web' ||
    lock.build?.profile !== 'release' ||
    !Array.isArray(lock.build?.features) ||
    lock.build.features.length === 0 ||
    !lock.build.features.every(feature => typeof feature === 'string' && feature.length > 0) ||
    lock.package?.path !== 'packages/extension/src/lib/wasm-pkg' ||
    !lock.package?.files ||
    Array.isArray(lock.package.files) ||
    Object.keys(lock.package.files).length === 0
  ) {
    throw new Error('WASM package lock metadata is incomplete')
  }
  for (const [name, file] of Object.entries(lock.package.files)) {
    if (
      !name ||
      !Number.isInteger(file?.size) ||
      file.size < 0 ||
      !/^[0-9a-f]{64}$/.test(file?.sha256 ?? '')
    ) {
      throw new Error(`WASM package lock has invalid file metadata: ${name}`)
    }
  }
  if (lock.artifact !== null) {
    if (
      typeof lock.artifact?.url !== 'string' ||
      !/^https:\/\//.test(lock.artifact.url) ||
      !/^[0-9a-f]{64}$/.test(lock.artifact?.sha256 ?? '')
    ) {
      throw new Error('WASM artifact metadata must contain an HTTPS URL and SHA256')
    }
  }
}

function readLock(lockPath = defaultLockPath) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  validateLock(lock)
  return lock
}

export function verifyWasmPackage({
  packageDir = defaultPackageDir,
  lockPath = defaultLockPath
} = {}) {
  const lock = readLock(lockPath)
  const actualFiles = collectPackageFiles(packageDir)
  const expectedFiles = lock.package.files
  const actualNames = Object.keys(actualFiles).sort()
  const expectedNames = Object.keys(expectedFiles).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error('WASM package file list does not match wasm-package.lock.json')
  }
  for (const name of expectedNames) {
    const actual = actualFiles[name]
    const expected = expectedFiles[name]
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`WASM package integrity check failed: ${name}`)
    }
  }
  return lock
}

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function gitMaybe(directory, args) {
  try {
    return git(directory, args)
  } catch {
    return ''
  }
}

function normalizeRepositoryUrl(url) {
  return url.replace(/\.git$/, '')
}

function readLocalSource(sourceDir) {
  const repositoryDir = path.dirname(sourceDir)
  const repository = normalizeRepositoryUrl(git(repositoryDir, ['remote', 'get-url', 'origin']))
  const commit = git(repositoryDir, ['rev-parse', 'HEAD'])
  const ref =
    gitMaybe(repositoryDir, ['describe', '--tags', '--exact-match']) ||
    gitMaybe(repositoryDir, ['symbolic-ref', '--short', 'HEAD']) ||
    commit
  return { repository, commit, ref }
}

function stagePackage(sourceDir) {
  validatePackageDirectory(sourceDir)
  mkdirSync(path.dirname(defaultPackageDir), { recursive: true })
  const stageDir = mkdtempSync(path.join(path.dirname(defaultPackageDir), '.wasm-pkg-stage-'))
  cpSync(sourceDir, stageDir, {
    recursive: true,
    filter: source => path.basename(source) !== '.gitignore'
  })
  validatePackageDirectory(stageDir)
  return stageDir
}

function replacePackage(stageDir) {
  const backupDir = `${defaultPackageDir}.backup-${process.pid}`
  let backedUp = false
  try {
    if (existsSync(defaultPackageDir)) {
      renameSync(defaultPackageDir, backupDir)
      backedUp = true
    }
    renameSync(stageDir, defaultPackageDir)
  } catch (error) {
    rmSync(defaultPackageDir, { recursive: true, force: true })
    if (backedUp && existsSync(backupDir)) renameSync(backupDir, defaultPackageDir)
    throw error
  }
  if (backedUp) rmSync(backupDir, { recursive: true, force: true })
}

function commitUpdate(stageDir, lock) {
  const lockTemp = `${defaultLockPath}.tmp-${process.pid}`
  const backupDir = `${defaultPackageDir}.backup-${process.pid}`
  writeFileSync(lockTemp, `${JSON.stringify(lock, null, 2)}\n`)
  let backedUp = false
  try {
    if (existsSync(defaultPackageDir)) {
      renameSync(defaultPackageDir, backupDir)
      backedUp = true
    }
    renameSync(stageDir, defaultPackageDir)
    renameSync(lockTemp, defaultLockPath)
  } catch (error) {
    rmSync(defaultPackageDir, { recursive: true, force: true })
    if (backedUp && existsSync(backupDir)) renameSync(backupDir, defaultPackageDir)
    rmSync(lockTemp, { force: true })
    throw error
  }
  if (backedUp) rmSync(backupDir, { recursive: true, force: true })
}

function syncLockedPackage(sourceDir) {
  const lock = readLock()
  const source = readLocalSource(sourceDir)
  if (source.repository !== normalizeRepositoryUrl(lock.source.repository)) {
    throw new Error(`Local WASM repository does not match locked source: ${source.repository}`)
  }
  if (source.commit !== lock.source.commit) {
    throw new Error(
      `Local WASM commit ${source.commit.slice(0, 12)} does not match locked commit ${lock.source.commit.slice(0, 12)}`
    )
  }
  const stageDir = stagePackage(sourceDir)
  try {
    verifyWasmPackage({ packageDir: stageDir })
    replacePackage(stageDir)
    verifyWasmPackage()
    return lock
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
  }
}

function updateFromLocalSource(sourceDir, options) {
  const source = readLocalSource(sourceDir)
  const expectedRef = requiredOption(options, 'ref')
  if (source.ref !== expectedRef) {
    throw new Error(`Local WASM ref is ${source.ref}; expected ${expectedRef}`)
  }
  const metadata = {
    ...source,
    target: options.target ?? 'web',
    profile: options.profile ?? 'release',
    features: requiredOption(options, 'features')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    artifact: null
  }
  return updateWasmPackageFromDirectory(sourceDir, metadata)
}

export function updateWasmPackageFromDirectory(sourceDir, metadata) {
  const stageDir = stagePackage(sourceDir)
  try {
    const lock = createPackageLock(stageDir, metadata)
    commitUpdate(stageDir, lock)
    verifyWasmPackage()
    return lock
  } finally {
    rmSync(stageDir, { recursive: true, force: true })
  }
}

async function downloadArtifact(url, expectedSha256, destination) {
  if (!/^https:\/\//.test(url)) throw new Error('WASM artifact URL must use HTTPS')
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('WASM artifact SHA256 must be a 64-character lowercase hex digest')
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`WASM artifact download failed with HTTP ${response.status}`)
  if (!/^https:\/\//.test(response.url)) {
    throw new Error('WASM artifact redirected to a non-HTTPS URL')
  }
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ARTIFACT_BYTES) {
    throw new Error('WASM artifact exceeds the maximum supported size')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error('WASM artifact exceeds the maximum supported size')
  }
  writeFileSync(destination, bytes)
  if (sha256File(destination) !== expectedSha256) {
    throw new Error('WASM artifact checksum does not match --artifact-sha256')
  }
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!key.startsWith('--') || index + 1 >= args.length) {
      throw new Error(`Invalid argument: ${key}`)
    }
    options[key.slice(2)] = args[index + 1]
    index += 1
  }
  return options
}

function requiredOption(options, name) {
  const value = options[name]
  if (!value) throw new Error(`Missing required option --${name}`)
  return value
}

function buildMetadata(options, artifact) {
  return {
    repository: requiredOption(options, 'repository'),
    commit: requiredOption(options, 'commit'),
    ref: requiredOption(options, 'ref'),
    target: options.target ?? 'web',
    profile: options.profile ?? 'release',
    features: requiredOption(options, 'features')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
    artifact
  }
}

async function updateFromArtifact(options) {
  const url = requiredOption(options, 'artifact-url')
  const sha256 = requiredOption(options, 'artifact-sha256')
  const tempDir = mkdtempSync(path.join(tmpdir(), 'noir-wasm-artifact-'))
  try {
    const archivePath = path.join(tempDir, 'package.tar.gz')
    const extractDir = path.join(tempDir, 'extracted')
    mkdirSync(extractDir)
    await downloadArtifact(url, sha256, archivePath)
    const archiveEntries = execFileSync('tar', ['-tzf', archivePath], {
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean)
    if (
      archiveEntries.some(
        entry => entry.startsWith('/') || entry.split('/').some(segment => segment === '..')
      )
    ) {
      throw new Error('WASM artifact contains an unsafe path')
    }
    execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' })
    const candidates = [path.join(extractDir, 'pkg'), extractDir]
    const sourceDir = candidates.find(candidate => existsSync(path.join(candidate, 'package.json')))
    if (!sourceDir) throw new Error('WASM artifact must contain pkg/package.json')
    return updateWasmPackageFromDirectory(sourceDir, buildMetadata(options, { url, sha256 }))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export async function runCli(args = process.argv.slice(2)) {
  const command = args[0]
  const options = parseOptions(args.slice(1))
  if (command === 'verify') {
    const lock = verifyWasmPackage()
    console.log(`[wasm-package] Verified ${Object.keys(lock.package.files).length} files`)
    return
  }
  if (command === 'update-local') {
    const sourceDir = path.resolve(options.source ?? defaultSourceDir)
    const lock = updateFromLocalSource(sourceDir, options)
    console.log(`[wasm-package] Updated from ${lock.source.ref}@${lock.source.commit.slice(0, 12)}`)
    return
  }
  if (command === 'sync-local') {
    const sourceDir = path.resolve(options.source ?? defaultSourceDir)
    const lock = syncLockedPackage(sourceDir)
    console.log(`[wasm-package] Synced ${lock.source.ref}@${lock.source.commit.slice(0, 12)}`)
    return
  }
  if (command === 'update') {
    const lock = await updateFromArtifact(options)
    console.log(`[wasm-package] Updated from ${lock.source.ref}@${lock.source.commit.slice(0, 12)}`)
    return
  }
  throw new Error('Usage: wasm-package.mjs <verify|sync-local|update-local|update> [options]')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(`[wasm-package] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
