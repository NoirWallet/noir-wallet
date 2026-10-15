import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportExtensionPreview } from '../../../scripts/extension-preview-comment.mjs'

const repository = 'NoirWallet/noir-wallet'
const sha = 'a'.repeat(40)
const runId = 100
const runAttempt = 1

function fixture({ v2 = false } = {}) {
  const run = {
    id: runId,
    run_attempt: runAttempt,
    repository: { full_name: repository },
    head_repository: { id: 9 },
    path: '.github/workflows/build-extension.yml',
    display_title: 'Requested extension preview',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'success',
    head_sha: sha,
    run_started_at: '2026-10-14T10:00:00Z',
    pull_requests: [{ number: 20 }]
  }
  const pr = {
    number: 20,
    state: 'open',
    head: { sha, repo: { id: 9 } },
    base: { ref: v2 ? 'v2' : 'main', repo: { full_name: repository } },
    labels: []
  }
  const artifact = {
    id: 300,
    name: `noir-wallet-${v2 ? 'development-v2.0.0' : 'v1.0.39'}-pr.20.bbbbbbb`,
    expired: false,
    size_in_bytes: 100,
    created_at: '2026-10-14T10:05:00Z',
    expires_at: '2026-10-21T10:05:00Z',
    workflow_run: { id: runId, head_sha: sha }
  }
  const comments = []
  const writes = []
  const routes = []
  const responses = new Map()
  let prReads = 0
  const state = { run, pr, artifact, artifacts: [artifact], comments, writes, routes, responses }
  state.request = async (route, options = {}) => {
    routes.push(route)
    if (options.method) {
      writes.push({ route, ...options })
      return { id: 400 }
    }
    if (responses.has(route)) return responses.get(route)
    if (route === `actions/runs/${runId}`) return run
    if (route === 'pulls/20') return ++prReads > 1 && state.currentPr ? state.currentPr : pr
    if (route.startsWith(`actions/runs/${runId}/artifacts?`)) return { artifacts: state.artifacts }
    if (route.startsWith('actions/artifacts?'))
      return { artifacts: state.repositoryArtifacts ?? state.artifacts }
    if (route.startsWith('actions/workflows/build-extension.yml/runs?'))
      return { workflow_runs: state.buildRuns ?? [run] }
    if (route.startsWith('issues/20/comments?')) return comments
    if (route.startsWith(`commits/${sha}/pulls?`)) return [{ number: 20 }]
    throw new Error(`Unexpected request: ${route}`)
  }
  state.report = (eventAction = 'completed') =>
    reportExtensionPreview({ repository, runId, runAttempt, eventAction, request: state.request })
  return state
}

function botComment(body, id = 400) {
  return { id, body, user: { login: 'github-actions[bot]', type: 'Bot' } }
}

for (const v2 of [false, true]) {
  test(`links the exact ${v2 ? 'V2' : 'V1'} artifact to its PR`, async () => {
    const state = fixture({ v2 })
    assert.deepEqual(await state.report(), [20])
    assert.equal(state.writes[0].route, 'issues/20/comments')
    assert.equal(state.writes[0].method, 'POST')
    const { body } = state.writes[0].body
    assert.match(body, /actions\/runs\/100\/artifacts\/300/)
    assert.match(body, v2 ? /V2 development/ : /V1 Mainnet \+ Testnet/)
    assert.match(body, /Expires: 2026-10-21T10:05:00 UTC/)
    assert.match(body, /Built: 2026-10-14T10:05:00 UTC/)
    assert.match(body, /\*\*Latest package\*\*/)
    if (v2) assert.match(body, /Swap is unavailable in this development package/)
    else assert.doesNotMatch(body, /Swap is unavailable/)
    assert.match(body, new RegExp(`/commit/${sha}`))
  })
}

test('updates only its own comment and deduplicates repeated completion events', async () => {
  const state = fixture()
  const forged = {
    ...botComment('<!-- noir-extension-preview:999:1 -->'),
    user: { login: 'attacker', type: 'User' }
  }
  state.comments.push(forged, botComment('<!-- noir-extension-preview:99:1 -->\nOld package'))
  await state.report()
  assert.equal(state.writes[0].route, 'issues/comments/400')
  assert.equal(state.writes[0].method, 'PATCH')
  state.comments[1].body = state.writes[0].body.body
  assert.deepEqual(await state.report(), [])
  assert.equal(state.writes.length, 1)
})

test('rejects unrelated runs and malformed identities before any comment write', async () => {
  for (const change of [
    { event: 'push' },
    { path: '.github/workflows/docs.yml' },
    { id: 101 },
    { repository: { full_name: 'attacker/repo' } },
    { head_sha: 'bad' },
    { head_repository: null },
    { pull_requests: [{ number: '../21' }] },
    { conclusion: 'success\n[click](https://evil.example)' }
  ]) {
    const state = fixture()
    Object.assign(state.run, change)
    await assert.rejects(state.report)
    assert.equal(state.writes.length, 0)
  }
  await assert.rejects(
    reportExtensionPreview({
      repository: 'owner/repo/../../evil',
      runId,
      runAttempt,
      request: () => assert.fail()
    })
  )
})

