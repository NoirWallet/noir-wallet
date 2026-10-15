import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const marker = /^<!-- noir-extension-preview:(\d+):(\d+) -->/
const shaPattern = /^[0-9a-f]{40}$/
const positiveId = value => Number.isSafeInteger(value) && value > 0
const previewName = prNumber =>
  new RegExp(`^noir-wallet-(development-)?v(\\d+)\\.\\d+\\.\\d+-pr\\.${prNumber}\\.[0-9a-f]{7}$`)
const workflowPath = '.github/workflows/build-extension.yml'
const checksPath = '.github/workflows/extension-checks.yml'

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
  const name = previewName(prNumber)
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

function commentBody(repository, run, artifact, previousIsSameHead, forkPreview) {
  const root = `https://github.com/${repository}`
  const build = run.path === workflowPath
  const previousPackage = previousIsSameHead
    ? 'This run has no new package; check earlier build runs for this commit.'
    : 'Any previous packages belong to older commits.'
  const lines = [
    `<!-- noir-extension-preview:${run.id}:${run.run_attempt} -->`,
    '## Extension test package',
    '',
    `PR commit: [\`${run.head_sha.slice(0, 7)}\`](${root}/commit/${run.head_sha})`,
    `${build ? 'Build' : 'Checks'}: [${run.id}, attempt ${run.run_attempt}](${root}/actions/runs/${run.id}/attempts/${run.run_attempt})`,
    ''
  ]
  if (artifact) {
    const v2 = artifact.name.startsWith('noir-wallet-development-')
    lines.push(
      '**Latest package**',
      '',
      `[Download ${v2 ? 'V2 development' : 'V1 Mainnet + Testnet'} package for PR head ${run.head_sha.slice(0, 7)}](${root}/actions/runs/${run.id}/artifacts/${artifact.id})`,
      '',
      `Built: ${new Date(artifact.created_at).toISOString().replace('.000Z', ' UTC')}.`,
      `Expires: ${new Date(artifact.expires_at).toISOString().replace('.000Z', ' UTC')}. GitHub sign-in and repository access are required.`,
      'The package metadata records the tested PR merge commit.',
      v2
        ? 'Includes one extension ZIP with runtime Mainnet/Testnet Mode.'
        : 'Includes separate Mainnet and Testnet extension ZIPs.'
    )
    if (v2 && forkPreview)
      lines.push('Swap is unavailable in fork previews because repository secrets are not shared.')
  } else {
    if (!build)
      lines.push(
        `Preview package: **not requested** for this commit. Add the \`preview\` label when a download is needed. ${previousPackage}`
      )
    else if (run.status !== 'completed')
      lines.push(`Preview package: **building**. ${previousPackage}`)
    else if (run.conclusion === 'success')
      lines.push(
        'The preview package is unavailable or expired. Remove and reapply the `preview` label to build it again.'
      )
    else
      lines.push(
        `Preview build: **${run.conclusion}**. No package was produced; see the build logs above.`
      )
  }
  return `${lines.join('\n')}\n`
}

