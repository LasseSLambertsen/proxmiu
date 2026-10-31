import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-test-'))
const { expandCidr } = await import('../src/network.js')
const { buildScript, buildUpdateScript, builtinTemplates, templateSchema } = await import('../src/templates.js')
const { buildCommunityScript, githubRawUrl } = await import('../src/template-sources.js')
const { encrypt, decrypt } = await import('../src/store.js')

test('expandCidr skips network and broadcast addresses', () => {
  const hosts = expandCidr('192.168.1.77/24')
  assert.equal(hosts.length, 254)
  assert.equal(hosts[0], '192.168.1.1')
  assert.equal(hosts.at(-1), '192.168.1.254')
  assert.deepEqual(expandCidr('10.0.0.5/32'), ['10.0.0.5'])
})

test('expandCidr rejects ranges that are too wide', () => {
  assert.throws(() => expandCidr('10.0.0.0/8'))
  assert.throws(() => expandCidr('not-a-cidr'))
})

test('secrets round-trip through encryption', () => {
  const enc = encrypt('token-secret')
  assert.notEqual(enc, 'token-secret')
  assert.equal(decrypt(enc), 'token-secret')
})

const hasBash = (() => {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('generated scripts are valid bash and quote hostile values safely', (t) => {
  if (!hasBash) return t.skip('bash is not installed')
  const nasty = `it's "$(rm -rf /)" \`whoami\` $HOME`
  for (const t of builtinTemplates) {
    const script = buildScript(t, { PM_USER: 'dev', PM_HOSTNAME: 'box', PM_SSH_KEYS: 'ssh-ed25519 AAA x', OPT_GIT_NAME: nasty })
    execFileSync('bash', ['-n'], { input: script })
    const exported = script.split('\n').find((l) => l.startsWith('export OPT_GIT_NAME='))!
    assert.equal(execFileSync('bash', ['-c', `${exported}; printf %s "$OPT_GIT_NAME"`]).toString(), nasty)
  }
})

test('update scripts include helpers and are valid bash', (t) => {
  if (!hasBash) return t.skip('bash is not installed')
  const script = buildUpdateScript(builtinTemplates[0], { PM_USER: 'dev', PM_HOSTNAME: 'box' }, 'echo updating')
  execFileSync('bash', ['-n'], { input: script })
  assert.match(script, /install_node\(\)/)
  assert.match(script, /echo updating/)
  assert.doesNotMatch(script, /Updating packages/)
})

test('built-in installers use the public scripts repo', () => {
  for (const id of ['claude-code', 'codex', 'ai-devbox', 'docker-host', 'opencode']) {
    const template = builtinTemplates.find((t) => t.id === id)
    assert.equal(template?.source?.type, 'github')
    assert.equal(template?.source?.repo, 'LasseSLambertsen/proxmiu-scripts')
    assert.match(template?.source?.path ?? '', /^scripts\/[a-z-]+\.sh$/)
  }
})

const baseTemplate = {
  id: 'source-test',
  name: 'Source test',
  resources: { cores: 1, memory: 512, disk: 2 },
}

test('template sources validate and default their ref', () => {
  const github = templateSchema.parse({ ...baseTemplate, source: { type: 'github', repo: 'owner/repo', path: 'scripts/install.sh' } })
  assert.equal(github.source?.type, 'github')
  assert.equal(github.source?.ref, 'main')
  assert.equal(
    githubRawUrl(github.source as Extract<NonNullable<typeof github.source>, { type: 'github' }>),
    'https://raw.githubusercontent.com/owner/repo/main/scripts/install.sh',
  )

  const community = templateSchema.parse({ ...baseTemplate, source: { type: 'community-scripts', slug: 'docker' } })
  assert.equal(community.source?.type, 'community-scripts')
  assert.equal(community.source?.ref, 'main')

  assert.throws(() => templateSchema.parse({ ...baseTemplate, source: { type: 'github', repo: 'owner/repo', path: '../escape.sh' } }))
  assert.throws(() => templateSchema.parse({ ...baseTemplate, source: { type: 'github', repo: 'not-a-repo', path: 'a.sh' } }))
})

test('community installer wrapper is valid bash', (t) => {
  if (!hasBash) return t.skip('bash is not installed')
  const tpl = templateSchema.parse({ ...baseTemplate, source: { type: 'community-scripts', slug: 'docker' } })
  const script = buildCommunityScript(
    tpl,
    { var_docker_socket: `it's "$(rm -rf /)"`, PM_HOSTNAME: 'box' },
    { install: 'echo install', engine: 'echo engine', scriptsBase: 'https://example.test/main', coreBase: 'https://example.test/core' },
  )
  execFileSync('bash', ['-n'], { input: script })
  assert.match(script, /FUNCTIONS_FILE_PATH=/)
  assert.match(script, /PROXMIU_SCRIPT_EOF/)
  assert.match(script, /^export COMMUNITY_SCRIPTS_URL='https:\/\/example\.test\/main'$/m)
})
