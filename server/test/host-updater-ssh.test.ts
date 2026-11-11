import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { test } from 'node:test'
import ssh2 from 'ssh2'
import { HostUpdaterError, invokeHostUpdater, validateResponse } from '../src/host-updater-ssh.js'

test('dedicated updater SSH pins raw ed25519 key and sends only one bounded RPC', async () => {
  const host = ssh2.utils.generateKeyPairSync('ed25519')
  const clientKey = ssh2.utils.generateKeyPairSync('ed25519')
  const parsed = ssh2.utils.parseKey(host.private)
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed))
  const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
  let mode = 'ok', executions = 0
  const server = new ssh2.Server({ hostKeys: [host.private] }, client => {
    client.on('error', () => {})
    client.on('authentication', ctx => ctx.method === 'publickey' ? ctx.accept() : ctx.reject())
    client.on('ready', () => client.on('session', accept => {
      const session = accept()
      session.on('pty', (_accept, reject) => reject())
      session.on('exec', (accept, _reject, info) => {
        executions++
        assert.equal(info.command, 'proxmiu-host-updater')
        const stream = accept()
        let input = ''
        stream.on('data', b => { input += b.toString() })
        stream.on('end', () => {
          assert.deepEqual(JSON.parse(input), { action: 'inspect' })
          const reply = { protocol: 1, node: mode === 'wrong-node' ? 'other' : 'pve', result: { proxmoxVersion: '8.2.7', proxmoxMajor: 8, codename: 'bookworm', machineIdHash: 'a'.repeat(64), ready: true, rebootSuggested: false } }
          stream.write(mode === 'huge' ? 'x'.repeat(256 * 1024 + 1) : JSON.stringify(reply))
          stream.exit(0)
          stream.end()
        })
      })
    }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const config = { host: '127.0.0.1', port: (server.address() as { port: number }).port, fingerprint, privateKey: clientKey.private, node: 'pve' }
  try {
    const info = await invokeHostUpdater(config, { action: 'inspect' })
    assert.ok('ready' in info && info.ready)
    await assert.rejects(invokeHostUpdater({ ...config, fingerprint: 'SHA256:' + 'z'.repeat(43) }, { action: 'inspect' }), /pinned|verify|SSH/i)
    assert.equal(executions, 1)
    for (const value of ['wrong-node', 'huge']) {
      mode = value
      await assert.rejects(invokeHostUpdater(config, { action: 'inspect' }), /updater|response/i)
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('host result validation rejects protocol, duplicate JSON and incomplete or unsafe plans', () => {
  for (const text of ['{"protocol":1,"protocol":2,"node":"pve","result":{}}', '{"protocol":2,"node":"pve","result":{}}',
    '{"protocol":1,"node":"other","result":{}}', '[]', '{}{}']) {
    assert.throws(() => validateResponse(Buffer.from(text), 'pve'))
  }
  assert.throws(() => validateResponse(Buffer.from(JSON.stringify({ protocol: 1, node: 'pve', error: { code: 'stale_plan', message: 'private host detail' } })), 'pve'), error => error instanceof HostUpdaterError && error.rejected && !error.message.includes('private'))
  assert.throws(() => validateResponse(Buffer.from(JSON.stringify({ protocol: 1, node: 'pve', error: { code: 'unsafe_state', message: 'private host detail' } })), 'pve'), error => error instanceof HostUpdaterError && !error.rejected)
})