export async function reportExtensionPreview({
  repository,
  runId,
  runAttempt,
  eventAction = 'completed',
  request
}) {
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
    ![workflowPath, checksPath].includes(run.path) ||
    run.event !== 'pull_request' ||
    !shaPattern.test(run.head_sha) ||
    !positiveId(run.head_repository?.id)
  ) {
    throw new Error('Expected a wallet verification PR run from this repository')
  }
  if (run.path === workflowPath && run.display_title !== 'Requested extension preview') return []
  if (run.run_attempt !== runAttempt) return []
  if (
    !['requested', 'queued', 'in_progress', 'completed', 'waiting', 'pending'].includes(run.status)
  )
    throw new Error('Invalid run status')
  if (
    run.status === 'completed' &&
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
    run.path === workflowPath && run.status === 'completed' && run.conclusion === 'success'
      ? await pages(request, `actions/runs/${runId}/artifacts`, 'artifacts')
      : []
  const updated = []
  for (const number of new Set(associated.map(pr => pr.number))) {
    if (!positiveId(number)) throw new Error('Invalid associated PR number')
    const pr = await request(`pulls/${number}`)
    if (
      pr.number !== number ||
      pr.state !== 'open' ||
      (pr.head?.sha !== run.head_sha &&
        !(run.path === workflowPath && run.status === 'completed')) ||
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
    let consumeLabel = false
    if (run.path === workflowPath) {
      const builds = await request(
        'actions/workflows/build-extension.yml/runs?event=pull_request&per_page=100'
      )
      if (!Array.isArray(builds?.workflow_runs)) throw new Error('Invalid preview run inventory')
      const newerRequest = builds.workflow_runs.some(
        other =>
          other.id > runId &&
          other.head_repository?.id === run.head_repository.id &&
          other.display_title === 'Requested extension preview' &&
          other.pull_requests?.some(associatedPr => associatedPr.number === number)
      )
      if (newerRequest) continue
      consumeLabel =
        eventAction === 'requested' && pr.labels?.some(label => label.name === 'preview')
    }
    const artifact = previewArtifact(artifacts, run, number)
    const existing = own[0]
    const previousIsSameHead = Boolean(
      existing?.body.includes(`/commit/${run.head_sha})`) &&
      (existing?.body.includes('/artifacts/') ||
        existing?.body.includes('This run has no new package'))
    )
    const forkPreview = pr.head.repo.full_name?.toLowerCase() !== repository.toLowerCase()
    const body = commentBody(repository, run, artifact, previousIsSameHead, forkPreview)
    if (
      existing?.body === body &&
      !consumeLabel &&
      !(run.path === workflowPath && run.status === 'completed')
    )
      continue
    // A push while inventorying artifacts must not advertise an old commit as current.
    const current = await request(`pulls/${number}`)
    if (
      current.state !== 'open' ||
      current.base?.ref !== pr.base.ref ||
      current.head?.repo?.id !== pr.head.repo.id
    )
      continue
    if (
      consumeLabel &&
      current.head.sha === run.head_sha &&
      current.labels?.some(label => label.name === 'preview')
    )
      await request(`issues/${number}/labels/preview`, { method: 'DELETE' })
    if (current.head.sha === run.head_sha && existing?.body !== body) {
      if (existing) {
        if (!positiveId(existing.id)) throw new Error('Invalid preview comment ID')
        await request(`issues/comments/${existing.id}`, { method: 'PATCH', body: { body } })
      } else {
        await request(`issues/${number}/comments`, { method: 'POST', body: { body } })
      }
      updated.push(number)
    }
    if (run.path === workflowPath && run.status === 'completed' && eventAction === 'completed') {
      if (artifact && current.head.sha === run.head_sha)
        await retainPreviewArtifacts({
          request,
          run,
          prNumber: number,
          headRepositoryId: pr.head.repo.id
        })
    }
  }
  return updated
}

async function retainPreviewArtifacts({ request, run, prNumber, headRepositoryId }) {
  const all = await pages(request, 'actions/artifacts', 'artifacts')
  const candidates = all.filter(artifact => {
    const match = previewName(prNumber).exec(artifact.name)
    return (
      match &&
      Boolean(match[1]) === Number(match[2]) >= 2 &&
      positiveId(artifact.id) &&
      positiveId(artifact.workflow_run?.id) &&
      shaPattern.test(artifact.workflow_run.head_sha) &&
      !artifact.expired
    )
  })
  if (candidates.length <= 2) return
  const verified = []
  for (const artifact of candidates) {
    if (!Number.isFinite(Date.parse(artifact.created_at))) continue
    const source =
      artifact.workflow_run.id === run.id
        ? run
        : await request(`actions/runs/${artifact.workflow_run.id}`)
    if (
      source?.id !== artifact.workflow_run.id ||
      source.path !== workflowPath ||
      source.event !== 'pull_request' ||
      source.head_repository?.id !== headRepositoryId ||
      source.head_sha !== artifact.workflow_run.head_sha ||
      !Array.isArray(source.pull_requests)
    )
      continue
    const associated = source.pull_requests.length
      ? source.pull_requests
      : await pages(request, `commits/${source.head_sha}/pulls`)
    if (!associated.some(pr => pr.number === prNumber)) continue
    verified.push(artifact)
  }
  verified.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
  for (const artifact of verified.slice(2))
    await request(`actions/artifacts/${artifact.id}`, { method: 'DELETE' })
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
    return response.status === 204 ? null : response.json()
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
      !['requested', 'completed'].includes(event.action) ||
      event.action !== env.PREVIEW_EVENT_ACTION ||
      event.workflow_run?.id !== Number(env.PREVIEW_RUN_ID) ||
      event.workflow_run.run_attempt !== Number(env.PREVIEW_RUN_ATTEMPT)
    ) {
      throw new Error('Preview run does not match the workflow event')
    }
    const updated = await reportExtensionPreview({
      repository: env.GITHUB_REPOSITORY,
      runId: Number(env.PREVIEW_RUN_ID),
      runAttempt: Number(env.PREVIEW_RUN_ATTEMPT),
      eventAction: event.action,
      request: githubRequest(env.GITHUB_REPOSITORY, env.GH_TOKEN)
    })
    console.log(`Updated preview downloads on ${updated.length} PR(s)`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Preview comment failed')
    process.exitCode = 1
  }
}