test('skips closed, advanced, retargeted and unrelated PRs', async () => {
  for (const change of [
    { state: 'closed' },
    { head: { sha: 'b'.repeat(40), repo: { id: 9 } } },
    { head: { sha, repo: { id: 10 } } },
    { number: 21 },
    { base: { ref: 'other', repo: { full_name: repository } } },
    { base: { ref: 'v2', repo: { full_name: 'attacker/repo' } } }
  ]) {
    const state = fixture()
    Object.assign(state.pr, change)
    assert.deepEqual(await state.report(), [])
    assert.equal(state.writes.length, 0)
  }
})

test('checks PR identity again before writing after an intervening push', async () => {
  const state = fixture()
  state.currentPr = { ...state.pr, head: { ...state.pr.head, sha: 'b'.repeat(40) } }
  assert.deepEqual(await state.report(), [])
  assert.equal(state.writes.length, 0)
})

test('finds fork PR associations when the run has no pull_requests entries', async () => {
  const state = fixture({ v2: true })
  state.run.pull_requests = []
  state.run.head_repository.id = state.pr.head.repo.id = 42
  await state.report()
  assert.ok(state.routes.includes(`commits/${sha}/pulls?per_page=100&page=1`))
  assert.equal(state.writes.length, 1)
})

test('does not let an older run or attempt overwrite a newer comment', async () => {
  for (const identity of ['101:1', '100:2']) {
    const state = fixture()
    state.comments.push(botComment(`<!-- noir-extension-preview:${identity} -->\nNew package`))
    assert.deepEqual(await state.report(), [])
    assert.equal(state.writes.length, 0)
  }
  const state = fixture()
  state.run.run_attempt = 2
  assert.deepEqual(await state.report(), [])
  assert.equal(state.writes.length, 0)
})

test('replaces a previous download with the current failed or cancelled build result', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const state = fixture()
    state.run.conclusion = conclusion
    state.comments.push(botComment('<!-- noir-extension-preview:99:1 -->\nOld download'))
    await state.report()
    const body = state.writes[0].body.body
    assert.ok(body.includes(`**${conclusion}**`))
    assert.doesNotMatch(body, /\/artifacts\//)
    assert.equal(
      state.routes.some(route => route.includes('/artifacts?')),
      false
    )
  }
})

