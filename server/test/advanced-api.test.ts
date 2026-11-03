import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

async function port() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const number = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return number
}
async function boot(file: string, env: NodeJS.ProcessEnv, ready: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Test server startup timed out')) }, 15_000)
    child.stdout!.on('data', buffer => { if (String(buffer).includes(ready)) { clearTimeout(timeout); resolve() } })
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Test server exited (${code})`)) })
    child.once('error', reject)
  })
  return child
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill() })
}

const hasOpenSsl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true } catch { return false } })()
test('authenticated API integrates Proxmox descriptions, task tracking, safe operations and AI privacy', { timeout: 35_000, skip: !hasOpenSsl && 'The bundled HTTPS mock requires OpenSSL' }, async () => {
  let mock: ChildProcess | undefined
  let agent: ChildProcess | undefined
  const mockPort = await port()
  const agentPort = await port()
  try {
    mock = await boot('server/dev/mock-proxmox.ts', { MOCK_PORT: String(mockPort) }, 'Mock Proxmox API')
    agent = await boot('server/src/index.ts', { PORT: String(agentPort), HOST: '127.0.0.1', PROXMIU_PASSWORD: 'integration-test-password', LOG_LEVEL: 'info', PROXMIU_DATA_DIR: mkdtempSync(join(tmpdir(), 'proxmiu-api-')) }, 'Server listening')
    const root = `http://127.0.0.1:${agentPort}/api`
    const login = await fetch(`${root}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'integration-test-password' }) }).then(r => r.json()) as { token: string }
    const request = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => fetch(root + path, { method, headers: { Authorization: `Bearer ${login.token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    assert.equal((await fetch(root + '/ai/settings')).status, 401)
    assert.equal((await request('/ai/settings', 'GET', undefined, { Origin: 'https://untrusted.test' })).status, 403)
    const connected = await request('/clusters', 'POST', { name: 'Fixture lab', host: '127.0.0.1', port: mockPort, authType: 'token', username: 'root@pam!proxmiu', secret: 'mock' })
    assert.equal(connected.status, 200)
    const connection = await connected.json() as { id: string }
    const base = `/clusters/${connection.id}/guests/pve1/lxc/101`
    const original = await request(base + '/notes').then(r => r.json()) as { notes: string; digest: string }
    assert.match(original.notes, /pihole/)
    const saved = await request(base + '/notes', 'PUT', { notes: 'Native Proxmox note', digest: original.digest })
    assert.equal(saved.status, 200)
    assert.equal((await request(base + '/insights').then(r => r.json()) as { config: { description: string } }).config.description, 'Native Proxmox note')
    assert.equal((await request(base + '/notes', 'PUT', { notes: 'Stale update', digest: original.digest })).status, 409)
    const current = await saved.json() as { digest: string }
    assert.equal((await request(base + '/notes', 'PUT', { notes: '', digest: current.digest })).status, 200)
    assert.equal((await request(base + '/notes').then(r => r.json()) as { notes: string }).notes, '')
    assert.equal((await request(`/guest-metadata/${connection.id}/lxc/101`, 'PUT', { notes: 'Old client' })).status, 400)
    assert.equal((await request(base + '/operations', 'POST', { action: 'snapshot', name: 'current' })).status, 400)
    const operation = await request(base + '/operations', 'POST', { action: 'snapshot', name: 'before-update' }).then(r => r.json()) as { upid: string; node: string }
    assert.ok(operation.upid.startsWith('UPID:'))
    const taskPath = `/clusters/${connection.id}/tasks/pve1/${encodeURIComponent(operation.upid)}`
    const pending = await request(taskPath).then(r => r.json()) as { status: string }
    assert.ok(['running', 'stopped'].includes(pending.status))
    assert.equal((await request(`/clusters/${connection.id}/tasks/pve2/${encodeURIComponent(operation.upid)}`)).status, 404)
    await new Promise(resolve => setTimeout(resolve, 1300))
    assert.deepEqual(await request(taskPath).then(r => r.json()), { status: 'stopped', exitstatus: 'OK' })
    assert.equal((await request(base + '/operations', 'POST', { action: 'rollback', name: 'before-update', confirm: 'wrong' })).status, 409)
    assert.equal((await request(base + '/operations', 'POST', { action: 'backup', storage: 'local' })).status, 200)
    assert.equal((await request(base + '/operations', 'POST', { action: 'migrate', target: 'pve2' })).status, 200)
    const overview = await request('/overview').then(r => r.json()) as { clusters: { guests: { vmid: number; node: string }[] }[] }
    assert.equal(overview.clusters[0].guests.find(g => g.vmid === 101)?.node, 'pve2')
    assert.equal((await request('/ai/settings', 'PUT', { provider: 'openai', model: 'gpt-4o-mini', token: 'not-a-real-key' })).status, 200)
    assert.doesNotMatch(JSON.stringify(await request('/ai/settings').then(r => r.json())), /not-a-real-key|token/)
    const contextResponse = await request('/ai/context')
    assert.equal(contextResponse.status, 200)
    const context = await contextResponse.json()
    assert.ok(context.clusters[0].guests.length > 0)
    assert.doesNotMatch(JSON.stringify(context), /pihole|Fixture lab|192\.168|vmid|description|secret|not-a-real-key/)
    // No real provider is contacted: both requests must fail before transport.
    assert.equal((await request('/ai/review', 'POST', { consent: false, context })).status, 400)
    assert.equal((await request('/ai/review', 'POST', { consent: true, context: { ...context, description: 'do not send' } })).status, 400)
    assert.equal((await request('/ai/settings', 'DELETE')).status, 200)
    assert.equal((await request('/ai/settings').then(r => r.json()) as { configured: boolean }).configured, false)
  } finally { await stop(agent); await stop(mock) }
})
