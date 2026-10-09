import { test as it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractChangelogVersion } from '../../../scripts/extract-changelog.mjs'

const changelog = `# Changelog

## [1.0.26] - 2026-07-19

### Added

- Current release

## [1.0.25] - 2026-07-13

### Fixed

- Previous release
`

describe('Production changelog extraction', () => {
  it('extracts only the requested release body', () => {
    assert.equal(extractChangelogVersion(changelog, '1.0.26'), '### Added\n\n- Current release')
  })

  it('supports the final release section', () => {
    assert.equal(extractChangelogVersion(changelog, '1.0.25'), '### Fixed\n\n- Previous release')
  })

  it('rejects a missing release section', () => {
    assert.throws(
      () => extractChangelogVersion(changelog, '1.0.27'),
      /Expected exactly one changelog section for 1\.0\.27, found 0/
    )
  })

  it('rejects duplicate release sections', () => {
    assert.throws(
      () => extractChangelogVersion(`${changelog}\n## [1.0.26]\n\n- Duplicate`, '1.0.26'),
      /Expected exactly one changelog section for 1\.0\.26, found 2/
    )
  })

  it('rejects an empty release section', () => {
    assert.throws(() => extractChangelogVersion('## [1.0.26]\n\n', '1.0.26'), /is empty/)
  })
})

describe('Production release notes validation', () => {
  function runReleaseCheck(t, releases) {
    const directory = mkdtempSync(path.join(tmpdir(), 'noir-release-notes-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const changelogPath = path.join(directory, 'CHANGELOG.md')
    const notesPath = path.join(directory, 'changelog.json')
    writeFileSync(changelogPath, changelog)
    writeFileSync(notesPath, JSON.stringify({ schemaVersion: 1, releases }))
    return spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../../scripts/extract-changelog.mjs', import.meta.url)),
        '1.0.26',
        changelogPath,
        notesPath
      ],
      { encoding: 'utf8' }
    )
  }

  it('accepts matching product notes and preserves the developer release body', t => {
    const result = runReleaseCheck(t, { '1.0.26': { changes: ['Current release'] } })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '### Added\n\n- Current release\n')
  })

  it('blocks publication when product notes belong to another version', t => {
    const result = runReleaseCheck(t, { '1.0.25': { changes: ['Previous release'] } })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /release notes for version 1\.0\.26 were not found/)
    assert.equal(result.stdout, '')
  })

  it('blocks product notes that the wallet cannot display', t => {
    const result = runReleaseCheck(t, { '1.0.26': { changes: ['x'.repeat(121)] } })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /at most 120 characters/)
    assert.equal(result.stdout, '')
  })
})
