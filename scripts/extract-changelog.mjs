import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function extractChangelogVersion(source, version) {
  if (!version) {
    throw new Error('A changelog version is required')
  }

  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const headingPrefix = `## [${version}]`
  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line === headingPrefix || line.startsWith(`${headingPrefix} - `))

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one changelog section for ${version}, found ${matches.length}`
    )
  }

  const start = matches[0].index + 1
  const nextSectionOffset = lines.slice(start).findIndex(line => line.startsWith('## '))
  const end = nextSectionOffset === -1 ? lines.length : start + nextSectionOffset
  const fragment = lines.slice(start, end).join('\n').trim()

  if (!fragment) {
    throw new Error(`Changelog section for ${version} is empty`)
  }

  return fragment
}

const isCli =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isCli) {
  const [, , version, changelogPath = 'CHANGELOG.md', productNotesPath] = process.argv

  try {
    const source = readFileSync(changelogPath, 'utf8')
    const fragment = extractChangelogVersion(source, version)
    if (productNotesPath) {
      const { parseProductReleaseNotesManifest } =
        await import('../packages/extension/src/lib/extension-update.ts')
      parseProductReleaseNotesManifest(JSON.parse(readFileSync(productNotesPath, 'utf8')), version)
    }
    process.stdout.write(`${fragment}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Failed to extract changelog: ${message}\n`)
    process.exitCode = 1
  }
}
