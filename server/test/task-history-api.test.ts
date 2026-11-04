import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Agent, fetch as upstreamFetch } from 'undici'

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const result = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return result
}
async function boot(file: string, vars: NodeJS.ProcessEnv, ready: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', file], { env: { ...process.env, ...vars }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Test server startup timed out')) }, 15_000)
    child.stdout!.on('data', value => { if (String(value).includes(ready)) { clearTimeout(timeout); resolve() } })
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Test server exited before startup')) })
    child.once('error', reject)
  })
  return child
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill() })
}
const openssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('native history restores scoped task log access after restart without authorizing forged or other-source IDs', { timeout: 45_000, skip: !openssl && 'The HTTPS mock requires OpenSSL' }, async () => {
  const pvePort = await freePort()
  const appPort = await freePort()
  const data = mkdtempSync(join(tmpdir(), 'proxmiu-history-api-'))
  const tls = new Agent({ connect: { rejectUnauthorized: false } })
  let pve: ChildProcess | undefined
  let agent: ChildProcess | undefined
  const startAgent = () => boot('server/src/index.ts', { HOST: '127.0.0.1', PORT: String(appPort), PROXMIU_PASSWORD: 'history-test-password', PROXMIU_DATA_DIR: data, LOG_LEVEL: 'info' }, 'Server listening')
  try {
    pve = await boot('server/dev/mock-proxmox.ts', { MOCK_PORT: String(pvePort) }, 'Mock Proxmox API')
    agent = await startAgent()
    const root = `http://127.0.0.1:${appPort}/api`
    const login = await fetch(root + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'history-test-password' }) }).then(r => r.json())
    const request = (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => fetch(root + path, { method, headers: { Authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const connBody = { name: 'History lab', host: '127.0.0.1', port: pvePort, authType: 'token', username: 'root@pam!proxmiu', secret: 'mock' }
    const first = await request('/clusters', 'POST', connBody).then(r => r.json())
    const second = await request('/clusters', 'POST', connBody).then(r => r.json())
    const rawResponse = await upstreamFetch(`https://127.0.0.1:${pvePort}/api2/json/nodes/pve1/tasks?source=all&vmid=110`, { dispatcher: tls, headers: { Authorization: 'PVEAPIToken=root@pam!proxmiu=mock' } })
    assert.equal(rawResponse.status, 200)
    const raw = await rawResponse.json() as { data: { upid: string }[] }
    assert.ok(raw.data.length > 0, 'The Proxmox mock must contain history from before the agent started')
    const upid = encodeURIComponent(raw.data[0].upid)
    assert.ok(upid.length > 100, 'Native task IDs can exceed the router default when an API token owner is included')
    const task = `/clusters/${first.id}/tasks/pve1/${upid}`
    const history = `/clusters/${first.id}/task-history?node=pve1&vmid=110`
    assert.equal((await request(task + '/log')).status, 404)
    assert.equal((await fetch(root + history)).status, 401)
    assert.equal((await request(history, 'GET', undefined, { Origin: 'https://untrusted.test' })).status, 403)
    const listed = await request(history)
    assert.equal(listed.status, 200)
    const page = await listed.json()
    assert.ok(page.tasks.length > 0)
    assert.ok(page.tasks.every((t: { node: string; vmid: number }) => t.node === 'pve1' && t.vmid === 110))
    assert.equal((await request(task)).status, 200)
    const logResponse = await request(task + '/log')
    assert.equal(logResponse.status, 200)
    assert.ok((await logResponse.json()).lines.length > 0)
    assert.equal((await request(`/clusters/${second.id}/tasks/pve1/${upid}/log`)).status, 404)
    assert.equal((await request(`/clusters/${first.id}/tasks/pve2/${upid}/log`)).status, 404)
    assert.equal((await request(`/clusters/${first.id}/tasks/pve1/UPID%3Aforged/log`)).status, 404)
    assert.equal((await request(history + '&start=-1')).status, 400)
    assert.equal((await request(history + '&limit=10000')).status, 400)
    await stop(agent)
    agent = await startAgent()
    // Same persisted auth/connection, fresh in-memory access cache.
    assert.equal((await request(task + '/log')).status, 404)
    assert.equal((await request(history)).status, 200)
    assert.equal((await request(task + '/log')).status, 200)
  } finally { await stop(agent); await stop(pve); await tls.close() }
})
