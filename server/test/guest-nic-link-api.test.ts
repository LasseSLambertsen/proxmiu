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

test('authenticated QEMU/LXC NIC routes verify exact TLS PUTs, stale reviews, partial writes and restart no replay', { timeout: 40000 }, async () => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  const originals = {
    qemu: 'virtio=AA:bB:CC:dd:EE:fF,bridge=vmbr0,tag=0010,firewall=ON,queues=02,link_down=0',
    lxc: 'name=eth0,hwaddr=AA:bB:CC:dd:EE:fF,bridge=vmbr0,ip=192.0.2.100/24,gw=192.0.2.1,ip6=2001:db8::100/64,gw6=2001:db8::1,firewall=YES,link_down=0',
  }
  type Kind = keyof typeof originals
  const guests = {
    qemu: { raw: originals.qemu, digest: 'a'.repeat(40), failAfterApply: false },
    lxc: { raw: originals.lxc, digest: 'a'.repeat(40), failAfterApply: false },
  }
  const writes: { path: string; fields: Record<string, string>; body: string; contentType?: string }[] = []
  const reads: { path: string; params: Record<string, string> }[] = []
  const unexpected: string[] = []
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    const url = new URL(req.url!, 'https://localhost'), path = url.pathname.replace('/api2/json', '')
    if (req.headers.authorization !== 'PVEAPIToken=root@pam!fixture=private-api-secret') { res.writeHead(401).end(); return }
    const match = /^\/nodes\/pve1\/(qemu|lxc)\/100\/(config|status\/current|pending|snapshot)$/.exec(path)
    const type = match?.[1] as Kind | undefined, state = type ? guests[type] : undefined
    let data: unknown
    if (req.method === 'PUT' && match?.[2] === 'config' && state) {
      let body = ''; for await (const chunk of req) body += chunk
      const fields = Object.fromEntries(new URLSearchParams(body))
      writes.push({ path, fields, body, contentType: req.headers['content-type'] })
      state.raw = fields.net0; state.digest = 'c'.repeat(40)
      if (state.failAfterApply) {
        res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: { net0: 'private-native-failure-after-apply' } })); return
      }
      data = null
    } else if (req.method === 'GET') {
      reads.push({ path, params: Object.fromEntries(url.searchParams) })
      if (path === '/version') data = { version: '8.4.21' }
      else if (path === '/cluster/status') data = []
      else if (path === '/nodes') data = [{ node: 'pve1', status: 'online' }]
      else if (path === '/cluster/resources') data = (['qemu', 'lxc'] as const).map(type => ({ type, vmid: 100, node: 'pve1', status: 'stopped', name: 'linkbox' }))
      else if (path === '/access/permissions') data = { '/nodes/pve1': { 'Sys.Audit': 0 } }
      else if (path === '/nodes/pve1/tasks') data = []
      else if (state && match?.[2] === 'config') data = { [type === 'qemu' ? 'name' : 'hostname']: 'linkbox', digest: state.digest, net0: state.raw, description: 'private-native-notes', memory: 2048 }
      else if (state && match?.[2] === 'status/current') data = { status: 'stopped', ha: { managed: 0 } }
      else if (state && match?.[2] === 'pending') data = []
      else if (state && match?.[2] === 'snapshot') data = [{ name: 'current' }]
      else { unexpected.push(req.method + ' ' + path); res.writeHead(404).end(); return }
    } else { unexpected.push(req.method + ' ' + path); res.writeHead(405).end(); return }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data }))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const fixturePort = (upstream.address() as { port: number }).port
  const portSocket = createServer(); portSocket.listen(0, '127.0.0.1'); await once(portSocket, 'listening')
  const port = (portSocket.address() as { port: number }).port; await new Promise<void>(r => portSocket.close(() => r()))
  const dir = mkdtempSync(join(tmpdir(), 'nic-link-api-'))
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
    const loginResponse = await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'fixture-agent-password' }) })
    assert.equal(loginResponse.status, 200)
    const login = await loginResponse.json()
    const request = (path: string, method = 'GET', body?: unknown, headers = {}) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const connectionResponse = await request('/clusters', 'POST', { name: 'NIC fixture', host: '127.0.0.1', port: fixturePort, authType: 'token', username: 'root@pam!fixture', secret: 'private-api-secret', verifyTls: false })
    assert.equal(connectionResponse.status, 200)
    const connection = await connectionResponse.json()
    const oldReviews: { base: string; pending: unknown; verified: unknown; uncertain: unknown }[] = []
    for (const type of ['qemu', 'lxc'] as const) {
      const state = guests[type], base = `/clusters/${connection.id}/guests/pve1/${type}/100`, input = { nic: 'net0', linkDown: true }, startWrites = writes.length
      for (const [route, method, body] of [['nic-links', 'GET', undefined], ['nic-link-review', 'POST', input], ['nic-link', 'POST', { reviewId: '00000000-0000-4000-8000-000000000000', confirm: 'linkbox' }]] as const) {
        assert.equal((await fetch(root + base + '/' + route, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })).status, 401)
        assert.equal((await request(base + '/' + route, method, body, { origin: 'https://untrusted.test' })).status, 403)
      }
      const inventoryResponse = await request(base + '/nic-links'); assert.equal(inventoryResponse.status, 200)
      const inventory = await inventoryResponse.json()
      assert.equal(inventory.ready, true); assert.equal(inventory.interfaces[0].linkDown, false)
      assert.equal(inventory.interfaces[0].canEdit, true)
      assert.doesNotMatch(JSON.stringify(inventory), /private-|digest|description|ip=|gw=|firewall=/)
      assert.equal((await request(base + '/nic-link-review', 'POST', { ...input, linkDown: false })).status, 409)
      for (const body of [{ ...input, skiplock: 1 }, { ...input, linkDown: 'true' }, { ...input, digest: 'override' }, { ...input, nic: '../net0' }]) assert.equal((await request(base + '/nic-link-review', 'POST', body)).status, 400)
      assert.equal(writes.length, startWrites)
      const reviewResponse = await request(base + '/nic-link-review', 'POST', input); assert.equal(reviewResponse.status, 200)
      const plan = await reviewResponse.json()
      assert.equal(plan.nic, 'net0'); assert.equal(plan.name, 'linkbox'); assert.equal(plan.type, type)
      assert.equal(plan.currentLinkDown, false); assert.equal(plan.linkDown, true)
      assert.doesNotMatch(JSON.stringify(plan), /private-|digest|description|ip=|gw=|firewall=/)
      state.digest = 'b'.repeat(40)
      assert.equal((await request(base + '/nic-link', 'POST', { reviewId: plan.reviewId, confirm: 'linkbox' })).status, 409)
      assert.equal(writes.length, startWrites, 'Stale preflight sends zero native writes')
      const freshResponse = await request(base + '/nic-link-review', 'POST', input); assert.equal(freshResponse.status, 200)
      const fresh = await freshResponse.json(), execute = { reviewId: fresh.reviewId, confirm: 'linkbox' }
      assert.equal((await request(base + '/nic-link', 'POST', { ...execute, confirm: null })).status, 400)
      assert.equal((await request(base + '/nic-link', 'POST', { ...execute, bridge: 'vmbr1' })).status, 400)
      assert.equal((await request(base + '/nic-link', 'POST', { ...execute, confirm: 'wrong' })).status, 409)
      const response = await request(base + '/nic-link', 'POST', execute); assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.verified, true); assert.equal(result.type, type); assert.equal(result.interface.linkDown, true)
      assert.equal(result.interface.nic, 'net0'); assert.equal(typeof result.observedAt, 'number')
      assert.doesNotMatch(JSON.stringify(result), /private-|digest|description|ip=|gw=|firewall=|upid/)
      const fields = { net0: originals[type].replace('link_down=0', 'link_down=1'), digest: 'b'.repeat(40) }
      assert.deepEqual(writes[startWrites], { path: `/nodes/pve1/${type}/100/config`, fields, body: new URLSearchParams(fields).toString(), contentType: 'application/x-www-form-urlencoded' })
      assert.equal((await request(base + '/nic-link', 'POST', execute)).status, 200)
      assert.equal(writes.length, startWrites + 1)
      const observed = await (await request(base + '/nic-links')).json(); assert.equal(observed.interfaces[0].linkDown, true)
      const partialReviewResponse = await request(base + '/nic-link-review', 'POST', { nic: 'net0', linkDown: false }); assert.equal(partialReviewResponse.status, 200)
      const partial = await partialReviewResponse.json(), uncertainInput = { reviewId: partial.reviewId, confirm: 'linkbox' }
      state.failAfterApply = true
      const uncertain = await request(base + '/nic-link', 'POST', uncertainInput); assert.equal(uncertain.status, 502)
      const error = await uncertain.json(); assert.match(error.error, /unconfirmed|unknown/i); assert.match(error.error, /inspect/i); assert.doesNotMatch(JSON.stringify(error), /private-/)
      state.failAfterApply = false
      assert.equal((await request(base + '/nic-link', 'POST', uncertainInput)).status, 409)
      const current = await (await request(base + '/nic-links')).json(); assert.equal(current.interfaces[0].linkDown, false)
      assert.equal((await request(base + '/nic-link', 'POST', uncertainInput)).status, 409)
      assert.equal(writes.length, startWrites + 2)
      assert.deepEqual(writes[startWrites + 1].fields, { net0: originals[type], digest: 'c'.repeat(40) })
      const pendingResponse = await request(base + '/nic-link-review', 'POST', input); assert.equal(pendingResponse.status, 200)
      const pending = await pendingResponse.json()
      oldReviews.push({ base, pending: { reviewId: pending.reviewId, confirm: 'linkbox' }, verified: execute, uncertain: uncertainInput })
    }
    await stop(); await boot()
    for (const old of oldReviews) {
      for (const input of [old.pending, old.verified, old.uncertain]) assert.equal((await request(old.base + '/nic-link', 'POST', input)).status, 409)
      const observed = await (await request(old.base + '/nic-links')).json(); assert.equal(observed.interfaces[0].linkDown, false)
    }
    assert.equal(writes.length, 4)
    assert.ok(reads.some(r => r.path.endsWith('/qemu/100/config') && r.params.current === '1'))
    assert.ok(reads.some(r => r.path.endsWith('/lxc/100/config') && r.params.current === '1'))
    assert.ok(reads.filter(r => r.path === '/access/permissions').every(r => JSON.stringify(r.params) === JSON.stringify({ path: '/nodes/pve1' })))
    assert.deepEqual(unexpected, [], 'No power, SDN, IPAM, SSH, async POST, delete or other native operations')
    assert.doesNotMatch(logs, /private-api-secret|private-native-notes|private-native-failure-after-apply|fixture-agent-password/)
  } finally { await stop(); await new Promise<void>(r => upstream.close(() => r())); rmSync(dir, { recursive: true, force: true }) }
})
