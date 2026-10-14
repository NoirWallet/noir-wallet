import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const marker = /^<!-- noir-extension-preview:(\d+):(\d+) -->/
const shaPattern = /^[0-9a-f]{40}$/
const positiveId = value => Number.isSafeInteger(value) && value > 0

async function pages(request, route, key) {
  const items = []
  for (let page = 1; page <= 20; page++) {
    const result = await request(
      `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`
    )
    const batch = key ? result?.[key] : result
    if (!Array.isArray(batch)) throw new Error('Invalid GitHub list response')
    items.push(...batch)
    if (batch.length < 100) return items
  }
  throw new Error('GitHub list exceeds the supported limit')
}

function previewArtifact(artifacts, run, prNumber) {
  const name = new RegExp(
    `^noir-wallet-(development-)?v(\\d+)\\.\\d+\\.\\d+-pr\\.${prNumber}\\.[0-9a-f]{7}$`
  )
  const matches = artifacts.filter(artifact => {
    const match = name.exec(artifact.name)
    return (
      match &&
      Boolean(match[1]) === Number(match[2]) >= 2 &&
      positiveId(artifact.id) &&
      artifact.size_in_bytes > 0 &&
      !artifact.expired &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run.head_sha === run.head_sha &&
      Date.parse(artifact.created_at) >= Date.parse(run.run_started_at) &&
      Number.isFinite(Date.parse(artifact.expires_at))
    )
  })
  return matches.length === 1 ? matches[0] : null
}

function commentBody(repository, run, artifact) {
  const root = `https://github.com/${repository}`
  const lines = [
    `<!-- noir-extension-preview:${run.id}:${run.run_attempt} -->`,
    '## Extension test package',
    '',
    `PR commit: [\`${run.head_sha.slice(0, 7)}\`](${root}/commit/${run.head_sha})`,
    `Build: [${run.id}, attempt ${run.run_attempt}](${root}/actions/runs/${run.id}/attempts/${run.run_attempt})`,
    ''
  ]
  if (artifact) {
    const v2 = artifact.name.startsWith('noir-wallet-development-')
    lines.push(
      `[Download ${v2 ? 'V2 development' : 'V1 Mainnet + Testnet'} package](${root}/actions/runs/${run.id}/artifacts/${artifact.id})`,
      '',
      `Expires: ${new Date(artifact.expires_at).toISOString().replace('.000Z', ' UTC')}. GitHub sign-in and repository access are required.`,
      v2
        ? 'Includes one extension ZIP with runtime Mainnet/Testnet Mode.'
        : 'Includes separate Mainnet and Testnet extension ZIPs.'
    )
  } else {
    lines.push(
      run.conclusion === 'success'
        ? 'The test package is unavailable or expired. Rerun Build Extension to generate a new download.'
        : `Build result: **${run.conclusion}**. This run has no test package; see the build logs above.`
    )
  }
  return `${lines.join('\n')}\n`
}

export async function reportExtensionPreview({ repository, runId, runAttempt, request }) {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') ||
    !positiveId(runId) ||
    !positiveId(runAttempt)
  )
    throw new Error('Invalid preview identity')
  // Refetch authoritative data rather than trusting PR-controlled files or artifact contents.
  const run = await request(`actions/runs/${runId}`)
  if (
    run?.id !== runId ||
    run.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
    run.path !== '.github/workflows/build-extension.yml' ||
    run.event !== 'pull_request' ||
    !shaPattern.test(run.head_sha) ||
    !positiveId(run.head_repository?.id)
  ) {
    throw new Error('Expected a Build Extension PR run from this repository')
  }
  if (run.status !== 'completed' || run.run_attempt !== runAttempt) return []
  if (
    ![
      'success',
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'neutral',
      'skipped',
      'startup_failure',
      'stale'
    ].includes(run.conclusion)
  ) {
    throw new Error('Invalid build conclusion')
  }
  if (!Array.isArray(run.pull_requests)) throw new Error('Invalid build PR response')
  const associated = run.pull_requests.length
    ? run.pull_requests
    : await pages(request, `commits/${run.head_sha}/pulls`)
  const artifacts =
    run.conclusion === 'success'
      ? await pages(request, `actions/runs/${runId}/artifacts`, 'artifacts')
      : []
  const updated = []
  for (const number of new Set(associated.map(pr => pr.number))) {
    if (!positiveId(number)) throw new Error('Invalid associated PR number')
    const pr = await request(`pulls/${number}`)
    if (
      pr.number !== number ||
      pr.state !== 'open' ||
      pr.head?.sha !== run.head_sha ||
      pr.head.repo?.id !== run.head_repository.id ||
      pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      !/^(main|v2|release\/.+)$/.test(pr.base.ref)
    )
      continue
    const comments = await pages(request, `issues/${number}/comments`)
    const own = comments.filter(
      comment =>
        comment.user?.login === 'github-actions[bot]' &&
        comment.user.type === 'Bot' &&
        marker.test(comment.body)
    )
    const newer = own.some(comment => {
      const [, id, attempt] = marker.exec(comment.body)
      return Number(id) > runId || (Number(id) === runId && Number(attempt) > runAttempt)
    })
    if (newer) continue
    const body = commentBody(repository, run, previewArtifact(artifacts, run, number))
    const existing = own[0]
    if (existing?.body === body) continue
    // A push while inventorying artifacts must not advertise an old commit as current.
    const current = await request(`pulls/${number}`)
    if (
      current.state !== 'open' ||
      current.head?.sha !== run.head_sha ||
      current.base?.ref !== pr.base.ref ||
      current.head?.repo?.id !== pr.head.repo.id
    )
      continue
    if (existing) {
      if (!positiveId(existing.id)) throw new Error('Invalid preview comment ID')
      await request(`issues/comments/${existing.id}`, { method: 'PATCH', body: { body } })
    } else {
      await request(`issues/${number}/comments`, { method: 'POST', body: { body } })
    }
    updated.push(number)
  }
  return updated
}

function githubRequest(repository, token) {
  if (!token) throw new Error('GH_TOKEN is required')
  return async (route, { method = 'GET', body } = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${route}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) throw new Error(`Preview comment request failed (${response.status})`)
    return response.json()
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env
    if (env.GITHUB_EVENT_NAME !== 'workflow_run' || env.GITHUB_REF !== 'refs/heads/main') {
      throw new Error('Preview comments must run from the trusted main workflow')
    }
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    if (
      event.action !== 'completed' ||
      event.workflow_run?.id !== Number(env.PREVIEW_RUN_ID) ||
      event.workflow_run.run_attempt !== Number(env.PREVIEW_RUN_ATTEMPT)
    ) {
      throw new Error('Preview run does not match the workflow event')
    }
    const updated = await reportExtensionPreview({
      repository: env.GITHUB_REPOSITORY,
      runId: Number(env.PREVIEW_RUN_ID),
      runAttempt: Number(env.PREVIEW_RUN_ATTEMPT),
      request: githubRequest(env.GITHUB_REPOSITORY, env.GH_TOKEN)
    })
    console.log(`Updated preview downloads on ${updated.length} PR(s)`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Preview comment failed')
    process.exitCode = 1
  }
}
