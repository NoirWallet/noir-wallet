import assert from 'node:assert/strict'
import { test } from 'node:test'
import { needsScopeValidation } from '../../../scripts/ci-validated-scope.mjs'

const repository = 'NoirWallet/noir-wallet'
const oldSha = 'a'.repeat(40)
const newSha = 'b'.repeat(40)
const baseSha = 'c'.repeat(40)

function fixture({
  scope = 'sdk',
  conclusion = 'success',
  files = [{ filename: 'packages/extension/src/view.tsx' }]
} = {}) {
  const event = {
    action: 'synchronize',
    pull_request: {
      number: 20,
      head: { sha: newSha, repo: { id: 9, full_name: repository } },
      base: { ref: 'v2', sha: baseSha }
    }
  }
  const earlier = {
    id: 99,
    status: 'completed',
    conclusion,
    head_sha: oldSha,
    head_repository: { id: 9 },
    pull_requests: [{ number: 20, base: { ref: 'v2', sha: baseSha } }]
  }
  const routes = []
  const request = async route => {
    routes.push(route)
    if (route.startsWith('actions/workflows/')) return { workflow_runs: [{ id: 100 }, earlier] }
    if (route === `compare/${oldSha}...${newSha}`) return { status: 'ahead', files }
    throw new Error(`Unexpected request: ${route}`)
  }
  return {
    event,
    earlier,
    routes,
    check: () => needsScopeValidation({ scope, event, runId: 100, repository, request })
  }
}

test('skips only after a successful check of unchanged relevant inputs', async () => {
  const sdk = fixture()
  assert.equal(await sdk.check(), false)
  assert.equal(sdk.routes.length, 2)
  const docs = fixture({ scope: 'docs' })
  assert.equal(await docs.check(), false)
})

test('reruns when relevant files changed, including a renamed input', async () => {
  for (const scope of ['sdk', 'docs']) {
    const changed = fixture({ scope, files: [{ filename: 'packages/sdk/src/index.ts' }] })
    assert.equal(await changed.check(), true)
  }
  const renamed = fixture({
    files: [{ filename: 'other/new.ts', previous_filename: 'packages/sdk/src/old.ts' }]
  })
  assert.equal(await renamed.check(), true)
  const gate = fixture({ files: [{ filename: 'scripts/ci-validated-scope.mjs' }] })
  assert.equal(await gate.check(), true)
})

test('failure, cancellation, or no completed prior run retries validation', async () => {
  for (const conclusion of ['failure', 'cancelled', null]) {
    const state = fixture({ conclusion })
    assert.equal(await state.check(), true)
    assert.equal(state.routes.length, 1)
  }
  const state = fixture()
  state.earlier.status = 'in_progress'
  assert.equal(await state.check(), true)
})

test('first PR run, forks, and incomplete compare data run validation', async () => {
  const opened = fixture()
  opened.event.action = 'opened'
  assert.equal(await opened.check(), true)
  assert.equal(opened.routes.length, 0)
  const fork = fixture()
  fork.event.pull_request.head.repo.full_name = 'contributor/fork'
  assert.equal(await fork.check(), true)
  const limit = fixture({
    files: Array.from({ length: 300 }, (_, index) => ({ filename: `other/${index}` }))
  })
  assert.equal(await limit.check(), true)
})

test('a changed target branch or diverged head requires fresh validation', async () => {
  const newBase = fixture()
  newBase.event.pull_request.base.sha = 'd'.repeat(40)
  assert.equal(await newBase.check(), true)
  assert.equal(newBase.routes.length, 1)
  const rebased = fixture()
  const request = async route =>
    route.startsWith('actions/workflows/')
      ? { workflow_runs: [rebased.earlier] }
      : { status: 'diverged', files: [{ filename: 'packages/extension/src/view.tsx' }] }
  assert.equal(
    await needsScopeValidation({
      scope: 'sdk',
      event: rebased.event,
      runId: 100,
      repository,
      request
    }),
    true
  )
})
