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

test('authenticated restore API preserves review boundaries and recovers new-ID tasks after restart', { timeout: 40000 }, async () => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  const archive = 'local:backup/vzdump-qemu-100-2026_11_12-12_00_00.vma.zst'
  const upid = 'UPID:pve1:00000123:00000456:12345678:qmrestore:201:root@pam:'
  const posts: { path: string; body: Record<string, string> }[] = []
  let accepted = false
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    const url = new URL(req.url!, 'https://localhost'), path = url.pathname.replace('/api2/json', '')
    if (req.headers.authorization !== 'PVEAPIToken=root@pam!fixture=restore-secret') { res.writeHead(401).end('private upstream response'); return }
    let data: unknown
    if (req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk
      posts.push({ path, body: Object.fromEntries(new URLSearchParams(body)) })
      assert.equal(path, '/nodes/pve1/qemu')
      accepted = true; data = upid
    } else if (path === '/version') data = { version: '8.4.21' }
    else if (path === '/cluster/status') data = []
    else if (path === '/nodes') data = [{ node: 'pve1', status: 'online' }]
    else if (path === '/cluster/resources') data = [{ node: 'pve1', type: 'qemu', vmid: 100, name: 'source' }]
    else if (path === '/cluster/nextid') data = url.searchParams.get('vmid') || '201'
    else if (path.endsWith('/storage')) data = [{ storage: 'local', content: 'backup', active: 1, enabled: 1 }, { storage: 'local-lvm', content: 'images', active: 1, enabled: 1 }]
    else if (path.endsWith('/content')) data = [{ volid: archive, vmid: 100, format: 'vma.zst', ctime: 100, size: 4096 }]
    else if (path.endsWith('/extractconfig')) { assert.equal(url.searchParams.get('volume'), archive); data = 'name: source\nonboot: 1\nscsi0: local-lvm:vm-100-disk-0,size=8G\n' }
    else if (path.endsWith('/status')) data = { status: 'stopped', exitstatus: 'OK' }
    else if (path.endsWith('/log')) data = [{ n: 1, t: 'Restored VM 201' }]
    else if (path.endsWith('/tasks')) data = accepted ? [{ upid, node: 'pve1', type: 'qmrestore', id: '201', starttime: 100, endtime: 110, status: 'OK' }] : []
    else { res.writeHead(404).end(); return }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data }))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const mockPort = (upstream.address() as { port: number }).port
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
  const port = (socket.address() as { port: number }).port; await new Promise<void>(r => socket.close(() => r()))
  const folder = mkdtempSync(join(tmpdir(), 'proxmiu-restore-'))
  let agent: ChildProcess | undefined, logs = ''
  const boot = async () => {
    agent = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PROXMIU_PASSWORD: 'fixture-password', PROXMIU_DATA_DIR: folder }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 15000)
      agent!.stdout!.on('data', b => { logs += String(b); if (String(b).includes('Server listening')) { clearTimeout(timer); resolve() } })
      agent!.stderr!.on('data', b => { logs += String(b) })
      agent!.once('exit', code => { clearTimeout(timer); reject(new Error('Agent exited: ' + code)) })
    })
  }
  const stop = async () => { if (agent && agent.exitCode === null) { const exit = once(agent, 'exit'); agent.kill(); await exit } }
  try {
    await boot()
    const root = `http://127.0.0.1:${port}/api`
    const login = await (await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'fixture-password' }) })).json()
    const request = (path: string, method = 'GET', body?: unknown, headers = {}) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const connection = await (await request('/clusters', 'POST', { name: 'Restore fixture', host: '127.0.0.1', port: mockPort, authType: 'token', username: 'root@pam!fixture', secret: 'restore-secret', verifyTls: false })).json()
    const base = `/clusters/${connection.id}/guests/pve1/qemu/100`
    const input = { sourceStorage: 'local', archive, storage: 'local-lvm', vmid: 201 }
    assert.equal((await fetch(root + base + '/restore-options')).status, 401)
    assert.equal((await request(base + '/restore-review', 'POST', input, { origin: 'https://untrusted.invalid' })).status, 403)
    assert.equal((await request(base + '/restore-review', 'POST', { ...input, force: 1 })).status, 400)
    assert.equal(posts.length, 0)
    const options = await request(base + '/restore-options')
    assert.equal(options.status, 200)
    assert.deepEqual(await options.json(), { storages: ['local-lvm'], suggestedVmid: 201 })
    const reviewed = await request(base + '/restore-review', 'POST', input)
    assert.equal(reviewed.status, 200)
    const review = await reviewed.json()
    assert.doesNotMatch(JSON.stringify(review), /onboot|scsi0|restore-secret/)
    assert.equal(posts.length, 0)
    assert.equal((await request(base + '/restore', 'POST', { reviewId: review.reviewId, confirm: '100' })).status, 409)
    const execute = { reviewId: review.reviewId, confirm: '201' }
    const response = await request(base + '/restore', 'POST', execute)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { upid, node: 'pve1', vmid: 201, type: 'qemu' })
    assert.deepEqual(posts, [{ path: '/nodes/pve1/qemu', body: { vmid: '201', storage: 'local-lvm', force: '0', unique: '1', start: '0', onboot: '0', archive } }])
    assert.equal((await request(base + '/restore', 'POST', execute)).status, 200)
    assert.equal(posts.length, 1)
    const task = `/clusters/${connection.id}/tasks/pve1/${encodeURIComponent(upid)}`
    assert.deepEqual(await (await request(task)).json(), { status: 'stopped', exitstatus: 'OK' })
    await stop(); await boot()
    assert.equal((await request(base + '/restore', 'POST', execute)).status, 409)
    assert.equal((await request(task)).status, 404)
    const history = await (await request(`/clusters/${connection.id}/task-history?node=pve1&vmid=201`)).json()
    assert.equal(history.tasks[0].vmid, 201)
    assert.equal((await request(task)).status, 200)
    assert.equal((await (await request(task + '/log')).json()).lines[0].t, 'Restored VM 201')
    assert.equal(posts.length, 1)
    assert.doesNotMatch(logs, /restore-secret|private upstream response/)
  } finally { await stop(); await new Promise<void>(r => upstream.close(() => r())); rmSync(folder, { recursive: true, force: true }) }
})
