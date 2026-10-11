import { test as it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  packageReleaseArtifact,
  verifyReleaseArtifact
} from '../../../scripts/extension-release.mjs'
import {
  resolveReleaseSource,
  resolvePromotion,
  selectCandidateArtifact,
  validateCandidateRun,
  validateCurrentCandidate,
  validatePublicationTarget
} from '../../../scripts/extension-release-gates.mjs'

const SCRIPT = fileURLToPath(new URL('../../../scripts/extension-release.mjs', import.meta.url))
const GATE_SCRIPT = fileURLToPath(
  new URL('../../../scripts/extension-release-gates.mjs', import.meta.url)
)
const SOURCE_SHA = 'a'.repeat(40)
const WORKFLOW_SHA = 'b'.repeat(40)
const PR_HEAD_SHA = 'c'.repeat(40)
const PR_BASE_SHA = 'd'.repeat(40)

function fixture(t, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'noir-extension-release-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const output = path.join(root, 'artifact')
  for (const dir of ['dist', 'dist-testnet']) {
    mkdirSync(path.join(source, 'packages', 'extension', dir), { recursive: true })
  }
  mkdirSync(path.join(source, 'packages', 'web', 'public'), { recursive: true })
  writeFileSync(path.join(source, 'packages', 'extension', 'package.json'), '{"version":"1.0.39"}')
  writeFileSync(path.join(source, 'packages', 'extension', 'dist', 'main.zip'), 'mainnet bytes')
  writeFileSync(
    path.join(source, 'packages', 'extension', 'dist-testnet', 'test.zip'),
    'testnet bytes'
  )
  writeFileSync(path.join(source, 'CHANGELOG.md'), '## [1.0.39]\n\n### Fixed\n\n- Current fix\n')
  writeFileSync(
    path.join(source, 'packages', 'web', 'public', 'changelog.json'),
    JSON.stringify({ schemaVersion: 1, releases: { '1.0.39': { changes: ['Current fix'] } } })
  )
  const env = {
    RELEASE_MODE: options.mode ?? 'preview',
    SOURCE_SHA,
    SOURCE_REF: options.ref ?? (options.mode === 'candidate' ? 'release/1.0.39' : 'main'),
    GITHUB_REPOSITORY: 'NoirWallet/noir-wallet',
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '2',
    WORKFLOW_SHA,
    ...options.env
  }
  return { root, source, output, env }
}

function readMetadata(output) {
  return JSON.parse(readFileSync(path.join(output, 'release-metadata.json'), 'utf8'))
}

function writeMetadata(output, value) {
  writeFileSync(path.join(output, 'release-metadata.json'), `${JSON.stringify(value)}\n`)
}

