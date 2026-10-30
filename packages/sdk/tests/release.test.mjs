import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  SDK_METADATA,
  SDK_NPM_VERSION,
  SDK_PACKAGE,
  SDK_REPOSITORY,
  SDK_WORKFLOW,
  compareVersions,
  dryRunSdkRelease,
  locateSdkArtifact,
  packageSdkCheck,
  packageSdkRelease,
  resolveSdkRelease,
  stageSdkRelease,
  validateRegistryTarget,
  validateSdkArtifact,
  verifyPublishedSdk
} from '../../../scripts/sdk-release.mjs'

const sourceSha = 'a'.repeat(40)
const env = {
  GITHUB_REPOSITORY: SDK_REPOSITORY,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_WORKFLOW_REF: `${SDK_REPOSITORY}/${SDK_WORKFLOW}@refs/heads/main`,
  GITHUB_SHA: sourceSha,
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  OPERATION: 'stage',
  CONFIRM_VERSION: '0.2.0',
  CONFIRM_SHA: sourceSha,
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'synthetic-test-token'
}
const manifest = {
  name: SDK_PACKAGE,
  version: '0.2.0',
  private: false,
  repository: { url: `https://github.com/${SDK_REPOSITORY}.git`, directory: 'packages/sdk' },
  publishConfig: { access: 'public' },
  exports: Object.fromEntries(
    ['.', './chains/zcash'].map(entry => [
      entry,
      {
        types: './dist/index.d.ts',
        import: './dist/index.mjs',
        require: './dist/index.js'
      }
    ])
  )
}
const registry = {
  name: SDK_PACKAGE,
  versions: { '0.1.9': {} },
  'dist-tags': { latest: '0.1.9' }
}
const expected = { sourceSha, runId: '123', runAttempt: '1', version: '0.2.0' }

