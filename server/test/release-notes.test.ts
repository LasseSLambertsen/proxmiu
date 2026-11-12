import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildReleaseNotes } from '../../scripts/release-notes.mjs'

const options = { tag: 'v0.1.0', version: '0.1.0', repository: 'LasseSLambertsen/proxmiu' }
const changelog = `# Changelog

## [Unreleased]
- NOT RELEASED: unfinished disk growth.

## [0.2.0] - 2026-11-13
- A different version.

## [0.1.0] - 2026-11-12
### Added
- Reviewed restore and graphical displays.

### Validation
- Real Proxmox validation remains pending.

## [0.0.1] - 2026-11-01
- Old work.

[Unreleased]: https://example.invalid/future
[0.1.0]: https://example.invalid/old-link
`

test('release notes use only the exact dated version and an explicit full-changelog link', () => {
  const release = buildReleaseNotes(changelog, options)
  assert.equal(release.version, '0.1.0')
  assert.equal(release.prerelease, true)
  assert.match(release.body, /Reviewed restore and graphical displays/)
  assert.match(release.body, /Real Proxmox validation remains pending/)
  assert.match(release.body, /https:\/\/github.com\/LasseSLambertsen\/proxmiu\/blob\/v0.1.0\/CHANGELOG.md/)
  assert.doesNotMatch(release.body, /NOT RELEASED|different version|Old work|example.invalid/)
})

test('fenced example headings do not become release sections and Windows newlines are normalized', () => {
  const text = ['# Changelog', '```md', '## [0.1.0] - 2026-11-01', '- Fenced unrelated example.', '```', '## [0.1.0] - 2026-11-12', '- Actual release.', '~~~md', '## [9.9.9] - 2026-11-12', '- Example inside release.', '~~~', '## [0.0.1] - 2026-11-01', '- Older release.'].join('\r\n')
  const release = buildReleaseNotes(text, options)
  assert.match(release.body, /Actual release/)
  assert.match(release.body, /Example inside release/)
  assert.doesNotMatch(release.body, /Fenced unrelated|Older release|\r/)
})

test('tags must be valid SemVer matching package version and repository values cannot inject markdown', () => {
  for (const tag of ['0.1.0', 'v0.2.0', 'v0.1.0\n--latest', 'v0.1.0$(command)', 'v01.1.0']) assert.throws(() => buildReleaseNotes(changelog, { ...options, tag }))
  assert.throws(() => buildReleaseNotes(changelog, { ...options, version: '1.0.0-01', tag: 'v1.0.0-01' }))
  assert.throws(() => buildReleaseNotes(changelog, { ...options, repository: 'owner/repo)\nInjected' }))
})

test('missing, duplicate, empty, invalid-date and unclosed-fence sections fail without fallback notes', () => {
  for (const text of [
    '# Changelog\n## [Unreleased]\n- Not released.',
    changelog + '\n## [0.1.0] - 2026-11-12\n- Duplicate.',
    '## [0.1.0] - 2026-11-12\n### Added\n\n',
    '## [0.1.0]\n- Missing date.',
    '## [0.1.0] - 2026-02-30\n- Invalid date.',
    '## [0.1.0] - 2026-11-12\n```\n- Unclosed code block.',
  ]) assert.throws(() => buildReleaseNotes(text, options))
})

test('zero-major and SemVer preview identifiers are prereleases; build metadata alone is stable', () => {
  for (const [version, prerelease] of [['0.1.0', true], ['1.0.0-rc.1', true], ['1.0.0', false], ['1.0.0+build-preview', false]] as const) {
    const text = `## [${version}] - 2026-11-12\n- Reviewed changes.\n`
    assert.equal(buildReleaseNotes(text, { ...options, tag: 'v' + version, version }).prerelease, prerelease)
  }
})

test('CLI writes exact notes and safe step outputs; a mismatch leaves existing notes untouched', () => {
  const folder = mkdtempSync(join(tmpdir(), 'proxmiu-release-notes-'))
  try {
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ version: '0.1.0' }))
    writeFileSync(join(folder, 'CHANGELOG.md'), changelog)
    const notes = join(folder, 'notes.md'), output = join(folder, 'step-output')
    const script = fileURLToPath(new URL('../../scripts/release-notes.mjs', import.meta.url))
    const run = (tag: string) => spawnSync(process.execPath, [script, '--tag', tag, '--output', notes], { cwd: folder, env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: options.repository }, encoding: 'utf8' })
    const success = run('v0.1.0')
    assert.equal(success.status, 0, success.stderr)
    assert.equal(readFileSync(notes, 'utf8'), buildReleaseNotes(changelog, options).body)
    assert.equal(readFileSync(output, 'utf8'), 'version=0.1.0\nprerelease=true\n')
    assert.doesNotMatch(success.stdout, /NOT RELEASED/)
    const saved = readFileSync(notes, 'utf8')
    const mismatch = run('v0.2.0')
    assert.equal(mismatch.status, 1)
    assert.equal(readFileSync(notes, 'utf8'), saved)
    assert.equal(readFileSync(output, 'utf8'), 'version=0.1.0\nprerelease=true\n')
  } finally { rmSync(folder, { recursive: true, force: true }) }
})

test('a malformed second same-version heading is still a duplicate', () => {
  assert.throws(() => buildReleaseNotes(changelog + '\n## [0.1.0] - TBD\n- Draft duplicate.', options), /exactly one/)
})

test('HTML comments alone do not count as user-visible release changes', () => {
  assert.throws(() => buildReleaseNotes('## [0.1.0] - 2026-11-12\n<!-- TODO: write real release notes -->', options), /user-visible/)
})
