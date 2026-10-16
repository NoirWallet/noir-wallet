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
  status = 'ahead',
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
  const request = async route =>
    route.startsWith('actions/workflows/') ? { workflow_runs: [earlier] } : { status, files }
  return {
    event,
    earlier,
    check: () => needsScopeValidation({ scope, event, runId: 100, repository, request })
  }
}

test('reuses successful PR validation only when relevant inputs and base are unchanged', async () => {
  for (const scope of ['sdk', 'docs']) {
    const unchanged = fixture({ scope })
    assert.equal(await unchanged.check(), false)
    const changed = fixture({ scope, files: [{ filename: 'packages/sdk/src/index.ts' }] })
    assert.equal(await changed.check(), true)
    const gateChanged = fixture({ scope, files: [{ filename: 'scripts/ci-validated-scope.mjs' }] })
    assert.equal(await gateChanged.check(), true)
    const baseChanged = fixture({ scope })
    baseChanged.event.pull_request.base.sha = 'd'.repeat(40)
    assert.equal(await baseChanged.check(), true)
  }
})

test('failed, cancelled, or diverged validation never becomes a skip baseline', async () => {
  for (const conclusion of ['failure', 'cancelled'])
    assert.equal(await fixture({ conclusion }).check(), true)
  assert.equal(await fixture({ status: 'diverged' }).check(), true)
})

test('forks and first PR events run validation', async () => {
  const fork = fixture()
  fork.event.pull_request.head.repo.full_name = 'contributor/fork'
  assert.equal(await fork.check(), true)
  const opened = fixture()
  opened.event.action = 'opened'
  assert.equal(await opened.check(), true)
})
