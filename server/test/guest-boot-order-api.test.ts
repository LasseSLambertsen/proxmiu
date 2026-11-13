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

test('authenticated boot order uses exact native PUT/null, blocks legacy cleanup and recovers partial outcomes without restart replay', { timeout: 40000 }, async () => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  const original = ['scsi0', 'ide2', 'net0'], target = ['net0', 'scsi0', 'ide2']
  const config: Record<string, unknown> = { name: 'bootbox', digest: 'a'.repeat(40), boot: 'order=' + original.join(';'), scsi0: 'local-lvm:vm-100-disk-0,serial=private-device-serial,cache=none', ide2: 'local:iso/debian.iso,media=cdrom', net0: 'virtio=02:ab:cd:11:22:33,bridge=vmbr0,firewall=YES', bios: 'ovmf', machine: 'pc-q35-9.0', onboot: 1, description: 'private-native-notes', cipassword: '**********' }
  const writes: { path: string; fields: Record<string, string>; raw: string }[] = [], reads: { path: string; params: Record<string, string> }[] = []
  let mode = 'ok', cleanupDeleted = false
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    if (req.headers.authorization !== 'PVEAPIToken=root@pam!fixture=private-api-secret') { res.writeHead(401).end(); return }
    const url = new URL(req.url!, 'https://localhost'), path = url.pathname.replace('/api2/json', '')
    let data: unknown
    if (req.method === 'PUT') {
      let raw = ''; for await (const chunk of req) raw += chunk
      const fields = Object.fromEntries(new URLSearchParams(raw))
      writes.push({ path, fields, raw })
      assert.equal(path, '/nodes/pve1/qemu/100/config')
      assert.deepEqual(Object.keys(fields).sort(), ['boot', 'digest'])
      config.boot = fields.boot; config.digest = String(writes.length).padStart(40, '0')
      if ('bootdisk' in config) { delete config.bootdisk; cleanupDeleted = true }
      if (mode === 'partial-error') { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: { boot: 'private-native-detail' } })); return }
      data = null
    } else {
      assert.equal(req.method, 'GET', 'No POST/power/disk/firmware/IPAM/SSH/delete operation is permitted')
      reads.push({ path, params: Object.fromEntries(url.searchParams) })
      if (path === '/version') data = { version: '8.4.21' }
      else if (path === '/cluster/status') data = []
      else if (path === '/cluster/resources') data = [{ type: 'qemu', vmid: 100, node: 'pve1', status: 'stopped', name: 'bootbox' }]
      else if (path === '/nodes') data = [{ node: 'pve1', status: 'online' }]
      else if (path === '/access/permissions') data = { '/nodes/pve1': { 'Sys.Audit': 0 } }
      else if (path.endsWith('/config')) data = config
      else if (path.endsWith('/status/current')) data = { status: 'stopped', ha: { managed: 0 } }
      else if (path.endsWith('/pending')) data = []
      else if (path.endsWith('/snapshot')) data = [{ name: 'current' }]
      else if (path.endsWith('/tasks')) data = []
      else { res.writeHead(404).end(); return }
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data }))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const fixturePort = (upstream.address() as { port: number }).port
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
  const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()))
  const dir = mkdtempSync(join(tmpdir(), 'boot-order-api-'))
  let agent: ChildProcess | undefined, logs = ''
  async function boot() {
    agent = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PROXMIU_DATA_DIR: dir, PROXMIU_PASSWORD: 'fixture-agent-password' }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 15000)
      agent!.stdout!.on('data', data => { logs += String(data); if (String(data).includes('Server listening')) { clearTimeout(timer); resolve() } })
      agent!.stderr!.on('data', data => { logs += String(data) })
      agent!.once('exit', code => { clearTimeout(timer); reject(new Error('Agent exit:' + code)) })
    })
  }
  async function stop() { if (agent && agent.exitCode === null) { const exit = once(agent, 'exit'); agent.kill(); await exit } }
  try {
    await boot()
    const root = `http://127.0.0.1:${port}/api`
    const login = await (await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'fixture-agent-password' }) })).json()
    const request = (path: string, method = 'GET', body?: unknown, headers = {}) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const connection = await (await request('/clusters', 'POST', { name: 'Boot fixture', host: '127.0.0.1', port: fixturePort, authType: 'token', username: 'root@pam!fixture', secret: 'private-api-secret', verifyTls: false })).json()
    const base = `/clusters/${connection.id}/guests/pve1/qemu/100`
    assert.equal((await fetch(root + base + '/boot-order')).status, 401)
    const inventoryResponse = await request(base + '/boot-order')
    assert.equal(inventoryResponse.status, 200)
    const inventory = await inventoryResponse.json()
    assert.equal(inventory.ready, true); assert.deepEqual(inventory.order.map((d: any) => d.id), original)
    assert.doesNotMatch(JSON.stringify(inventory), /private-|cipassword|cache=|digest|description/)
    assert.equal((await request(`/clusters/${connection.id}/guests/pve1/lxc/100/boot-order`)).status, 400)
    const input = { sourceIdentity: inventory.sourceIdentity, order: target }
    assert.equal((await request(base + '/boot-order-review', 'POST', input, { origin: 'https://untrusted.test' })).status, 403)
    assert.equal((await request(base + '/boot-order-review', 'POST', { ...input, force: 1 })).status, 400)
    const oldResponse = await request(base + '/boot-order-review', 'POST', input)
    assert.equal(oldResponse.status, 200)
    const old = await oldResponse.json(); assert.equal(writes.length, 0)
    config.digest = 'f'.repeat(40)
    assert.equal((await request(base + '/boot-order', 'POST', { reviewId: old.reviewId, confirm: 'bootbox' })).status, 409)
    assert.equal(writes.length, 0)
    const plan = await (await request(base + '/boot-order-review', 'POST', input)).json()
    const execute = { reviewId: plan.reviewId, confirm: 'bootbox' }
    assert.equal((await request(base + '/boot-order', 'POST', { ...execute, bootdisk: 'scsi0' })).status, 400)
    assert.equal((await request(base + '/boot-order', 'POST', { ...execute, confirm: '100' })).status, 409)
    const accepted = await request(base + '/boot-order', 'POST', execute)
    assert.equal(accepted.status, 200)
    const result = await accepted.json()
    assert.equal(result.verified, true); assert.deepEqual(result.order.map((d: any) => d.id), target); assert.ok(!('upid' in result))
    assert.deepEqual(writes[0].fields, { boot: 'order=net0;scsi0;ide2', digest: 'f'.repeat(40) })
    assert.ok(writes[0].raw.includes('boot=order%3Dnet0%3Bscsi0%3Bide2'))
    assert.ok(String(config.scsi0).includes('private-device-serial')); assert.equal(config.bios, 'ovmf'); assert.equal(config.onboot, 1)
    assert.equal((await request(base + '/boot-order', 'POST', execute)).status, 200); assert.equal(writes.length, 1)
    config.bootdisk = 'scsi0'
    assert.equal((await (await request(base + '/boot-order')).json()).ready, false)
    assert.equal((await request(base + '/boot-order-review', 'POST', { sourceIdentity: result.sourceIdentity, order: original })).status, 409)
    assert.equal(cleanupDeleted, false); assert.equal(writes.length, 1); delete config.bootdisk
    const current = await (await request(base + '/boot-order')).json()
    const reverse = await (await request(base + '/boot-order-review', 'POST', { sourceIdentity: current.sourceIdentity, order: original })).json()
    mode = 'partial-error'
    const unknownInput = { reviewId: reverse.reviewId, confirm: 'bootbox' }
    const unknown = await request(base + '/boot-order', 'POST', unknownInput)
    assert.equal(unknown.status, 502); assert.match((await unknown.json()).error, /unconfirmed/)
    const observed = await (await request(base + '/boot-order')).json()
    assert.deepEqual(observed.order.map((d: any) => d.id), original, 'Current config may already change despite an error')
    assert.equal((await request(base + '/boot-order', 'POST', unknownInput)).status, 409)
    const pending = await (await request(base + '/boot-order-review', 'POST', { sourceIdentity: observed.sourceIdentity, order: target })).json()
    await stop(); await boot()
    for (const body of [execute, unknownInput, { reviewId: pending.reviewId, confirm: 'bootbox' }]) assert.equal((await request(base + '/boot-order', 'POST', body)).status, 409)
    assert.deepEqual((await (await request(base + '/boot-order')).json()).order.map((d: any) => d.id), original)
    assert.equal(writes.length, 2); assert.equal(cleanupDeleted, false)
    assert.ok(reads.some(r => r.path.endsWith('/config') && r.params.current === '1'))
    assert.deepEqual(reads.find(r => r.path === '/access/permissions')?.params, { path: '/nodes/pve1' })
    assert.doesNotMatch(logs, /private-api-secret|private-native-notes|private-device-serial|private-native-detail/)
  } finally { await stop(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(dir, { recursive: true, force: true }) }
})
