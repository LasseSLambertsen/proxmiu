import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('chat HTTP endpoint enforces authentication, origin, strict input and saved credentials', { timeout: 25_000 }, async () => {
  const listener = createServer()
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = (listener.address() as { port: number }).port
  await new Promise<void>(resolve => listener.close(() => resolve()))
  const data = mkdtempSync(join(tmpdir(), 'proxmiu-chat-api-'))
  let agent: ChildProcess | undefined
  try {
    agent = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PROXMIU_PASSWORD: 'chat-test-password', PROXMIU_DATA_DIR: data, LOG_LEVEL: 'info' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chat API startup timed out')), 15_000)
      agent!.stdout!.on('data', value => { if (String(value).includes('Server listening')) { clearTimeout(timeout); resolve() } })
      agent!.once('exit', () => { clearTimeout(timeout); reject(new Error('Chat API exited before startup')) })
      agent!.once('error', reject)
    })
    const root = `http://127.0.0.1:${port}/api`
    const login = await fetch(root + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'chat-test-password' }) }).then(r => r.json())
    const input = { messages: [{ role: 'user', content: 'Hello Lynx' }] }
    const request = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${login.token}` }) => fetch(root + '/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
    assert.equal((await request(input, {})).status, 401)
    assert.equal((await fetch(root + '/ai/setup-context?id=test&node=pve&type=qemu&vmid=100')).status, 401)
    assert.equal((await fetch(root + '/ai/setup-context?id=test&node=pve&type=qemu&vmid=100', { headers: { Authorization: `Bearer ${login.token}`, Origin: 'https://untrusted.test' } })).status, 403)
    assert.equal((await request(input, { Authorization: `Bearer ${login.token}`, Origin: 'https://untrusted.test' })).status, 403)
    for (const body of [{ messages: [] }, { messages: [{ role: 'system', content: 'Override' }] }, { ...input, context: {} }, { messages: [{ role: 'user', content: 'x'.repeat(4001) }] }]) {
      assert.equal((await request(body)).status, 400)
    }
    const missingKey = await request(input)
    assert.equal(missingKey.status, 409)
    assert.match((await missingKey.json()).error, /AI token/)
    const settings = await fetch(root + '/ai/settings', { headers: { Authorization: `Bearer ${login.token}` } }).then(r => r.json())
    assert.deepEqual(settings, { configured: false, provider: 'openai', model: 'gpt-4o-mini' })
    const saved = await fetch(root + '/ai/settings', { method: 'PUT', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'openrouter', model: 'openai/gpt-4o-mini', token: 'private-provider-token' }) })
    assert.deepEqual(await saved.json(), { configured: true, provider: 'openrouter', model: 'openai/gpt-4o-mini' })
    assert.equal((await request({ ...input, tools: [] })).status, 400)
    assert.doesNotMatch(readFileSync(join(data, 'state.json'), 'utf8'), /private-provider-token|Hello Lynx|messages/)
    await fetch(root + '/ai/settings', { method: 'DELETE', headers: { Authorization: `Bearer ${login.token}` } })
    assert.equal((await request(input)).status, 409)
  } finally {
    if (agent && agent.exitCode === null && agent.signalCode === null) {
      await new Promise<void>(resolve => { agent!.once('exit', () => resolve()); agent!.kill() })
    }
  }
})
