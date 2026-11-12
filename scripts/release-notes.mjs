import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function buildReleaseNotes(markdown, { tag, version, repository }) {
  const semver = typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  if (!semver || semver[4]?.split('.').some(id => /^\d+$/.test(id) && id.length > 1 && id.startsWith('0'))) throw new Error('Package version must be valid SemVer.')
  if (typeof tag !== 'string' || tag !== `v${version}`) throw new Error('Release tag must exactly match the package version, prefixed with v.')
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Release repository must use owner/name format.')
  if (typeof markdown !== 'string') throw new Error('Changelog must be Markdown text.')
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const headings = []
  let fence
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
      continue
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length }; continue }
    if (line.startsWith('## ')) headings.push({ index, release: /^## \[([^\]]+)\](.*)$/.exec(line) })
  }
  if (fence) throw new Error('Changelog contains an unclosed code fence.')
  const matches = headings.filter(h => h.release?.[1] === version)
  if (matches.length !== 1) throw new Error('Changelog must contain exactly one section for the release version.')
  const heading = matches[0], date = /^ - (\d{4}-\d{2}-\d{2})\s*$/.exec(heading.release[2])?.[1]
  const parsedDate = date && new Date(`${date}T00:00:00Z`)
  if (!parsedDate || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) throw new Error('Release changelog section must have a valid YYYY-MM-DD date.')
  const end = headings.find(h => h.index > heading.index)?.index ?? lines.length
  const bodyLines = lines.slice(heading.index + 1, end)
  // Keep Changelog puts version-link definitions at the end, outside release prose.
  while (bodyLines.length && (!bodyLines.at(-1).trim() || /^\[[^\]]+\]:\s+/.test(bodyLines.at(-1)))) bodyLines.pop()
  const body = bodyLines.join('\n').trim()
  if (!body.replace(/<!--[\s\S]*?-->/g, '').split('\n').some(line => line.trim() && !line.trim().startsWith('#'))) throw new Error('Release changelog section must contain user-visible changes.')
  return {
    version,
    prerelease: semver[1] === '0' || semver[4] !== undefined,
    body: `${body}\n\n[Full changelog](https://github.com/${repository}/blob/${tag}/CHANGELOG.md)\n`,
  }
}

function main() {
  const args = process.argv.slice(2)
  const values = new Map()
  for (let i = 0; i < args.length; i += 2) {
    if (!['--tag', '--output'].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error('Usage: node scripts/release-notes.mjs --tag vVERSION --output FILE')
    values.set(args[i], args[i + 1])
  }
  const tag = values.get('--tag') ?? process.env.GITHUB_REF_NAME
  const output = values.get('--output')
  if (!output) throw new Error('A release notes output file is required.')
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const result = buildReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), { tag, version, repository: process.env.GITHUB_REPOSITORY ?? 'LasseSLambertsen/proxmiu' })
  writeFileSync(output, result.body)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\nprerelease=${result.prerelease}\n`)
  process.stdout.write(`Prepared release notes for ${result.version}.\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main() } catch (error) {
    process.stderr.write(`Could not prepare release notes: ${error.message}\n`)
    process.exitCode = 1
  }
}
