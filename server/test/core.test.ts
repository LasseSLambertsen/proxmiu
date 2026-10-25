import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-test-'))
const { expandCidr } = await import('../src/network.js')
const { buildScript, builtinTemplates } = await import('../src/templates.js')
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

test('generated scripts are valid bash and quote hostile values safely', () => {
  const nasty = `it's "$(rm -rf /)" \`whoami\` $HOME`
  for (const t of builtinTemplates) {
    const script = buildScript(t, { PM_USER: 'dev', PM_HOSTNAME: 'box', PM_SSH_KEYS: 'ssh-ed25519 AAA x', OPT_GIT_NAME: nasty })
    execFileSync('bash', ['-n'], { input: script })
    const exported = script.split('\n').find((l) => l.startsWith('export OPT_GIT_NAME='))!
    assert.equal(execFileSync('bash', ['-c', `${exported}; printf %s "$OPT_GIT_NAME"`]).toString(), nasty)
  }
})