describe('Extension release artifacts', () => {
  it('packages a PR preview and verifies bytes, identities, and CLI output', async t => {
    const { root, source, output, env } = fixture(t, {
      env: { PR_NUMBER: '83', PR_HEAD_SHA, PR_BASE_SHA }
    })
    env.GITHUB_OUTPUT = path.join(root, 'github-output')
    const metadata = await packageReleaseArtifact(source, output, env)
    assert.equal(metadata.artifactLabel, 'v1.0.39-pr.83.aaaaaaa')
    assert.equal(metadata.buildChannel, 'beta')
    assert.equal(metadata.prHeadSha, PR_HEAD_SHA)
    assert.deepEqual(
      metadata.assets.map(asset => asset.name),
      ['noir-wallet-v1.0.39-pr.83.aaaaaaa.zip', 'noir-wallet-v1.0.39-pr.83.aaaaaaa-testnet.zip']
    )
    const body = readFileSync(path.join(output, 'release-body.md'), 'utf8')
    assert.match(body, /Tested merge commit: \[`aaaaaaa`\]/)
    assert.match(body, /Head: `c{40}`/)
    assert.match(
      readFileSync(env.GITHUB_OUTPUT, 'utf8'),
      /artifact_label=v1\.0\.39-pr\.83\.aaaaaaa\n/
    )
    assert.deepEqual(
      verifyReleaseArtifact(output, {
        mode: 'preview',
        repository: env.GITHUB_REPOSITORY,
        runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT,
        workflowSha: WORKFLOW_SHA,
        sourceSha: SOURCE_SHA,
        version: '1.0.39'
      }),
      metadata
    )
    const cli = spawnSync(process.execPath, [SCRIPT, 'verify', output], {
      encoding: 'utf8',
      env: { ...process.env, EXPECTED_MODE: 'preview', EXPECTED_RUN_ID: '12345' }
    })
    assert.equal(cli.status, 0, cli.stderr)
  })

  it('rejects modified ZIP bytes and checksums', async t => {
    const { source, output, env } = fixture(t)
    const metadata = await packageReleaseArtifact(source, output, env)
    writeFileSync(path.join(output, metadata.assets[0].name), 'modified')
    assert.throws(() => verifyReleaseArtifact(output), /checksum or size mismatch/)
    writeFileSync(path.join(output, metadata.assets[0].name), 'mainnet bytes')
    writeFileSync(path.join(output, 'SHA256SUMS'), 'untrusted checksums\n')
    assert.throws(() => verifyReleaseArtifact(output), /SHA256SUMS does not match/)
  })

  it('labels a non-PR preview with its tested commit', async t => {
    const { source, output, env } = fixture(t)
    await packageReleaseArtifact(source, output, env)
    const body = readFileSync(path.join(output, 'release-body.md'), 'utf8')
    assert.match(body, /Tested commit: \[`aaaaaaa`\]/)
    assert.doesNotMatch(body, /Tested merge commit/)
  })

  it('rejects swapped network assets, invalid labels, and path traversal', async t => {
    const { source, output, env } = fixture(t)
    await packageReleaseArtifact(source, output, env)
    const original = readMetadata(output)
    writeMetadata(output, { ...original, assets: [...original.assets].reverse() })
    assert.throws(() => verifyReleaseArtifact(output), /asset name or network/)
    writeMetadata(output, { ...original, artifactLabel: 'v1.0.39-beta.12345.2.aaaaaaa' })
    assert.throws(() => verifyReleaseArtifact(output), /Artifact label/)
    writeMetadata(output, {
      ...original,
      assets: [{ ...original.assets[0], name: '../outside.zip' }, original.assets[1]]
    })
    assert.throws(() => verifyReleaseArtifact(output), /asset name or network/)
  })

  it('rejects symlinks and unexpected artifact files', async t => {
    const { source, output, env } = fixture(t)
    const metadata = await packageReleaseArtifact(source, output, env)
    const asset = path.join(output, metadata.assets[0].name)
    rmSync(asset)
    symlinkSync(path.join(source, 'packages', 'extension', 'dist', 'main.zip'), asset)
    assert.throws(() => verifyReleaseArtifact(output), /regular file/)
  })

  it('packages isolated network ZIPs without following wallet checkout ZIP symlinks', async t => {
    const { root, source, output, env } = fixture(t)
    const sentinel = path.join(root, 'trusted-script.mjs')
    const sentinelBytes = 'trusted release tooling'
    writeFileSync(sentinel, sentinelBytes)
    const walletZip = path.join(source, 'packages', 'extension', 'dist', 'main.zip')
    rmSync(walletZip)
    symlinkSync(sentinel, walletZip)

    const networkBuildDir = path.join(root, 'raw-zips')
    mkdirSync(path.join(networkBuildDir, 'dist'), { recursive: true })
    mkdirSync(path.join(networkBuildDir, 'dist-testnet'), { recursive: true })
    const mainnetBytes = 'isolated mainnet build'
    const testnetBytes = 'isolated testnet build'
    writeFileSync(path.join(networkBuildDir, 'dist', 'main.zip'), mainnetBytes)
    writeFileSync(path.join(networkBuildDir, 'dist-testnet', 'test.zip'), testnetBytes)

    await assert.rejects(
      packageReleaseArtifact(source, path.join(root, 'default-output'), env),
      /regular file/
    )
    const metadata = await packageReleaseArtifact(source, output, env, networkBuildDir)
    assert.deepEqual(
      metadata.assets.map(asset => asset.sha256),
      [
        createHash('sha256').update(mainnetBytes).digest('hex'),
        createHash('sha256').update(testnetBytes).digest('hex')
      ]
    )
    assert.equal(verifyReleaseArtifact(output).sourceSha, SOURCE_SHA)

    const cliOutput = path.join(root, 'cli-artifact')
    const cli = spawnSync(
      process.execPath,
      [SCRIPT, 'package', source, cliOutput, networkBuildDir],
      { encoding: 'utf8', env: { ...process.env, ...env } }
    )
    assert.equal(cli.status, 0, cli.stderr)
    assert.deepEqual(verifyReleaseArtifact(cliOutput).assets, metadata.assets)
    assert.equal(readFileSync(sentinel, 'utf8'), sentinelBytes)
  })

  it('requires expected source, version, run, and candidate mode for promotion', async t => {
    const { source, output, env } = fixture(t)
    await packageReleaseArtifact(source, output, env)
    for (const expected of [
      { mode: 'candidate' },
      { sourceSha: PR_HEAD_SHA },
      { version: '1.0.40' },
      { runId: '999' },
      { runAttempt: '3' },
      { workflowSha: PR_BASE_SHA },
      { repository: 'Other/repo' }
    ]) {
      assert.throws(() => verifyReleaseArtifact(output, expected), /does not match expected value/)
    }
  })

  it('rejects missing or duplicate source ZIPs', async t => {
    const { source, output, env } = fixture(t)
    rmSync(path.join(source, 'packages', 'extension', 'dist-testnet', 'test.zip'))
    await assert.rejects(
      packageReleaseArtifact(source, output, env),
      /exactly one ZIP in dist-testnet/
    )
    writeFileSync(
      path.join(source, 'packages', 'extension', 'dist-testnet', 'test.zip'),
      'testnet bytes'
    )
    writeFileSync(path.join(source, 'packages', 'extension', 'dist', 'extra.zip'), 'extra bytes')
    await assert.rejects(packageReleaseArtifact(source, output, env), /exactly one ZIP in dist/)
  })

  it('requires candidate branch and both authoritative release-note sources', async t => {
    const { source, output, env } = fixture(t, { mode: 'candidate' })
    env.SOURCE_REF = 'main'
    await assert.rejects(packageReleaseArtifact(source, output, env), /Candidate sourceRef/)
    env.SOURCE_REF = 'release/1.0.39'
    writeFileSync(
      path.join(source, 'packages', 'web', 'public', 'changelog.json'),
      JSON.stringify({ schemaVersion: 1, releases: { '1.0.38': { changes: ['Old'] } } })
    )
    await assert.rejects(
      packageReleaseArtifact(source, output, env),
      /release notes for version 1\.0\.39 were not found/
    )
    writeFileSync(
      path.join(source, 'packages', 'web', 'public', 'changelog.json'),
      JSON.stringify({ schemaVersion: 1, releases: { '1.0.39': { changes: ['Current fix'] } } })
    )
    writeFileSync(path.join(source, 'CHANGELOG.md'), '## [1.0.38]\n\n- Old\n')
    await assert.rejects(
      packageReleaseArtifact(source, output, env),
      /exactly one changelog section/
    )
    writeFileSync(path.join(source, 'CHANGELOG.md'), '## [1.0.39]\n\n- Current fix\n')
    const metadata = await packageReleaseArtifact(source, output, env)
    assert.equal(metadata.artifactLabel, 'v1.0.39-rc.12345.2.aaaaaaa')
    assert.equal(metadata.buildChannel, 'production')
    assert.deepEqual(
      metadata.assets.map(asset => asset.name),
      ['noir-wallet-v1.0.39.zip', 'noir-wallet-v1.0.39-testnet.zip']
    )
    assert.match(readFileSync(path.join(output, 'release-body.md'), 'utf8'), /Current fix/)
    assert.equal(verifyReleaseArtifact(output, { mode: 'candidate' }).mode, 'candidate')
  })

  it('uses a run-bound beta label and only beta publishes a prerelease tag', async t => {
    const { root, source, output, env } = fixture(t, { mode: 'beta' })
    env.GITHUB_OUTPUT = path.join(root, 'github-output')
    const cli = spawnSync(process.execPath, [SCRIPT, 'package', source, output], {
      encoding: 'utf8',
      env: { ...process.env, ...env }
    })
    assert.equal(cli.status, 0, cli.stderr)
    const metadata = verifyReleaseArtifact(output, { mode: 'beta' })
    assert.equal(metadata.artifactLabel, 'v1.0.39-beta.12345.2.aaaaaaa')
    assert.match(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /tag=v1\.0\.39-beta\.12345\.2\.aaaaaaa\n/)
  })

  it('runs both CLI entry points through a symlinked scripts directory', t => {
    const { root, source, output, env } = fixture(t)
    const scriptsLink = path.join(root, 'linked-scripts')
    symlinkSync(path.dirname(SCRIPT), scriptsLink, 'dir')
    const packaged = spawnSync(
      process.execPath,
      [path.join(scriptsLink, 'extension-release.mjs'), 'package', source, output],
      { encoding: 'utf8', env: { ...process.env, ...env } }
    )
    assert.equal(packaged.status, 0, packaged.stderr)
    assert.equal(verifyReleaseArtifact(output, { mode: 'preview' }).sourceSha, SOURCE_SHA)

    const rejected = spawnSync(
      process.execPath,
      [path.join(scriptsLink, path.basename(GATE_SCRIPT)), 'resolve'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main'
        }
      }
    )
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /Release workflows must be manually run from main/)

    const imported = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', 'await import(process.env.GATE_MODULE)'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GATE_MODULE: pathToFileURL(path.join(scriptsLink, path.basename(GATE_SCRIPT))).href,
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main'
        }
      }
    )
    assert.equal(imported.status, 0, imported.stderr)
  })
})

