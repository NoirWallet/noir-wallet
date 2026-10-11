const SHA = /^[0-9a-f]{40}$/
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/
const MAX_API_COMMITS = 100
const MAX_RELEASE_COMMITS = 20
const MAX_SUBJECT_LENGTH = 200
const EXCLUDED_TYPE =
  /^(?:ci(?:\([^()]+\))?|fix\(ci\)|chore(?:\([^()]+\))?|test(?:\([^()]+\))?)!?:/i

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) {
    throw new Error(`${label} must be a full lowercase commit SHA`)
  }
  return value
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requireSubject(value, label) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_SUBJECT_LENGTH ||
    /[\x00-\x1f\x7f\u2028\u2029]/.test(value)
  ) {
    throw new Error(
      `${label} must be a nonempty single line of at most ${MAX_SUBJECT_LENGTH} characters`
    )
  }
  return value
}

function commitSubject(message, label) {
  if (typeof message !== 'string') throw new Error(`${label} has no commit message`)
  const firstLine = message.split(/\r?\n/, 1)[0].trim()
  if (!firstLine || /[\x00-\x1f\x7f\u2028\u2029]/.test(firstLine)) {
    throw new Error(`${label} has an invalid commit subject`)
  }
  const subject = firstLine.slice(0, MAX_SUBJECT_LENGTH)
  return requireSubject(subject.replace(/[\uD800-\uDBFF]$/, ''), `${label} subject`)
}

export function validateReleaseCommits(value) {
  if (!Array.isArray(value) || value.length > MAX_RELEASE_COMMITS) {
    throw new Error(`Release commits must be an array of at most ${MAX_RELEASE_COMMITS} entries`)
  }
  const seen = new Set()
  for (const [index, entry] of value.entries()) {
    requireObject(entry, `Release commit ${index + 1}`)
    if (
      Object.keys(entry).length !== 2 ||
      !Object.hasOwn(entry, 'sha') ||
      !Object.hasOwn(entry, 'subject')
    ) {
      throw new Error(`Release commit ${index + 1} must contain only sha and subject`)
    }
    requireSha(entry.sha, `Release commit ${index + 1} SHA`)
    requireSubject(entry.subject, `Release commit ${index + 1} subject`)
    if (seen.has(entry.sha)) throw new Error(`Duplicate release commit SHA: ${entry.sha}`)
    seen.add(entry.sha)
  }
  return value
}

export async function collectReleaseCommits({ sourceSha, request }) {
  requireSha(sourceSha, 'Source SHA')
  if (typeof request !== 'function') throw new Error('GitHub request function is required')
  const response = await request(`commits?sha=${sourceSha}&per_page=${MAX_API_COMMITS}`)
  if (!Array.isArray(response) || response.length > MAX_API_COMMITS) {
    throw new Error(`GitHub commit response must be an array of at most ${MAX_API_COMMITS} entries`)
  }

  const seen = new Set()
  const selected = []
  for (const [index, item] of response.entries()) {
    requireObject(item, `GitHub commit ${index + 1}`)
    const sha = requireSha(item.sha, `GitHub commit ${index + 1} SHA`)
    if (seen.has(sha)) throw new Error(`Duplicate GitHub commit SHA: ${sha}`)
    seen.add(sha)
    requireObject(item.commit, `GitHub commit ${index + 1} details`)
    const subject = commitSubject(item.commit.message, `GitHub commit ${index + 1}`)
    if (!Array.isArray(item.parents)) {
      throw new Error(`GitHub commit ${index + 1} parents must be an array`)
    }
    for (const [parentIndex, parent] of item.parents.entries()) {
      requireObject(parent, `GitHub commit ${index + 1} parent ${parentIndex + 1}`)
      requireSha(parent.sha, `GitHub commit ${index + 1} parent ${parentIndex + 1} SHA`)
    }
    if (item.parents.length > 1 || EXCLUDED_TYPE.test(subject)) continue
    if (selected.length < MAX_RELEASE_COMMITS) selected.push({ sha, subject })
  }
  return validateReleaseCommits(selected)
}

function escapeMarkdown(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1')
}

export function formatReleaseCommitLog(repository, commits) {
  if (typeof repository !== 'string' || !REPOSITORY.test(repository) || repository.includes('..')) {
    throw new Error('Invalid release repository')
  }
  validateReleaseCommits(commits)
  const lines = [
    '<details>',
    `<summary>Commit log (${commits.length} commits)</summary>`,
    '',
    ...(commits.length
      ? commits.map(
          ({ sha, subject }) =>
            `- [\`${sha.slice(0, 7)}\`](https://github.com/${repository}/commit/${sha}) ${escapeMarkdown(subject)}`
        )
      : ['Infrastructure changes only.']),
    '',
    '</details>'
  ]
  return lines.join('\n')
}
