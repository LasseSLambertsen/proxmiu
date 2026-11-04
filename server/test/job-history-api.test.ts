import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

async function port() {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const number = (server.address() as { port: number }).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return number
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill() })
}

test('authenticated real-agent restarts retain detail/list/status and never replay interrupted work', { timeout: 45_000 }, async () => {
  const data = mkdtempSync(join(tmpdir(), 'proxmiu-jobs-api-'))
  const appPort = await port()
  let externalConnections = 0
  const external = createServer(socket => { externalConnections++; socket.destroy() })
  await new Promise<void>(resolve => external.listen(0, '127.0.0.1', resolve))
  const vars = { ...process.env, PROXMIU_DATA_DIR: data, FIXTURE_PORT: String((external.address() as { port: number }).port), PROXMIU_PASSWORD: 'journal-test-password', HOST: '127.0.0.1', PORT: String(appPort) }
  const seed = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', 'server/test/fixtures/seed-job-history.ts'], { env: vars, encoding: 'utf8' }))
  let agent: ChildProcess | undefined
  const boot = async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: vars, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      let logs = ''
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Agent startup timed out: ' + logs.slice(-1000))) }, 15_000)
      const record = (chunk: Buffer) => { logs += chunk; if (logs.includes('Server listening')) { clearTimeout(timeout); resolve() } }
      child.stdout!.on('data', record); child.stderr!.on('data', record)
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Agent exited: ' + logs.slice(-1000))) })
    })
    return child
  }
  try {
    agent = await boot()
    const root = `http://127.0.0.1:${appPort}/api`
    const { token } = await fetch(root + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'journal-test-password' }) }).then(r => r.json())
    const request = (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => fetch(root + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    for (const path of ['/jobs', '/jobs/status', '/jobs/retained-complete']) {
      assert.equal((await fetch(root + path)).status, 401)
      assert.equal((await request(path, 'GET', undefined, { Origin: 'https://untrusted.test' })).status, 403)
    }
    const status = await request('/jobs/status').then(r => r.json())
    assert.equal(status.available, true)
    assert.equal(status.writable, true)
    assert.deepEqual(status.retention, { maxJobs: 50, maxLogLines: 5000, maxJobBytes: 131072 })
    const list = await request('/jobs').then(r => r.json())
    assert.equal(list.length, 3)
    assert.ok(list.every((job: { log?: unknown }) => job.log === undefined), 'List stays an array without log data')
    const complete = await request('/jobs/retained-complete').then(r => r.json())
    assert.equal(complete.status, 'success')
    assert.equal(complete.result.vmid, 123)
    const update = await request('/jobs/retained-update').then(r => r.json())
    assert.equal(update.status, 'error')
    assert.equal(update.kind, 'update')
    const interrupted = await request('/jobs/was-running').then(r => r.json())
    assert.equal(interrupted.status, 'interrupted')
    assert.deepEqual(interrupted.steps.map((s: { status: string }) => s.status), ['done', 'interrupted', 'skipped'])
    assert.equal(interrupted.finishedAt, undefined)
    assert.equal(interrupted.result, undefined)
    assert.ok(interrupted.interruptedAt)
    assert.equal(interrupted.target.vmid, 123)
    const apiText = JSON.stringify({ complete, interrupted, update })
    const journalText = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import { decrypt, DATA_DIR } from './server/src/store.ts'; import { readFileSync } from 'node:fs'; console.log(decrypt(readFileSync(DATA_DIR + '/jobs.json', 'utf8')))"], { env: vars, encoding: 'utf8' })
    for (const secret of ['xy', 'default-secret', 'long-option-token', 'fixture-credential']) {
      assert.ok(!apiText.includes(secret))
      assert.ok(!journalText.includes(secret))
    }
    assert.equal(externalConnections, 0, 'Loading and reading history cannot contact the saved source')
    await stop(agent)
    agent = await boot()
    assert.deepEqual(await request('/jobs/was-running').then(r => r.json()), interrupted)
    assert.equal((await request('/jobs').then(r => r.json())).length, 3)
    assert.equal(externalConnections, 0, 'A second actual restart also cannot replay a command')
    await stop(agent)
    const malformed = 'known malformed saved diagnostics'
    writeFileSync(join(data, 'jobs.json'), malformed)
    agent = await boot()
    assert.equal((await request('/jobs/status').then(r => r.json())).available, false)
    assert.equal((await request('/jobs')).status, 503)
    assert.equal((await request('/jobs/was-running')).status, 503)
    assert.equal((await request('/templates')).status, 200, 'Unrelated functions remain available')
    const provision = { clusterId: seed.clusterId, node: 'pve1', templateId: 'plain', kind: 'lxc', hostname: 'lab', cores: 1, memory: 512, disk: 4, storage: 'local-lvm' }
    assert.equal((await request('/provision', 'POST', provision)).status, 503)
    assert.equal((await request('/updates', 'POST', { clusterId: seed.clusterId, node: 'pve1', type: 'lxc', vmid: 123 })).status, 503)
    assert.equal(readFileSync(join(data, 'jobs.json'), 'utf8'), malformed)
    assert.equal(externalConnections, 0, 'Unavailable history rejects both starts before even preflight traffic')
  } finally { await stop(agent); await new Promise<void>(resolve => external.close(() => resolve())) }
})