test('never links missing, ambiguous, expired, unrelated, or previous-attempt artifacts', async () => {
  for (const change of [
    { expired: true },
    { id: -1 },
    { size_in_bytes: 0 },
    { name: 'noir-wallet-v1.0.39-pr.21.bbbbbbb' },
    { name: 'noir-wallet-v2.0.0-pr.20.bbbbbbb' },
    { workflow_run: { id: 99, head_sha: sha } },
    { workflow_run: { id: runId, head_sha: 'b'.repeat(40) } },
    { created_at: '2026-10-14T09:00:00Z' },
    { expires_at: 'invalid' },
    'missing',
    'duplicate'
  ]) {
    const state = fixture()
    if (change === 'missing') state.artifacts = []
    else if (change === 'duplicate') state.artifacts.push({ ...state.artifact, id: 301 })
    else Object.assign(state.artifact, change)
    await state.report()
    assert.match(state.writes[0].body.body, /unavailable or expired/)
    assert.doesNotMatch(state.writes[0].body.body, /\/artifacts\//)
  }
})

test('paginates artifact and comment inventories before selecting a download', async () => {
  const state = fixture()
  state.responses.set(`actions/runs/${runId}/artifacts?per_page=100&page=1`, {
    artifacts: Array.from({ length: 100 }, () => ({ name: 'other' }))
  })
  state.responses.set(
    'issues/20/comments?per_page=100&page=1',
    Array.from({ length: 100 }, () => ({ body: 'unrelated' }))
  )
  state.comments.push(botComment('<!-- noir-extension-preview:99:1 -->'))
  await state.report()
  assert.ok(state.routes.includes(`actions/runs/${runId}/artifacts?per_page=100&page=2`))
  assert.ok(state.routes.includes('issues/20/comments?per_page=100&page=2'))
  assert.equal(state.writes[0].method, 'PATCH')
  assert.match(state.writes[0].body.body, /\/artifacts\/300/)
})

test('fails closed on malformed API data or a comment write failure', async () => {
  const state = fixture()
  state.responses.set(`actions/runs/${runId}/artifacts?per_page=100&page=1`, { artifacts: null })
  await assert.rejects(state.report, /Invalid GitHub list/)
  assert.equal(state.writes.length, 0)
  const valid = fixture()
  await assert.rejects(
    reportExtensionPreview({
      repository,
      runId,
      runAttempt,
      request: async (route, options) => {
        if (options?.method) throw new Error('write denied')
        return valid.request(route, options)
      }
    }),
    /write denied/
  )
})

test('clears an older download as soon as checks start on a new commit', async () => {
  const state = fixture({ v2: true })
  state.run.path = '.github/workflows/extension-checks.yml'
  state.run.status = 'in_progress'
  state.run.conclusion = null
  state.comments.push(botComment('<!-- noir-extension-preview:99:1 -->\nOld download'))
  await state.report()
  assert.match(state.writes[0].body.body, /Preview package: \*\*not requested\*\*/)
  assert.match(state.writes[0].body.body, /older commits/)
  assert.doesNotMatch(state.writes[0].body.body, /\/artifacts\//)
})

test('a checks rerun on the same head does not mislabel its earlier package as old', async () => {
  const state = fixture({ v2: true })
  state.run.path = '.github/workflows/extension-checks.yml'
  state.run.status = 'in_progress'
  state.run.conclusion = null
  state.comments.push(
    botComment(
      `<!-- noir-extension-preview:99:1 -->\nPR commit: [\`aaaaaaa\`](https://github.com/${repository}/commit/${sha})\n[Download package](https://github.com/${repository}/actions/runs/99/artifacts/299)`
    )
  )
  await state.report()
  const body = state.writes[0].body.body
  assert.match(body, /This run has no new package/)
  assert.doesNotMatch(body, /older commits/)
})

test('build request shows building and consumes the preview label before completion', async () => {
  const state = fixture({ v2: true })
  state.pr.labels.push({ name: 'preview' })
  state.run.status = 'queued'
  state.run.conclusion = null
  await state.report('requested')
  assert.match(
    state.writes.find(write => write.method === 'POST').body.body,
    /Preview package: \*\*building\*\*/
  )
  assert.ok(
    state.writes.some(
      write => write.route === 'issues/20/labels/preview' && write.method === 'DELETE'
    )
  )
  state.run.status = 'completed'
  state.run.conclusion = 'success'
  state.comments.push(botComment(state.writes.find(write => write.method === 'POST').body.body))
  state.writes.length = 0
  await state.report()
  assert.equal(
    state.writes.some(write => write.method === 'DELETE'),
    false
  )
  assert.ok(
    state.writes.some(write => write.method === 'PATCH' && /\/artifacts\/300/.test(write.body.body))
  )
})

test('an older request or completion never consumes a newer preview request', async () => {
  const state = fixture({ v2: true })
  state.pr.labels.push({ name: 'preview' })
  state.buildRuns = [{ ...state.run, id: 101, pull_requests: [{ number: 20 }] }, state.run]
  await state.report('requested')
  assert.equal(state.writes.length, 0)
  state.writes.length = 0
  state.run.conclusion = 'failure'
  await state.report('completed')
  assert.equal(state.writes.length, 0)
})

test('a push between request inventory and label removal leaves the new head label intact', async () => {
  const state = fixture({ v2: true })
  state.pr.labels.push({ name: 'preview' })
  state.currentPr = { ...state.pr, head: { ...state.pr.head, sha: 'c'.repeat(40) } }
  assert.deepEqual(await state.report('requested'), [])
  assert.equal(state.writes.length, 0)
})

test('keeps only the two newest verified preview artifacts for this PR', async () => {
  const state = fixture({ v2: true })
  const makeArtifact = (id, createdAt, name = state.artifact.name, sourceRun = runId) => ({
    ...state.artifact,
    id,
    name,
    created_at: createdAt,
    workflow_run: { id: sourceRun, head_sha: sha }
  })
  state.repositoryArtifacts = [
    makeArtifact(300, '2026-10-14T10:05:00Z'),
    makeArtifact(301, '2026-10-14T10:04:00Z'),
    makeArtifact(302, '2026-10-14T10:03:00Z'),
    makeArtifact(303, '2026-10-14T10:02:00Z', 'noir-wallet-development-v2.0.0-pr.21.bbbbbbb'),
    makeArtifact(304, '2026-10-14T10:01:00Z', state.artifact.name, 999)
  ]
  state.responses.set('actions/runs/999', {
    ...state.run,
    id: 999,
    path: '.github/workflows/docs.yml'
  })
  await state.report()
  assert.deepEqual(
    state.writes.filter(write => write.method === 'DELETE').map(write => write.route),
    ['actions/artifacts/302']
  )
})

test('ignores another label event before updating the PR', async () => {
  const state = fixture()
  state.run.display_title = 'No extension preview requested'
  assert.deepEqual(await state.report(), [])
  assert.equal(state.writes.length, 0)
})
