import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { once } from 'node:events'
import type { AddressInfo, Socket } from 'node:net'
import selfsigned from 'selfsigned'
import ssh2, { type ConnectConfig, type Connection } from 'ssh2'

const tls = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keyType: 'ec', algorithm: 'sha256' })
const hostKey = ssh2.utils.generateKeyPairSync('ed25519').private
export type Config = Record<string, string | number>
export interface ApiCall { method: string; path: string; params: Record<string, string> }

/** Only protocol simulation: SSH stdin is captured, never passed to a shell. */
export async function cloneFixture(publicKey: string, options: {
  resources?: readonly unknown[]; source?: Config; clone?: Config; fail?: 'clone' | 'configure' | 'resize' | 'configure-http' | 'resize-http'; scriptExit?: number; scriptEnd?: 'signal' | 'no-status'
} = {}) {
  const source: Config = { template: 1, boot: 'order=scsi1;net0', scsi0: 'local:vm-900-disk-0,size=2G', scsi1: 'local:vm-900-disk-1,size=8G', ide2: 'local:cloudinit,media=cdrom', sockets: 2, vcpus: 1, ...options.source }
  const clone: Config = { ...source, net0: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr-old,tag=70,firewall=1,rate=12.5,mtu=1400,queues=4', ...options.clone }
  const calls: ApiCall[] = [], errors: string[] = [], scripts: string[] = [], commands: string[] = []
  const authenticated: string[] = []
  const polls = new Map<string, number>()
  let pending: { name: string; apply: () => void } | undefined
  const sockets = new Set<Socket>(), sshConnections = new Set<Connection>()
  const api = createServer({ key: tls.private, cert: tls.cert }, async (req, res) => {
    try {
      assert.equal(req.headers.authorization, 'PVEAPIToken=fixture@pve!tests=local-fixture-token')
      const url = new URL(req.url!, 'https://localhost')
      assert.ok(url.pathname.startsWith('/api2/json/'))
      const path = url.pathname.slice('/api2/json'.length)
      let body = ''
      for await (const chunk of req) body += chunk
      const params = Object.fromEntries((req.method === 'GET' ? url.searchParams : new URLSearchParams(body)).entries())
      const call = { method: req.method!, path, params }; calls.push(call)
      if (req.method !== 'GET') assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded')
      let data: unknown
      if (req.method === 'GET' && path === '/cluster/nextid') data = '401'
      else if (req.method === 'GET' && path === '/cluster/resources') { assert.deepEqual(params, { type: 'vm' }); data = options.resources ?? [{ vmid: 900, node: 'pve1', type: 'qemu', template: 1 }] }
      else if (req.method === 'GET' && path === '/nodes/pve1/qemu/900/config') data = source
      else if (req.method === 'POST' && path === '/nodes/pve1/qemu/900/clone') {
        assert.deepEqual(params, { newid: '401', name: 'clone-fixture', full: '1', storage: 'local-lvm' }); data = 'UPID:pve1:clone:'
      } else if (req.method === 'GET' && /^\/nodes\/pve1\/tasks\/UPID%3Apve1%3A(clone|start|configure|resize)%3A\/(log|status)$/.test(path)) {
        const name = /%3A(clone|start|configure|resize)%3A/.exec(path)![1]
        const count = polls.get(name) ?? 0
        if (path.endsWith('/log')) data = [{ n: 1, t: 'Synthetic task output' }]
        else {
          polls.set(name, count + 1)
          const running = ['configure', 'resize'].includes(name) && count === 0
          data = running ? { status: 'running' } : { status: 'stopped', exitstatus: options.fail === name ? `${name} failed` : 'OK' }
          if (!running && pending?.name === name && options.fail !== name) { pending.apply(); pending = undefined }
        }
      } else if (req.method === 'GET' && path === '/nodes/pve1/qemu/401/config') { assert.equal(pending, undefined, 'must await prior config/resize task'); data = clone }
      else if (req.method === 'POST' && path === '/nodes/pve1/qemu/401/config') {
        assert.equal(pending, undefined, 'must await prior config/resize task')
        const allowed = ['cores', 'sockets', 'vcpus', 'memory', 'ciuser', 'cipassword', 'sshkeys', 'ipconfig0', 'agent', 'onboot', 'tags', 'net0']
        assert.ok(Object.keys(params).every(k => allowed.includes(k)), 'unexpected config parameter')
        if (options.fail === 'configure-http') throw new Error('synthetic configure failure')
        pending = { name: 'configure', apply: () => { Object.assign(clone, params) } }; data = 'UPID:pve1:configure:'
      } else if (req.method === 'PUT' && path === '/nodes/pve1/qemu/401/resize') {
        assert.ok(Object.keys(params).every(k => ['disk', 'size'].includes(k)))
        assert.equal(pending, undefined, 'must await prior config/resize task')
        if (options.fail === 'resize-http') throw new Error('synthetic resize failure')
        pending = { name: 'resize', apply: () => { clone[params.disk] = String(clone[params.disk]).replace(/size=[^,]+/, `size=${params.size}`) } }; data = 'UPID:pve1:resize:'
      } else if (req.method === 'POST' && path === '/nodes/pve1/qemu/401/status/start') { assert.equal(pending, undefined, 'must await prior config/resize task'); assert.deepEqual(params, {}); data = 'UPID:pve1:start:' }
      else if (req.method === 'GET' && path === '/nodes/pve1/qemu/401/agent/network-get-interfaces') data = { result: [{ name: 'eth0', 'ip-addresses': [{ 'ip-address': '192.0.2.50', 'ip-address-type': 'ipv4' }] }] }
      else throw new Error(`Unexpected fixture call: ${req.method} ${path}`)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data }))
    } catch (err) {
      const message = (err as Error).message
      if (!message.startsWith('synthetic ')) errors.push(message)
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ errors: { fixture: message } }))
    }
  })
  api.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  const parsed = ssh2.utils.parseKey(publicKey)
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Invalid fixture public key')
  const ssh = new ssh2.Server({ hostKeys: [hostKey] }, conn => {
    sshConnections.add(conn); conn.on('close', () => sshConnections.delete(conn)); conn.on('error', err => errors.push(err.message))
    conn.on('authentication', ctx => {
      if (ctx.method !== 'publickey' || ctx.username !== 'fixture-user' || !ctx.key.data.equals(parsed.getPublicSSH())) return ctx.reject()
      if (ctx.signature && parsed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject()
      if (ctx.signature) authenticated.push(ctx.username)
      ctx.accept()
    })
    conn.on('ready', () => conn.on('session', accept => {
      const session = accept()
      session.on('exec', (acceptExec, _reject, info) => {
        commands.push(info.command)
        const stream = acceptExec(); let input = ''
        stream.on('data', (chunk: Buffer) => { input += chunk.toString() })
        stream.on('end', () => {
          scripts.push(input); stream.write('Synthetic install output\n'); stream.stderr.write('Synthetic stderr\n')
          if (options.scriptEnd === 'signal') stream.exit('TERM', false, 'Synthetic termination')
          else if (options.scriptEnd !== 'no-status') stream.exit(options.scriptExit ?? 0)
          stream.end()
        })
      })
    }))
  })
  api.listen(0, '127.0.0.1'); await once(api, 'listening')
  ssh.listen(0, '127.0.0.1'); await once(ssh, 'listening')
  const original = ssh2.Client.prototype.connect
  ssh2.Client.prototype.connect = function(config: ConnectConfig) {
    assert.ok(['192.0.2.50', '192.0.2.60'].includes(config.host!), 'SSH must target the simulated guest only')
    assert.ok(config.privateKey, 'runner must use the injected app key')
    return original.call(this, { ...config, host: '127.0.0.1', port: (ssh.address() as AddressInfo).port })
  }
  return {
    port: (api.address() as AddressInfo).port, calls, errors, scripts, commands, authenticated,
    async close() {
      ssh2.Client.prototype.connect = original
      for (const conn of sshConnections) conn.end()
      for (const socket of sockets) socket.destroy()
      await Promise.all([new Promise<void>(resolve => api.close(() => resolve())), new Promise<void>(resolve => ssh.close(() => resolve()))])
    },
  }
}