function requestFrom(responses) {
  return async route => {
    if (!(route in responses)) throw new Error(`Unexpected request: ${route}`)
    return responses[route]
  }
}

function candidateRun(overrides = {}) {
  return {
    id: 12345,
    run_attempt: 2,
    workflow_id: 41,
    path: '.github/workflows/extension-release.yml',
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: WORKFLOW_SHA,
    status: 'completed',
    conclusion: 'success',
    repository: { full_name: 'NoirWallet/noir-wallet' },
    ...overrides
  }
}

const candidateIdentity = {
  repository: 'NoirWallet/noir-wallet',
  runId: '12345',
  runAttempt: '2',
  workflowId: 41
}

describe('Extension release provenance gates', () => {
  it('pins beta sources to a resolved commit and requires a version-matched candidate branch', async () => {
    const packageContent = Buffer.from('{"version":"1.0.39"}').toString('base64')
    const base = {
      [`commits/${SOURCE_SHA}`]: { sha: SOURCE_SHA },
      [`branches/release%2F1.0.39`]: { commit: { sha: SOURCE_SHA } },
      [`branches/release%2F1.0.40`]: { commit: { sha: SOURCE_SHA } },
      [`contents/packages/extension/package.json?ref=${SOURCE_SHA}`]: {
        encoding: 'base64',
        content: packageContent
      }
    }
    assert.deepEqual(
      await resolveReleaseSource({
        mode: 'beta',
        source: SOURCE_SHA,
        request: requestFrom(base)
      }),
      { source_sha: SOURCE_SHA, source_ref: SOURCE_SHA, version: '1.0.39', mode: 'beta' }
    )
    assert.deepEqual(
      await resolveReleaseSource({
        mode: 'candidate',
        source: 'release/1.0.39',
        confirmSha: SOURCE_SHA,
        request: requestFrom(base)
      }),
      { source_sha: SOURCE_SHA, source_ref: 'release/1.0.39', version: '1.0.39', mode: 'candidate' }
    )
    await assert.rejects(
      resolveReleaseSource({
        mode: 'candidate',
        source: 'release/1.0.40',
        confirmSha: SOURCE_SHA,
        request: requestFrom(base)
      }),
      /Release branch must match/
    )
    await assert.rejects(
      resolveReleaseSource({
        mode: 'candidate',
        source: SOURCE_SHA,
        confirmSha: SOURCE_SHA,
        request: requestFrom(base)
      }),
      /release\/X\.Y\.Z branch/
    )
    await assert.rejects(
      resolveReleaseSource({
        mode: 'candidate',
        source: 'release/1.0.39',
        request: requestFrom(base)
      }),
      /Confirmed candidate commit/
    )
    await assert.rejects(
      resolveReleaseSource({
        mode: 'candidate',
        source: 'release/1.0.39',
        confirmSha: PR_HEAD_SHA,
        request: requestFrom(base)
      }),
      /must match the current release branch HEAD/
    )
  })

  it('rejects runs from PRs, forks, another workflow, another attempt, or failure', () => {
    const invalidRuns = [
      candidateRun({ event: 'pull_request' }),
      candidateRun({ repository: { full_name: 'Fork/noir-wallet' } }),
      candidateRun({ workflow_id: 42 }),
      candidateRun({ run_attempt: 1 }),
      candidateRun({ conclusion: 'failure' }),
      candidateRun({ head_branch: 'release/1.0.39' })
    ]
    for (const run of invalidRuns) {
      assert.throws(
        () => validateCandidateRun(run, candidateIdentity),
        /successful manual release workflow/
      )
    }
    assert.doesNotThrow(() => validateCandidateRun(candidateRun(), candidateIdentity))
    assert.doesNotThrow(() =>
      validateCandidateRun(
        candidateRun({
          path: '.github/workflows/extension-release.yml@main'
        }),
        candidateIdentity
      )
    )
  })

  it('rejects beta, expired, and duplicate candidate artifacts', () => {
    const candidate = {
      id: 732,
      name: 'noir-wallet-v1.0.39-rc.12345.2.aaaaaaa',
      expired: false,
      size_in_bytes: 400
    }
    assert.equal(selectCandidateArtifact([candidate], candidateIdentity).id, 732)
    for (const artifacts of [
      [{ ...candidate, name: 'noir-wallet-v1.0.39-beta.12345.2.aaaaaaa' }],
      [{ ...candidate, expired: true }],
      [candidate, { ...candidate, id: 733 }]
    ]) {
      assert.throws(
        () => selectCandidateArtifact(artifacts, candidateIdentity),
        /Exactly one unexpired/
      )
    }
  })

  it('resolves a successful candidate run and pins its workflow and artifact IDs', async () => {
    const artifact = {
      id: 732,
      name: 'noir-wallet-v1.0.39-rc.12345.2.aaaaaaa',
      expired: false,
      size_in_bytes: 400
    }
    const request = requestFrom({
      'actions/workflows/extension-release.yml': { id: 41 },
      'actions/runs/12345/attempts/2': candidateRun(),
      'actions/runs/12345/artifacts?per_page=100&page=1': {
        total_count: 1,
        artifacts: [artifact]
      }
    })
    assert.deepEqual(
      await resolvePromotion({
        repository: 'NoirWallet/noir-wallet',
        runId: '12345',
        runAttempt: '2',
        confirmSha: SOURCE_SHA,
        request
      }),
      {
        artifact_id: '732',
        workflow_sha: WORKFLOW_SHA,
        run_id: '12345',
        run_attempt: '2',
        source_sha: SOURCE_SHA
      }
    )
  })

  it('rejects a candidate when its release branch advances', async t => {
    const { source, output, env } = fixture(t, { mode: 'candidate' })
    const metadata = await packageReleaseArtifact(source, output, env)
    await assert.rejects(
      validateCurrentCandidate(
        metadata,
        requestFrom({
          'branches/release%2F1.0.39': { commit: { sha: PR_HEAD_SHA } }
        })
      ),
      /Release branch advanced/
    )
    await validateCurrentCandidate(
      metadata,
      requestFrom({
        'branches/release%2F1.0.39': { commit: { sha: SOURCE_SHA } }
      })
    )
  })

  it('keeps an existing tag fixed and never overwrites a release with different assets', async t => {
    const { source, output, env } = fixture(t, { mode: 'candidate' })
    const metadata = await packageReleaseArtifact(source, output, env)
    const tagRoute = 'git/ref/tags/v1.0.39'
    const releaseRoute = 'releases/tags/v1.0.39'
    await assert.rejects(
      validatePublicationTarget(
        metadata,
        output,
        requestFrom({
          [tagRoute]: { object: { type: 'commit', sha: PR_HEAD_SHA } }
        })
      ),
      /must never move/
    )
    const tag = { object: { type: 'commit', sha: SOURCE_SHA } }
    await assert.rejects(
      validatePublicationTarget(
        metadata,
        output,
        requestFrom({
          [tagRoute]: tag,
          [releaseRoute]: {
            draft: false,
            prerelease: false,
            assets: [
              ...metadata.assets.map(asset => ({
                name: asset.name,
                digest: `sha256:${asset.sha256}`
              })),
              { name: 'SHA256SUMS', digest: `sha256:${'0'.repeat(64)}` }
            ]
          }
        })
      ),
      /does not match the accepted candidate/
    )
    const checksumDigest = createHash('sha256')
      .update(readFileSync(path.join(output, 'SHA256SUMS')))
      .digest('hex')
    assert.equal(
      await validatePublicationTarget(
        metadata,
        output,
        requestFrom({
          [tagRoute]: tag,
          [releaseRoute]: {
            draft: false,
            prerelease: false,
            assets: [
              ...metadata.assets.map(asset => ({
                name: asset.name,
                digest: `sha256:${asset.sha256}`
              })),
              { name: 'SHA256SUMS', digest: `sha256:${checksumDigest}` }
            ]
          }
        })
      ),
      true
    )
  })
})
