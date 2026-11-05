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
  const messages: any[] = []
  const waiters: (() => void)[] = []
  socket.on('message', raw => { messages.push(JSON.parse(raw.toString())); waiters.splice(0).forEach(fn => fn()) })
  socket.on('error', () => {})
  return {
    socket, messages,
    async ready() { await Promise.race([once(socket, 'open'), once(socket, 'unexpected-response').then(([, r]) => { throw new Error(`Upgrade rejected: ${r.statusCode}`) })]) },
    send(value: unknown) { socket.send(JSON.stringify(value)) },
    async message(match: (value: any) => boolean) {
      const deadline = Date.now() + 2500
      while (!messages.some(match)) {
        if (Date.now() >= deadline) throw new Error(`Expected console message, received ${JSON.stringify(messages)}`)
        await new Promise<void>(resolve => { const timer = setTimeout(resolve, 20); waiters.push(() => { clearTimeout(timer); resolve() }) })
      }
      return messages.find(match)
    },
  }
}

test('guest console authenticates first and bridges only the fresh guest with saved TLS/auth and native binary framing', { timeout: 40_000 }, async t => {
  const localStore = mkdtempSync(join(tmpdir(), 'proxmiu-console-client-'))
  process.env.PROXMIU_DATA_DIR = localStore
  t.after(() => rmSync(localStore, { recursive: true, force: true }))
  const { ProxmoxClient } = await import('../src/proxmox.js')
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, days: 1 })
  const calls: { method: string; path: string; body: string; auth?: string; cookie?: string }[] = []
  const frames: Buffer[] = []
  const sockets = new Set<WebSocket>()
  let guest = { type: 'lxc', vmid: 101, node: 'pve1', status: 'running', template: 0 }
  let config: Record<string, string> = { serial2: 'socket' }
  let termResponse: unknown = { user: 'root@pam', ticket: 'PVE:private-console-ticket', port: '5901' }
  let acknowledge = true
  let nodeStatus = 'online'
  let denyTermproxy = false
  let delayedResources: (() => void) | undefined
  let holdResources = false
  const upstream = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    let body = ''; for await (const part of req) body += part
    const path = new URL(req.url!, 'https://localhost').pathname
    calls.push({ method: req.method!, path, body, auth: req.headers.authorization, cookie: req.headers.cookie })
    const reply = (data: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data })) }
    if (path.endsWith('/version')) reply({ version: 'fixture' })
    else if (path.endsWith('/cluster/status')) reply([])
    else if (path.endsWith('/nodes')) reply([{ node: 'pve1', status: nodeStatus }])
    else if (path.endsWith('/access/ticket')) reply({ ticket: 'private-cookie', CSRFPreventionToken: 'private-csrf' })
    else if (path.endsWith('/cluster/resources')) { if (holdResources) delayedResources = () => reply([guest]); else reply([guest]) }
    else if (path.endsWith('/config')) reply(config)
    else if (path.endsWith('/termproxy')) { if (denyTermproxy) { res.statusCode = 403; reply({ message: 'private upstream permission detail' }) } else reply(termResponse) }
    else { res.statusCode = 404; reply(null) }
  })
  const wss = new WebSocketServer({ noServer: true, handleProtocols: protocols => protocols.has('binary') ? 'binary' : false })
  upstream.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, 'https://localhost')
    assert.equal(url.pathname, `/api2/json/nodes/pve1/${guest.type}/101/vncwebsocket`)
    assert.equal(url.searchParams.get('port'), '5901')
    assert.equal(url.searchParams.get('vncticket'), 'PVE:private-console-ticket')
    assert.ok(req.headers.authorization === 'PVEAPIToken=root@pam!fixture=private-api-secret' || req.headers.cookie === 'PVEAuthCookie=private-cookie')
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
  })
  wss.on('connection', ws => {
    sockets.add(ws); ws.on('close', () => sockets.delete(ws))
    ws.on('message', (raw, binary) => {
      assert.equal(binary, true)
      const data = Buffer.from(raw as Buffer); frames.push(data)
      if (data.toString() === 'root@pam:PVE:private-console-ticket\n' && acknowledge) {
        ws.send(Buffer.from('O')); ws.send(Buffer.concat([Buffer.from('Khello '), Buffer.from('😀').subarray(0, 2)])); ws.send(Buffer.from('😀').subarray(2))
      }
    })
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const pvePort = (upstream.address() as { port: number }).port
  const appPort = await freePort()
  const data = mkdtempSync(join(tmpdir(), 'proxmiu-console-'))
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(appPort), PROXMIU_PASSWORD: 'fixture-password', PROXMIU_DATA_DIR: data, LOG_LEVEL: 'info' }
  let child: ChildProcess | undefined
  let logs = ''
  const peers: WebSocket[] = []
  try {
    child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 10000)
      child!.stdout!.on('data', chunk => { logs += chunk; if (logs.includes('Server listening')) { clearTimeout(timer); resolve() } })
      child!.stderr!.on('data', chunk => { logs += chunk })
      child!.once('exit', () => { clearTimeout(timer); reject(new Error('Agent startup failed')) })
    })
    const root = `http://127.0.0.1:${appPort}/api`
    const login = await fetch(root + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'fixture-password' }) }).then(r => r.json())
    const request = (path: string, method = 'GET', body?: unknown) => fetch(root + path, { method, headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const add = async (authType = 'token', verifyTls = false) => request('/clusters', 'POST', { name: 'console fixture', host: '127.0.0.1', port: pvePort, authType, username: authType === 'token' ? 'root@pam!fixture' : 'root@pam', secret: authType === 'token' ? 'private-api-secret' : 'private-password', verifyTls }).then(r => r.json())
    const cluster = await add()
    assert.ok(cluster.id)
    const target = () => ({ type: 'connect', clusterId: cluster.id, node: 'pve1', guestType: guest.type, vmid: 101, cols: 80, rows: 24, token: login.token })
    const open = async () => { const p = peer(`ws://127.0.0.1:${appPort}/api/console`); peers.push(p.socket); await p.ready(); return p }

    await t.test('unauthenticated first frame fails before upstream; token stays out of URL', async () => {
      const count = calls.length
      const p = await open(); p.send({ ...target(), token: 'wrong' })
      assert.equal((await p.message(m => m.type === 'error')).message, 'Not logged in')
      assert.equal(calls.length, count)
    })
    await t.test('origin and query bearer bypasses are rejected before upstream', async () => {
      const count = calls.length
      for (const [url, headers, code] of [
        [`ws://127.0.0.1:${appPort}/api/console`, { Origin: 'https://untrusted.invalid' }, 403],
        [`ws://127.0.0.1:${appPort}/api/console?token=${login.token}`, {}, 401],
      ] as const) {
        const ws = new WebSocket(url, { headers }); ws.on('error', () => {})
        const [, response] = await once(ws, 'unexpected-response'); assert.equal(response.statusCode, code); response.resume(); ws.terminate()
      }
      assert.equal(calls.length, count)
    })
    await t.test('transport rejects oversized announced and fragmented messages before complete buffering', async () => {
      const count = calls.length
      const oversized = await open()
      const header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0xff; header.writeBigUInt64BE(BigInt(256 * 1024 + 1), 2)
      const closedHeader = once(oversized.socket, 'close')
      ;(oversized.socket as any)._socket.write(header)
      await Promise.race([closedHeader, new Promise((_, reject) => setTimeout(() => reject(new Error('Oversize announced length was not rejected')), 800))])
      const fragmented = await open()
      const fragment = (opcode: number, length: number) => {
        const frame = Buffer.alloc(14 + length); frame[0] = opcode; frame[1] = 0xff; frame.writeBigUInt64BE(BigInt(length), 2); return frame
      }
      const closedFragments = once(fragmented.socket, 'close')
      ;(fragmented.socket as any)._socket.write(fragment(0x01, 150 * 1024))
      ;(fragmented.socket as any)._socket.write(fragment(0x00, 150 * 1024))
      await Promise.race([closedFragments, new Promise((_, reject) => setTimeout(() => reject(new Error('Oversize fragmented message was not rejected')), 800))])
      assert.equal(calls.length, count)
    })
    await t.test('SSH upgrade keeps its existing authentication and transport limit', async () => {
      const ssh = peer(`ws://127.0.0.1:${appPort}/api/ssh`); peers.push(ssh.socket); await ssh.ready()
      ssh.send({ type: 'connect', host: '192.0.2.1', username: 'root', cols: 80, rows: 24, token: 'wrong' })
      assert.equal((await ssh.message(m => m.type === 'error')).message, 'Not logged in')
      const sized = peer(`ws://127.0.0.1:${appPort}/api/ssh`); peers.push(sized.socket); await sized.ready()
      const header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0xff; header.writeBigUInt64BE(BigInt(256 * 1024 + 1), 2)
      ;(sized.socket as any)._socket.write(header)
      await new Promise(resolve => setTimeout(resolve, 150))
      assert.equal(sized.socket.readyState, WebSocket.OPEN)
      sized.socket.terminate()
    })
    await t.test('strict identity and browser frame validation have zero upstream effect', async () => {
      const count = calls.length
      for (const patch of [{ url: 'wss://attacker/' }, { node: '../pve1' }, { vmid: '101' }, { guestType: 'node' }, { cols: 501 }, { rows: 1 }]) {
        const p = await open(); p.send({ ...target(), ...patch }); await p.message(m => m.type === 'error')
      }
      for (const raw of [Buffer.from('{}'), '{']) {
        const p = await open(); p.socket.send(raw); await p.message(m => m.type === 'error')
      }
      assert.equal(calls.length, count)
    })
    await t.test('native binary auth hides tickets, preserves split OK/UTF-8, and counts Unicode input bytes', async () => {
      const p = await open(); p.send(target()); p.send({ type: 'data', data: 'early' }); p.send({ type: 'resize', cols: 90, rows: 30 })
      await p.message(m => m.status === 'connected'); await p.message(m => m.type === 'data' && m.data.includes('😀'))
      assert.equal(p.messages.filter(m => m.type === 'data').map(m => m.data).join(''), 'hello 😀')
      p.send({ type: 'data', data: 'é😀' }); p.send({ type: 'resize', cols: 120, rows: 45 })
      await new Promise(resolve => setTimeout(resolve, 50))
      assert.ok(frames.some(b => b.toString() === '0:6:é😀'))
      assert.ok(frames.some(b => b.toString() === '1:90:30:'))
      assert.ok(frames.some(b => b.toString() === '1:120:45:'))
      assert.ok(!frames.some(b => b.includes(Buffer.from('early'))))
      assert.ok(!JSON.stringify(p.messages).includes('private-'))
      const closed = once(p.socket, 'close'); p.socket.close(); await closed
      await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(sockets.size, 0)
    })
    await t.test('stale, stopped and template guests never create termproxy workers', async () => {
      for (const patch of [{ node: 'pve2' }, { status: 'stopped' }, { template: 1 }, { vmid: 102 }]) {
        const original = guest; guest = { ...guest, ...patch }
        const count = calls.filter(c => c.path.endsWith('/termproxy')).length
        const p = await open(); p.send({ ...target(), node: 'pve1', vmid: 101 }); await p.message(m => m.type === 'error')
        assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).length, count); guest = original
      }
    })
    await t.test('VM selects first configured serial socket; unsupported config has no termproxy effect', async () => {
      guest = { ...guest, type: 'qemu' }; config = { serial0: 'file=/tmp/no', serial1: 'socket', serial2: 'socket' }
      let p = await open(); p.send(target()); await p.message(m => m.status === 'connected'); p.socket.close()
      assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).at(-1)?.body, 'serial=serial1')
      config = { serial0: 'socket,other=invalid' }
      const count = calls.filter(c => c.path.endsWith('/termproxy')).length
      p = await open(); p.send(target()); assert.match((await p.message(m => m.type === 'error')).message, /serial socket/)
      assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).length, count)
      guest = { ...guest, type: 'lxc' }
    })
    await t.test('password-cookie saved authentication works without sending credentials to browser', async () => {
      const password = await add('password')
      const p = await open(); p.send({ ...target(), clusterId: password.id }); await p.message(m => m.status === 'connected'); p.socket.close()
      assert.ok(calls.some(c => c.path.endsWith('/termproxy') && c.cookie === 'PVEAuthCookie=private-cookie'))
      assert.ok(!JSON.stringify(p.messages).includes('private-'))
    })
    await t.test('invalid termproxy fields and permission errors never leak upstream diagnostics', async () => {
      const original = termResponse
      for (const value of [{ user: 'root@pam\nBAD', ticket: 'private-secret', port: 5901 }, { user: 'root@pam', ticket: 'secret\nBAD', port: 5901 }, { user: 'root@pam', ticket: 'secret', port: 6000 }]) {
        termResponse = value; const p = await open(); p.send(target()); const error = await p.message(m => m.type === 'error'); assert.ok(!JSON.stringify(error).includes('secret'))
      }
      termResponse = original
    })
    await t.test('offline node and upstream permission denial are handled without leaking details', async () => {
      const count = calls.filter(c => c.path.endsWith('/termproxy')).length
      nodeStatus = 'offline'
      let p = await open(); p.send(target()); assert.match((await p.message(m => m.type === 'error')).message, /offline/)
      assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).length, count)
      nodeStatus = 'online'; denyTermproxy = true
      p = await open(); p.send(target()); const error = await p.message(m => m.type === 'error')
      assert.match(error.message, /permissions/); assert.ok(!JSON.stringify(error).includes('private'))
      assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).length, count + 1)
      denyTermproxy = false
    })
    await t.test('verified WSS rejects an untrusted certificate', async () => {
      const client = new ProxmoxClient({ host: '127.0.0.1', port: pvePort, authType: 'token', username: 'root@pam!fixture', secret: 'private-api-secret', verifyTls: true })
      const count = sockets.size
      const ws = await client.openGuestConsole('pve1', 'lxc', 101, 5901, 'PVE:private-console-ticket', () => true)
      const [error] = await once(ws, 'error')
      assert.match((error as Error).message, /certificate|self.signed/i)
      assert.equal(sockets.size, count)
    })
    await t.test('passwordless agent rejects a DNS-rebinding Host before console setup', async () => {
      const port = await freePort()
      const localData = mkdtempSync(join(tmpdir(), 'proxmiu-console-dns-'))
      const agent = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...env, PORT: String(port), PROXMIU_PASSWORD: '', PROXMIU_DATA_DIR: localData }, stdio: ['ignore', 'pipe', 'pipe'] })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Agent startup timeout')), 10000)
          agent.stdout!.on('data', chunk => { if (String(chunk).includes('Server listening')) { clearTimeout(timer); resolve() } })
          agent.once('exit', () => { clearTimeout(timer); reject(new Error('Agent startup failed')) })
        })
        const count = calls.length
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/console`, { headers: { Host: `attacker.invalid:${port}` } }); ws.on('error', () => {})
        const [, response] = await once(ws, 'unexpected-response'); assert.equal(response.statusCode, 403); response.resume(); ws.terminate()
        assert.equal(calls.length, count)
      } finally { await stop(agent); rmSync(localData, { recursive: true, force: true }) }
    })
    await t.test('duplicate connect cancels setup and close during validation prevents late termproxy', async () => {
      holdResources = true
      let count = calls.filter(c => c.path.endsWith('/termproxy')).length
      const p = await open(); p.send(target()); p.send(target()); await p.message(m => m.type === 'error')
      await new Promise(resolve => setTimeout(resolve, 30)); delayedResources?.(); delayedResources = undefined
      await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).length, count)
      const q = await open(); q.send(target()); await q.message(m => m.status === 'connecting')
      await new Promise(resolve => setTimeout(resolve, 30)); const closed = once(q.socket, 'close'); q.socket.close(); await closed
      delayedResources?.(); delayedResources = undefined; holdResources = false
      await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(calls.filter(c => c.path.endsWith('/termproxy')).length, count)
    })
    await t.test('oversize input and upstream payload close both sides', async () => {
      let p = await open(); p.send(target()); await p.message(m => m.status === 'connected'); p.send({ type: 'data', data: '😀'.repeat(16385) }); await p.message(m => m.type === 'error')
      p = await open(); p.send(target()); await p.message(m => m.status === 'connected'); for (const ws of sockets) ws.send(Buffer.alloc(1024 * 1024 + 1)); await p.message(m => m.type === 'error')
    })
    assert.ok(!logs.includes('private-console-ticket') && !logs.includes('private-api-secret') && !logs.includes('private-cookie'))
  } finally {
    delayedResources?.()
    for (const ws of peers) ws.terminate()
    for (const ws of sockets) ws.terminate()
    await stop(child); wss.close(); await new Promise<void>(resolve => upstream.close(() => resolve())); rmSync(data, { recursive: true, force: true })
  }
})
