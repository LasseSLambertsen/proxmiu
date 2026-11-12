import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import https from 'node:https'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import selfsigned from 'selfsigned'

const GiB = 1024 ** 3
test('authenticated disk growth integrates exact native PUT, stale review, observed capacity and native restart recovery', { timeout: 40000 }, async () => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  const volume = 'local-lvm:vm-100-disk-0'
  const upid = 'UPID:pve1:00000123:00000456:12345678:resize:100:root@pam:'
  const writes: { path: string; fields: Record<string, string> }[] = []
  const reads: { path: string; params: Record<string, string> }[] = []
  let capacity = 8 * GiB, digest = 'a'.repeat(40), active = false, accepted = false, result: unknown = upid
  const raw = () => volume + ',cache=none,iothread=1,discard=on,backup=0,size=2G'
  const taskRow = () => ({ upid, node: 'pve1', type: 'resize', id: '100', starttime: 0x12345678, ...(active ? { status: 'RUNNING' } : { endtime: 0x12345678 + 10, status: 'WARNINGS: 1' }) })
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    const url = new URL(req.url!, 'https://localhost'), path = url.pathname.replace('/api2/json', '')
    if (req.headers.authorization !== 'PVEAPIToken=root@pam!fixture=private-api-secret') { res.writeHead(401).end(); return }
    let data: unknown
    if (req.method === 'PUT') {
      let body = ''; for await (const chunk of req) body += chunk
      writes.push({ path, fields: Object.fromEntries(new URLSearchParams(body)) })
      assert.equal(path, '/nodes/pve1/qemu/100/resize')
      active = accepted = true; data = result
    } else {
      assert.equal(req.method, 'GET', 'No power/config/delete/provision operations are permitted')
      reads.push({ path, params: Object.fromEntries(url.searchParams) })
      if (path === '/version') data = { version: '8.4.21' }
      else if (path === '/cluster/status') data = []
      else if (path === '/nodes') data = [{ node: 'pve1', status: 'online' }]
      else if (path === '/cluster/resources') data = [{ type: 'qemu', vmid: 100, node: 'pve1', status: 'stopped', name: 'diskbox' }]
      else if (path === '/access/permissions') data = { '/nodes/pve1': { 'Sys.Audit': 0 } }
      else if (path.endsWith('/config')) data = { name: 'diskbox', digest, scsi0: raw(), net0: 'private-network-options', description: 'private-native-notes', memory: 2048 }
      else if (path.endsWith('/status/current')) data = { status: 'stopped', ha: { managed: 0 } }
      else if (path.endsWith('/pending')) data = []
      else if (path.endsWith('/snapshot')) data = [{ name: 'current' }]
      else if (path.endsWith('/storage')) data = [{ storage: 'local-lvm', active: 1, enabled: 1, content: 'images', type: 'lvmthin', avail: 100 * GiB }]
      else if (path.endsWith('/content')) data = [{ volid: volume, vmid: 100, format: 'raw', content: 'images' }]
      else if (path.endsWith('/content/' + encodeURIComponent(volume))) data = { format: 'raw', size: capacity }
      else if (path.endsWith('/tasks')) data = accepted && (url.searchParams.get('source') !== 'active' || active) ? [taskRow()] : []
      else if (path.endsWith('/status')) data = active ? { status: 'running' } : { status: 'stopped', exitstatus: 'WARNINGS: 1' }
      else if (path.endsWith('/log')) data = [{ n: 1, t: 'Disk volume expanded; inspect filesystem warning.' }]
      else { res.writeHead(404).end(); return }
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data }))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const fixturePort = (upstream.address() as { port: number }).port
  const portSocket = createServer(); portSocket.listen(0, '127.0.0.1'); await once(portSocket, 'listening')
  const port = (portSocket.address() as { port: number }).port; await new Promise<void>(r => portSocket.close(() => r()))
  const dir = mkdtempSync(join(tmpdir(), 'disk-growth-api-'))
  let agent: ChildProcess | undefined, logs = ''
  async function boot() {
    agent = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PROXMIU_DATA_DIR: dir, PROXMIU_PASSWORD: 'fixture-agent-password' }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 15000)
      agent!.stdout!.on('data', b => { logs += String(b); if (String(b).includes('Server listening')) { clearTimeout(timer); resolve() } })
      agent!.stderr!.on('data', b => { logs += String(b) })
      agent!.once('exit', code => { clearTimeout(timer); reject(new Error('Agent exit: ' + code)) })
    })
  }
  async function stop() { if (agent && agent.exitCode === null) { const exit = once(agent, 'exit'); agent.kill(); await exit } }
  try {
    await boot()
    const root = `http://127.0.0.1:${port}/api`
    const login = await (await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'fixture-agent-password' }) })).json()
    const request = (path: string, method = 'GET', body?: unknown, headers = {}) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const connection = await (await request('/clusters', 'POST', { name: 'Disk fixture', host: '127.0.0.1', port: fixturePort, authType: 'token', username: 'root@pam!fixture', secret: 'private-api-secret', verifyTls: false })).json()
    const base = `/clusters/${connection.id}/guests/pve1/qemu/100`
    assert.equal((await fetch(root + base + '/disk-capacity')).status, 401)
    const inventoryResponse = await request(base + '/disk-capacity')
    assert.equal(inventoryResponse.status, 200)
    const inventory = await inventoryResponse.json()
    assert.equal(inventory.ready, true); assert.equal(inventory.disks[0].sizeBytes, 8 * GiB)
    assert.doesNotMatch(JSON.stringify(inventory), /private-|cache=|digest|net0|description/)
    assert.ok(reads.some(r => r.path.endsWith('/config') && r.params.current === '1'))
    assert.deepEqual(reads.find(r => r.path === '/access/permissions')?.params, { path: '/nodes/pve1' })
    const input = { disk: 'scsi0', targetGiB: 12 }
    assert.equal((await request(base + '/disk-growth-review', 'POST', input, { origin: 'https://untrusted.test' })).status, 403)
    assert.equal((await request(base + '/disk-growth-review', 'POST', { ...input, skiplock: 1 })).status, 400)
    assert.equal(writes.length, 0)
    const reviewResponse = await request(base + '/disk-growth-review', 'POST', input)
    assert.equal(reviewResponse.status, 200)
    const plan = await reviewResponse.json()
    assert.equal(plan.targetBytes, 12 * GiB); assert.equal(writes.length, 0)
    digest = 'b'.repeat(40)
    assert.equal((await request(base + '/disk-growth', 'POST', { reviewId: plan.reviewId, confirm: 'diskbox' })).status, 409)
    assert.equal(writes.length, 0)
    const current = await (await request(base + '/disk-growth-review', 'POST', input)).json()
    assert.equal((await request(base + '/disk-growth', 'POST', { reviewId: current.reviewId, confirm: 'wrong' })).status, 409)
    const execute = { reviewId: current.reviewId, confirm: 'diskbox' }
    const acceptedResponse = await request(base + '/disk-growth', 'POST', execute)
    assert.equal(acceptedResponse.status, 200)
    assert.deepEqual(await acceptedResponse.json(), { node: 'pve1', type: 'qemu', vmid: 100, upid })
    assert.deepEqual(writes, [{ path: '/nodes/pve1/qemu/100/resize', fields: { disk: 'scsi0', size: '12G', digest: 'b'.repeat(40) } }])
    assert.equal((await request(base + '/disk-growth', 'POST', execute)).status, 200); assert.equal(writes.length, 1)
    const task = `/clusters/${connection.id}/tasks/pve1/${encodeURIComponent(upid)}`
    assert.equal((await (await request(task)).json()).status, 'running')
    assert.equal((await (await request(base + '/disk-capacity')).json()).ready, false)
    active = false; capacity = 12 * GiB + 4 * 1024 ** 2; digest = 'c'.repeat(40)
    assert.deepEqual(await (await request(task)).json(), { status: 'stopped', exitstatus: 'WARNINGS: 1' })
    assert.equal((await (await request(base + '/disk-capacity')).json()).disks[0].sizeBytes, capacity)
    await stop(); await boot()
    assert.equal((await request(base + '/disk-growth', 'POST', execute)).status, 409)
    assert.equal((await request(task)).status, 404)
    const history = await (await request(`/clusters/${connection.id}/task-history?node=pve1&vmid=100`)).json()
    assert.equal(history.tasks[0].type, 'resize'); assert.equal(history.tasks[0].vmid, 100)
    assert.equal((await request(task)).status, 200)
    assert.match((await (await request(task + '/log')).json()).lines[0].t, /filesystem warning/)
    assert.equal(writes.length, 1)
    const uncertainPlan = await (await request(base + '/disk-growth-review', 'POST', { disk: 'scsi0', targetGiB: 16 })).json()
    result = null
    const uncertainInput = { reviewId: uncertainPlan.reviewId, confirm: 'diskbox' }
    const uncertain = await request(base + '/disk-growth', 'POST', uncertainInput)
    assert.equal(uncertain.status, 502); assert.match((await uncertain.json()).error, /acceptance is unknown/)
    assert.equal((await request(base + '/disk-growth', 'POST', uncertainInput)).status, 409)
    assert.equal(writes.length, 2)
    assert.doesNotMatch(logs, /private-api-secret|private-native-notes|private-network-options/)
  } finally { await stop(); await new Promise<void>(r => upstream.close(() => r())); rmSync(dir, { recursive: true, force: true }) }
})