function fixture(t, packageManifest = manifest) {
  const directory = mkdtempSync(path.join(tmpdir(), 'noir-sdk-release-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  const artifact = path.join(directory, 'artifact')
  mkdirSync(path.join(source, 'package'), { recursive: true })
  mkdirSync(path.join(source, 'packages/sdk'), { recursive: true })
  mkdirSync(artifact)
  writeFileSync(path.join(source, 'package/package.json'), JSON.stringify(packageManifest))
  writeFileSync(path.join(source, 'packages/sdk/package.json'), JSON.stringify(packageManifest))
  const filename = 'noir-wallet-sdk-0.2.0.tgz'
  execFileSync('tar', ['-czf', path.join(artifact, filename), '-C', source, 'package'])
  const bytes = readFileSync(path.join(artifact, filename))
  const metadata = {
    schemaVersion: 1,
    mode: 'release',
    packageName: SDK_PACKAGE,
    version: '0.2.0',
    repository: SDK_REPOSITORY,
    sourceSha,
    workflowSha: sourceSha,
    runId: '123',
    runAttempt: '1',
    tarball: filename,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  }
  writeFileSync(path.join(artifact, SDK_METADATA), JSON.stringify(metadata))
  return { directory, source, artifact, filename, bytes, metadata }
}

test('stages only an increased stable version on trusted main or a confirmed manual release', () => {
  const resolve = (changes = {}) => resolveSdkRelease({ env, event: {}, manifest, ...changes })
  assert.equal(resolve().should_stage, 'true')
  const push = { ...env, GITHUB_EVENT_NAME: 'push' }
  const event = { before: 'b'.repeat(40) }
  assert.equal(
    resolve({ env: push, event, previousManifest: { version: '0.1.9' } }).should_stage,
    'true'
  )
  assert.equal(resolve({ env: push, event, previousManifest: manifest }).should_stage, 'false')
  assert.throws(() => resolve({ env: push, event: { before: '0'.repeat(40) } }), /previous commit/)
  assert.throws(
    () => resolve({ env: push, event, previousManifest: { version: '0.3.0' } }),
    /increase/
  )
  assert.throws(() => resolve({ env: { ...env, CONFIRM_SHA: 'b'.repeat(40) } }), /Confirmed source/)
  assert.throws(
    () => resolve({ env: { ...env, CONFIRM_VERSION: '0.3.0' } }),
    /Confirmed SDK version/
  )
  assert.throws(() => resolve({ env: { ...env, GITHUB_REF: 'refs/heads/v2' } }), /canonical/)
  assert.throws(() => resolve({ env: { ...env, GITHUB_REPOSITORY: 'fork/wallet' } }), /canonical/)
  assert.throws(
    () =>
      resolve({
        manifest: { ...manifest, version: '0.2.0-beta.1' },
        env: { ...env, CONFIRM_VERSION: '0.2.0-beta.1' }
      }),
    /stable/
  )
  assert.throws(
    () => resolve({ env: { ...env, GITHUB_WORKFLOW_REF: 'another/workflow' } }),
    /workflow identity/
  )
  assert.equal(resolve({ env: { ...env, OPERATION: 'verify' } }).operation, 'verify')
  assert.equal(compareVersions('0.10.0', '0.9.99'), 1)
})

test('binds packed bytes to the source, run, attempt, manifest and exact file inventory', t => {
  const f = fixture(t)
  const destination = path.join(f.directory, 'packed')
  const packed = packageSdkRelease(destination, env, {
    sourceRoot: f.source,
    run(command) {
      if (command === 'git') return `${sourceSha}\n`
      writeFileSync(path.join(destination, f.filename), f.bytes)
      return JSON.stringify([{ filename: f.filename, integrity: f.metadata.integrity }])
    }
  })
  assert.deepEqual(packed, f.metadata)
  assert.deepEqual(validateSdkArtifact(destination, expected), packed)
  for (const change of [
    { sourceSha: 'b'.repeat(40) },
    { runId: '124' },
    { runAttempt: '2' },
    { version: '0.3.0' }
  ]) {
    assert.throws(
      () => validateSdkArtifact(destination, { ...expected, ...change }),
      /expected build/
    )
  }
  writeFileSync(path.join(destination, 'unexpected.json'), '{}')
  assert.throws(() => validateSdkArtifact(destination, expected), /exactly one tarball/)
  rmSync(path.join(destination, 'unexpected.json'))
  writeFileSync(
    path.join(destination, f.filename),
    Buffer.concat([f.bytes, Buffer.from('tampered')])
  )
  assert.throws(() => validateSdkArtifact(destination, expected), /checksum/)
})

test('rejects a wrong package, unsafe filename, changed publication policy or mismatched tarball manifest', t => {
  for (const packageManifest of [
    { ...manifest, name: '@other/sdk' },
    { ...manifest, version: '0.3.0' },
    { ...manifest, publishConfig: { access: 'restricted' } },
    { ...manifest, publishConfig: { access: 'public', registry: 'https://example.invalid' } },
    { ...manifest, exports: {} }
  ]) {
    const f = fixture(t, packageManifest)
    assert.throws(() => validateSdkArtifact(f.artifact, expected))
  }
  const f = fixture(t)
  writeFileSync(
    path.join(f.artifact, SDK_METADATA),
    JSON.stringify({ ...f.metadata, tarball: '../escape.tgz' })
  )
  assert.throws(() => validateSdkArtifact(f.artifact, expected), /filename/)
})

test('PR rehearsal packages are bound to their checkout and cannot enter the npm upload path', async t => {
  const f = fixture(t)
  const destination = path.join(f.directory, 'checked')
  const checkEnv = { ...env, GITHUB_REF: 'refs/pull/12/merge', GITHUB_EVENT_NAME: 'pull_request' }
  const packOptions = {
    sourceRoot: f.source,
    run(command) {
      if (command === 'git') return `${sourceSha}\n`
      writeFileSync(path.join(destination, f.filename), f.bytes)
      return JSON.stringify([{ filename: f.filename, integrity: f.metadata.integrity }])
    }
  }
  const checked = packageSdkCheck(destination, checkEnv, packOptions)
  assert.equal(checked.mode, 'check')
  assert.deepEqual(validateSdkArtifact(destination, { ...expected, mode: 'check' }), checked)
  await assert.rejects(
    stageSdkRelease(destination, expected, env, {
      run: () => assert.fail('A check artifact must never reach npm'),
      fetchImpl: () => assert.fail('A check artifact must fail before registry access')
    }),
    /mode.*expected build/
  )
  assert.throws(
    () => packageSdkRelease(path.join(f.directory, 'release'), checkEnv, packOptions),
    /canonical/
  )
})

test('rehearsal always uses credential-free npm dry-run and checks the same tarball receipt', t => {
  const f = fixture(t)
  writeFileSync(
    path.join(f.artifact, SDK_METADATA),
    JSON.stringify({ ...f.metadata, mode: 'check' })
  )
  const calls = []
  const options = {
    run(command, args, options) {
      assert.equal(command, 'npm')
      for (const key of [
        'NODE_AUTH_TOKEN',
        'NPM_TOKEN',
        'NPM_ID_TOKEN',
        'GITHUB_TOKEN',
        'ACTIONS_ID_TOKEN_REQUEST_URL',
        'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
        'GITHUB_ACTIONS'
      ]) {
        assert.equal(options.env[key], undefined)
      }
      if (args[0] === '--version') return `${SDK_NPM_VERSION}\n`
      calls.push(args)
      assert.deepEqual(args.slice(0, 3), ['stage', 'publish', path.join(f.artifact, f.filename)])
      assert.ok(args.includes('--dry-run'))
      assert.ok(args.includes('--ignore-scripts'))
      return JSON.stringify({
        [SDK_PACKAGE]: {
          name: SDK_PACKAGE,
          version: f.metadata.version,
          integrity: f.metadata.integrity
        }
      })
    }
  }
  assert.equal(
    dryRunSdkRelease(
      f.artifact,
      expected,
      {
        ...env,
        NPM_ID_TOKEN: 'synthetic-ignored',
        NODE_AUTH_TOKEN: 'synthetic-ignored',
        GITHUB_TOKEN: 'synthetic-ignored'
      },
      options
    ).mode,
    'check'
  )
  assert.equal(calls.length, 1)
  assert.deepEqual(readFileSync(path.join(f.artifact, f.filename)), f.bytes)
  assert.throws(
    () =>
      dryRunSdkRelease(f.artifact, expected, env, {
        run(command, args) {
          if (args[0] === '--version') return `${SDK_NPM_VERSION}\n`
          return JSON.stringify({
            name: SDK_PACKAGE,
            version: f.metadata.version,
            integrity: 'sha512-wrong'
          })
        }
      }),
    /dry-run receipt/
  )
})

test('refuses existing versions, a latest downgrade, registry errors and missing OIDC before invoking upload', async t => {
  validateRegistryTarget(registry, '0.2.0')
  assert.throws(() => validateRegistryTarget(registry, '0.1.9'), /already published/)
  assert.throws(() => validateRegistryTarget(registry, '0.1.8'), /advance latest/)
  const f = fixture(t)
  const run = () => assert.fail('Upload must not run')
  await assert.rejects(
    stageSdkRelease(f.artifact, expected, { ...env, ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }, { run }),
    /OIDC/
  )
  await assert.rejects(
    stageSdkRelease(f.artifact, expected, env, {
      run,
      fetchImpl: async () => ({ ok: false, status: 403 })
    }),
    /403/
  )
  await assert.rejects(
    stageSdkRelease(f.artifact, expected, env, {
      run,
      fetchImpl: async () => {
        throw new Error('network unavailable')
      }
    }),
    /network unavailable/
  )
  await assert.rejects(
    stageSdkRelease(f.artifact, expected, env, {
      run,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ ...registry, versions: { ...registry.versions, '0.2.0': {} } })
      })
    }),
    /already published/
  )
})

