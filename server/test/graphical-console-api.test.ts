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
import WebSocket, { WebSocketServer } from 'ws'

async function freePort() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening')
  const port = (s.address() as { port: number }).port
  await new Promise<void>(resolve => s.close(() => resolve())); return port
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit'); child.kill(); await exited
}
function peer(url: string, headers: Record<string, string> = {}) {
  const socket = new WebSocket(url, { headers })
  const frames: { binary: boolean; bytes: Buffer }[] = []
  socket.on('message', (b, binary) => frames.push({ binary, bytes: Buffer.from(b as Buffer) }))
  socket.on('error', () => {})
  return {
    socket, frames,
    async ready() { await Promise.race([once(socket, 'open'), once(socket, 'unexpected-response').then(([, r]) => { throw new Error(`Upgrade rejected: ${r.statusCode}`) })]) },
    async frame(match: (value: { binary: boolean; bytes: Buffer }) => boolean) {
      const deadline = Date.now() + 5000
      while (!frames.some(match)) {
        if (Date.now() >= deadline) throw new Error('Expected graphical console frame')
        await new Promise(r => setTimeout(r, 10))
      }
      return frames.find(match)!
    },
    connect(body: unknown) { socket.send(JSON.stringify(body)) },
  }
}

test('graphical console authenticates locally, keeps PVE credentials server-side and relays binary RFB', { timeout: 45000 }, async () => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  const calls: { path: string; method: string; body: string; cookie?: string; auth?: string; csrf?: string }[] = []
  let guest = { node: 'pve1', type: 'qemu', vmid: 101, status: 'running', template: 0 }
  let nodeStatus = 'online', vga = 'std', hold = false
  let release: (() => void) | undefined
  let proxyResult: unknown = { ticket: 'private-vnc-ticket', password: 'password', port: '5901' }
  const sockets = new Set<WebSocket>(), binaryInput: Buffer[] = []
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    let body = ''; for await (const part of req) body += part
    const path = new URL(req.url!, 'https://localhost').pathname
    calls.push({ path, method: req.method!, body, auth: req.headers.authorization, cookie: req.headers.cookie, csrf: req.headers.csrfpreventiontoken as string })
    const reply = (data: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data })) }
    if (path.endsWith('/version')) reply({ version: 'fixture' })
    else if (path.endsWith('/cluster/status')) reply([])
    else if (path.endsWith('/access/ticket')) reply({ ticket: 'private-pve-cookie', CSRFPreventionToken: 'private-pve-csrf' })
    else if (path.endsWith('/cluster/resources')) { if (hold) release = () => reply([guest]); else reply([guest]) }
    else if (path.endsWith('/nodes')) reply([{ node: 'pve1', status: nodeStatus }])
    else if (path.endsWith('/config')) reply({ vga })
    else if (path.endsWith('/vncproxy')) reply(proxyResult)
    else { res.writeHead(404); reply(null) }
  })
  const wss = new WebSocketServer({ noServer: true, handleProtocols: protocols => protocols.has('binary') ? 'binary' : false })
  upstream.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, 'https://localhost')
    assert.equal(url.pathname, '/api2/json/nodes/pve1/qemu/101/vncwebsocket')
    assert.equal(url.searchParams.get('port'), '5901'); assert.equal(url.searchParams.get('vncticket'), 'private-vnc-ticket')
    assert.ok(req.headers.authorization === 'PVEAPIToken=root@pam!fixture=private-api-secret' || req.headers.cookie === 'PVEAuthCookie=private-pve-cookie')
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
  })
  const version = Buffer.from('RFB 003.008\n'), data = Buffer.from([0, 255, 254, 128, 10, 13, 0])
  wss.on('connection', ws => {
    sockets.add(ws); ws.on('error', () => {}); ws.on('close', () => sockets.delete(ws))
    let step = 0
    ws.send(version.subarray(0, 5)); ws.send(version.subarray(5))
    ws.on('message', (raw, binary) => {
      assert.equal(binary, true)
      const bytes = Buffer.from(raw as Buffer)
      if (step === 0) { assert.deepEqual(bytes, version); ws.send(Buffer.from([2, 1, 2])); step++ }
      else if (step === 1) { assert.deepEqual(bytes, Buffer.from([2])); const c = Buffer.from(Array.from({ length: 16 }, (_, i) => i)); ws.send(c.subarray(0, 8)); ws.send(c.subarray(8)); step++ }
      else if (step === 2) { assert.equal(bytes.toString('hex'), 'b866924125c8eebb9debc1db61c538e2'); ws.send(Buffer.alloc(4)); step++ }
      else if (step === 3) { assert.deepEqual(bytes, Buffer.from([1])); ws.send(data); step++ }
      else binaryInput.push(bytes)
    })
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const fixturePort = (upstream.address() as { port: number }).port
  const port = await freePort(), dir = mkdtempSync(join(tmpdir(), 'proxmiu-graphical-'))
  let agent: ChildProcess | undefined, logs = ''
  const peers: ReturnType<typeof peer>[] = []
  try {
    agent = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PROXMIU_DATA_DIR: dir, PROXMIU_PASSWORD: 'fixture-agent-password' }, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 15000)
      agent!.stdout!.on('data', b => { logs += String(b); if (String(b).includes('Server listening')) { clearTimeout(timer); resolve() } })
      agent!.stderr!.on('data', b => { logs += String(b) })
      agent!.once('exit', code => { clearTimeout(timer); reject(new Error('Agent exited: ' + code)) })
    })
    const root = `http://127.0.0.1:${port}/api`
    const login = await (await fetch(root + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'fixture-agent-password' }) })).json()
    const request = (path: string, method = 'GET', body?: unknown) => fetch(root + path, { method, headers: { authorization: `Bearer ${login.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const connect = (id: string, token = login.token) => ({ type: 'connect', clusterId: id, node: 'pve1', guestType: 'qemu', vmid: 101, token })
    const workerCount = () => calls.filter(c => c.path.endsWith('/vncproxy')).length
    const make = (headers = {}) => { const p = peer(`ws://127.0.0.1:${port}/api/graphical-console`, headers); peers.push(p); return p }
    for (const authType of ['token', 'password']) {
      const connection = await (await request('/clusters', 'POST', { name: authType, host: '127.0.0.1', port: fixturePort, authType, username: authType === 'token' ? 'root@pam!fixture' : 'root@pam', secret: authType === 'token' ? 'private-api-secret' : 'private-pve-password', verifyTls: false })).json()
      const p = make(); await p.ready(); p.connect(connect(connection.id))
      await p.frame(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'ready')
      await p.frame(f => f.binary && f.bytes.equals(version))
      p.socket.send(version)
      await p.frame(f => f.binary && f.bytes.equals(Buffer.from([1, 1])))
      p.socket.send(Buffer.from([1]))
      await p.frame(f => f.binary && f.bytes.equals(Buffer.alloc(4)))
      p.socket.send(Buffer.from([1]))
      await p.frame(f => f.binary && f.bytes.equals(data))
      const input = Buffer.from([255, 0, 128, 34]); p.socket.send(input)
      for (let i = 0; i < 100 && !binaryInput.some(b => b.equals(input)); i++) await new Promise(r => setTimeout(r, 10))
      assert.ok(binaryInput.some(b => b.equals(input)))
      assert.doesNotMatch(Buffer.concat(p.frames.map(f => f.bytes)).toString(), /private-|password|root@pam/)
      const call = calls.filter(c => c.path.endsWith('/vncproxy')).at(-1)!
      assert.deepEqual(Object.fromEntries(new URLSearchParams(call.body)), { websocket: '1', 'generate-password': '1' })
      assert.equal(call.method, 'POST')
      if (authType === 'password') { assert.equal(call.cookie, 'PVEAuthCookie=private-pve-cookie'); assert.equal(call.csrf, 'private-pve-csrf') }
      p.socket.close(); await once(p.socket, 'close')
      for (let i = 0; i < 100 && sockets.size; i++) await new Promise(r => setTimeout(r, 10))
      assert.equal(sockets.size, 0)

      const before = workerCount(), beforeCalls = calls.length
      const earlyBinary = make(); await earlyBinary.ready(); earlyBinary.socket.send(Buffer.from([1]))
      await earlyBinary.frame(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'error')
      assert.equal(calls.length, beforeCalls, 'Unauthenticated binary input must not reach PVE')
      const unauthorized = make(); await unauthorized.ready(); unauthorized.connect(connect(connection.id, 'invalid'))
      await unauthorized.frame(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'error')
      assert.equal(workerCount(), before)
      assert.equal(calls.length, beforeCalls, 'Rejected agent token must not reach PVE')
      const forbidden = make({ origin: 'https://untrusted.test' })
      await assert.rejects(forbidden.ready(), /Upgrade rejected: 403/)
      const override = make(); await override.ready(); override.connect({ ...connect(connection.id), host: 'attacker', port: 1234 })
      await override.frame(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'error')
      assert.equal(workerCount(), before)
      assert.equal(calls.length, beforeCalls, 'Forbidden origin and target override must not reach PVE')
      for (const state of ['stopped', 'moved', 'template', 'offline', 'serial', 'none']) {
        guest = { ...guest, status: state === 'stopped' ? 'stopped' : 'running', node: state === 'moved' ? 'pve2' : 'pve1', template: state === 'template' ? 1 : 0 }
        nodeStatus = state === 'offline' ? 'offline' : 'online'; vga = state === 'serial' ? 'serial0' : state === 'none' ? 'none' : 'std'
        const denied = make(); await denied.ready(); denied.connect(connect(connection.id))
        await denied.frame(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'error')
        assert.equal(workerCount(), before, state)
      }
      guest = { ...guest, node: 'pve1', status: 'running', template: 0 }; nodeStatus = 'online'; vga = 'std'
      hold = true
      const canceled = make(); await canceled.ready(); canceled.connect(connect(connection.id))
      for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 10))
      assert.ok(release)
      canceled.socket.close(); await once(canceled.socket, 'close'); release!(); release = undefined; hold = false
      await new Promise(r => setTimeout(r, 50)); assert.equal(workerCount(), before)
      proxyResult = { ticket: 'private-vnc-ticket', port: 5901 }
      const invalid = make(); await invalid.ready(); invalid.connect(connect(connection.id))
      await invalid.frame(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'error')
      assert.equal(sockets.size, 0)
      proxyResult = { ticket: 'private-vnc-ticket', password: 'password', port: '5901' }
    }
    assert.doesNotMatch(logs, /private-api-secret|private-vnc-ticket|private-pve-password|private-pve-cookie|private-pve-csrf/)
  } finally {
    release?.()
    for (const p of peers) p.socket.terminate()
    for (const socket of sockets) socket.terminate()
    await stop(agent)
    await new Promise<void>(r => wss.close(() => r()))
    await new Promise<void>(r => upstream.close(() => r()))
    rmSync(dir, { recursive: true, force: true })
  }
})
