import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import WebSocket from 'ws'

class Socket extends EventEmitter {
  readyState = WebSocket.OPEN
  bufferedAmount = 0
  sent: { bytes: Buffer; binary: boolean }[] = []
  pings = 0
  send(value: string | Buffer, options?: { binary: boolean }) { this.sent.push({ bytes: Buffer.from(value), binary: options?.binary ?? false }) }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close') }
  terminate() { this.close() }
  ping() { this.pings++ }
  frame(value: object) { this.emit('message', Buffer.from(JSON.stringify(value)), false) }
  binary(value: Buffer) { this.emit('message', value, true) }
}
const target = { type: 'connect', clusterId: 'one', node: 'pve1', guestType: 'qemu', vmid: 101 }
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const version = Buffer.from('RFB 003.008\n')
function authenticate(up: Socket, browser?: Socket) {
  up.emit('open')
  up.binary(Buffer.concat([version, Buffer.from([1, 2]), Buffer.alloc(16), Buffer.alloc(4)]))
  if (browser) browser.binary(Buffer.concat([version, Buffer.from([1, 1])]))
}

test('graphical setup, cancellation, heartbeat and backpressure release both peers without replay', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'graphical-clock-'))
  process.env.PROXMIU_DATA_DIR = dir
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { handleGraphicalConsoleSocket } = await import('../src/graphical-console.js')
  const { ProxmoxClient } = await import('../src/proxmox.js')
  const { store } = await import('../src/store.js')
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000 })
  let socket = new Socket(), stage = '', revision = 'one', reads = 0, posts = 0, opens = 0
  let release: ((value: unknown) => void) | undefined
  const resource = [{ type: 'qemu', vmid: 101, node: 'pve1', status: 'running' }]
  const proxy = { ticket: 'private-ticket', password: 'password', port: 5901 }
  const wait = (name: string, value: unknown) => stage === name ? new Promise(resolve => { release = resolve }) : Promise.resolve(value)
  const client = {
    get(path: string) {
      reads++
      return path === '/cluster/resources' ? wait('resources', resource) : path === '/nodes' ? wait('nodes', [{ node: 'pve1', status: 'online' }]) : wait('config', { vga: 'std' })
    },
    post() { posts++; return wait('proxy', proxy) },
    openGuestConsole(_n: string, _t: string, _v: number, _p: number, _ticket: string, _active: () => boolean, mode: string) { assert.equal(mode, 'graphical'); opens++; return wait('socket', socket) },
  }
  t.mock.method(store, 'getCluster', () => ({ name: revision } as ReturnType<typeof store.getCluster>))
  t.mock.method(ProxmoxClient, 'fromRecord', () => client as unknown as ProxmoxClient)
  const make = () => { const b = new Socket(); handleGraphicalConsoleSocket(b as unknown as WebSocket, () => true); return b }
  const first = make()
  t.mock.timers.tick(4999); assert.equal(first.readyState, WebSocket.OPEN)
  t.mock.timers.tick(1); assert.equal(first.readyState, WebSocket.CLOSED); assert.equal(reads, 0)
  for (const blocked of ['resources', 'nodes', 'config', 'proxy', 'socket']) {
    stage = blocked; socket = new Socket(); release = undefined
    const b = make(), beforePosts = posts, beforeOpens = opens
    b.frame(target); await flush(); assert.ok(release, blocked)
    b.close()
    const value = blocked === 'resources' ? resource : blocked === 'nodes' ? [{ node: 'pve1', status: 'online' }] : blocked === 'config' ? { vga: 'std' } : blocked === 'proxy' ? proxy : socket
    release!(value); await flush()
    assert.equal(posts - beforePosts, blocked === 'proxy' || blocked === 'socket' ? 1 : 0, blocked)
    assert.equal(opens - beforeOpens, blocked === 'socket' ? 1 : 0, blocked)
    if (blocked === 'socket') assert.equal(socket.readyState, WebSocket.CLOSED)
  }
  stage = ''; socket = new Socket()
  const beforeInit = make(); beforeInit.frame(target); await flush(); authenticate(socket)
  assert.ok(beforeInit.sent.some(f => !f.binary && JSON.parse(f.bytes.toString()).type === 'ready'))
  t.mock.timers.tick(15000)
  assert.equal(beforeInit.readyState, WebSocket.CLOSED, 'The setup deadline includes frontend RFB negotiation')
  assert.equal(socket.readyState, WebSocket.CLOSED)

  socket = new Socket()
  const active = make(); active.frame(target); await flush(); authenticate(socket, active)
  t.mock.timers.tick(29999); assert.equal(socket.pings, 0)
  t.mock.timers.tick(1); assert.equal(socket.pings, 1); assert.equal(active.pings, 1)
  socket.emit('pong'); active.emit('pong')
  t.mock.timers.tick(30000); assert.equal(socket.pings, 2)
  t.mock.timers.tick(30000); assert.equal(active.readyState, WebSocket.CLOSED)
  const pings = socket.pings
  t.mock.timers.tick(90000); assert.equal(socket.pings, pings)

  for (const side of ['browser', 'upstream']) {
    socket = new Socket()
    const b = make(); b.frame(target); await flush(); authenticate(socket, b)
    if (side === 'browser') { b.bufferedAmount = 32 * 1024 * 1024; socket.binary(Buffer.from([255])) }
    else { socket.bufferedAmount = 32 * 1024 * 1024; b.binary(Buffer.from([255])) }
    assert.equal(b.readyState, WebSocket.CLOSED, side); assert.equal(socket.readyState, WebSocket.CLOSED)
    assert.ok(b.sent.filter(f => !f.binary).every(f => JSON.parse(f.bytes.toString()).type !== 'error'), 'No JSON enters binary handoff after ready')
    assert.equal(socket.listenerCount('message'), 0)
  }
  socket = new Socket()
  const large = make(); large.frame(target); await flush(); authenticate(socket, large)
  socket.binary(Buffer.alloc(600000, 255))
  const chunks = large.sent.filter(f => f.binary).slice(-3)
  assert.deepEqual(chunks.map(f => f.bytes.length), [262144, 262144, 75712])
  assert.equal(Buffer.concat(chunks.map(f => f.bytes)).length, 600000)
  large.close()

  stage = 'config'; release = undefined; socket = new Socket()
  const changed = make(), before = posts
  changed.frame(target); await flush(); revision = 'two'; release!({ vga: 'std' }); await flush()
  assert.equal(changed.readyState, WebSocket.CLOSED); assert.equal(posts, before)
})