test('retries upload with the original bytes and build attempt, without npm credentials or package lifecycle scripts', async t => {
  const f = fixture(t)
  let fail = true
  const attempts = []
  const options = {
    fetchImpl: async () => ({ ok: true, json: async () => registry }),
    run(command, args, options) {
      assert.equal(command, 'npm')
      if (args[0] === '--version') return `${SDK_NPM_VERSION}\n`
      assert.deepEqual(args.slice(0, 2), ['stage', 'publish'])
      assert.equal(args[2], path.join(f.artifact, f.filename))
      for (const flag of ['--ignore-scripts', '--provenance', '--tag=latest', '--access=public'])
        assert.ok(args.includes(flag))
      assert.equal(args.includes('--force'), false)
      assert.equal(args.includes('--dry-run'), false)
      assert.equal(options.env.NODE_AUTH_TOKEN, undefined)
      assert.equal(options.env.NPM_CONFIG_REGISTRY, undefined)
      attempts.push(readFileSync(args[2]))
      if (fail) throw new Error('E409: check Staged Packages')
      return JSON.stringify({
        name: SDK_PACKAGE,
        version: '0.2.0',
        integrity: f.metadata.integrity,
        stageId: 'stage-123'
      })
    }
  }
  await assert.rejects(stageSdkRelease(f.artifact, expected, env, options), /E409/)
  fail = false
  const result = await stageSdkRelease(
    f.artifact,
    expected,
    {
      ...env,
      GITHUB_RUN_ATTEMPT: '2',
      NODE_AUTH_TOKEN: 'synthetic-ignored',
      NPM_CONFIG_REGISTRY: 'https://example.invalid'
    },
    options
  )
  assert.equal(result.runAttempt, '1')
  assert.equal(result.stageId, 'stage-123')
  assert.deepEqual(attempts, [f.bytes, f.bytes])
})

test('checks actual registry bytes, latest and required provenance before the independent signature audit', async t => {
  const f = fixture(t)
  const published = {
    ...manifest,
    dist: {
      integrity: f.metadata.integrity,
      tarball: 'https://registry.npmjs.org/@noir-wallet/sdk/-/sdk-0.2.0.tgz',
      attestations: {
        url: 'https://registry.npmjs.org/-/npm/v1/attestations/@noir-wallet%2Fsdk@0.2.0'
      }
    }
  }
  let packument = {
    ...registry,
    'dist-tags': { latest: '0.2.0' },
    versions: { '0.2.0': published }
  }
  let bytes = f.bytes
  const fetchImpl = async () => ({
    ok: true,
    json: async () => packument,
    arrayBuffer: async () => bytes
  })
  assert.deepEqual(await verifyPublishedSdk(f.artifact, expected, { fetchImpl }), f.metadata)
  bytes = Buffer.from('substituted')
  await assert.rejects(
    verifyPublishedSdk(f.artifact, expected, { fetchImpl }),
    /Downloaded npm tarball/
  )
  bytes = f.bytes
  packument = { ...packument, 'dist-tags': { latest: '0.3.0' } }
  await assert.rejects(verifyPublishedSdk(f.artifact, expected, { fetchImpl }), /latest/)
  packument = { ...packument, 'dist-tags': { latest: '0.2.0' } }
  published.dist.integrity = 'sha512-different'
  await assert.rejects(verifyPublishedSdk(f.artifact, expected, { fetchImpl }), /integrity/)
  published.dist.integrity = f.metadata.integrity
  published.dist.tarball = 'https://example.invalid/sdk.tgz'
  await assert.rejects(
    verifyPublishedSdk(f.artifact, expected, { fetchImpl }),
    /registry asset URL/
  )
})

test('locates only a successful build attempt of the trusted workflow and its exact nonexpired artifact', async () => {
  let run = {
    id: 123,
    run_attempt: 1,
    workflow_id: 5,
    path: SDK_WORKFLOW,
    head_branch: 'main',
    head_repository: { full_name: SDK_REPOSITORY, fork: false },
    event: 'push',
    head_sha: sourceSha,
    conclusion: 'failure'
  }
  let artifact = { id: 456, name: 'noir-sdk-0.2.0-123-1', expired: false }
  const request = async route => {
    if (route === 'actions/workflows/publish-sdk.yml') return { id: 5 }
    if (route.endsWith('/jobs?per_page=100'))
      return { jobs: [{ name: 'Build SDK package', conclusion: 'success' }] }
    if (route.includes('/artifacts?')) return { artifacts: [artifact], total_count: 1 }
    if (route.startsWith('contents/'))
      return { content: Buffer.from(JSON.stringify(manifest)).toString('base64') }
    return run
  }
  const input = { ...env, CANDIDATE_RUN_ID: '123', CANDIDATE_RUN_ATTEMPT: '1' }
  assert.deepEqual(await locateSdkArtifact(input, { request }), {
    artifact_id: '456',
    source_sha: sourceSha,
    version: '0.2.0',
    build_attempt: '1'
  })
  artifact = { ...artifact, expired: true }
  await assert.rejects(locateSdkArtifact(input, { request }), /unexpired/)
  artifact = { ...artifact, expired: false, name: 'noir-sdk-0.2.0-123-2' }
  await assert.rejects(locateSdkArtifact(input, { request }), /unexpired/)
  run = { ...run, head_branch: 'v2' }
  await assert.rejects(locateSdkArtifact(input, { request }), /trusted main/)
})
