import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import WebSocket from 'ws'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

class Socket extends EventEmitter {
  readyState = WebSocket.OPEN
  bufferedAmount = 0
  sent: string[] = []
  send(value: string | Buffer) { this.sent.push(value.toString()) }
  close() { this.readyState = WebSocket.CLOSED; this.emit('close') }
  terminate() { this.close() }
  frame(value: object) { this.emit('message', Buffer.from(JSON.stringify(value)), false) }
}
const target = { type: 'connect', clusterId: 'one', node: 'pve1', guestType: 'lxc', vmid: 101, cols: 80, rows: 24 }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test('console deadlines, keepalive and backpressure close and clear both sides', async t => {
  const data = mkdtempSync(join(tmpdir(), 'proxmiu-console-clock-'))
  process.env.PROXMIU_DATA_DIR = data
  t.after(() => rmSync(data, { recursive: true, force: true }))
  const { handleConsoleSocket } = await import('../src/guest-console.js')
  const { ProxmoxClient } = await import('../src/proxmox.js')
  const { store } = await import('../src/store.js')
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const browser = new Socket()
  handleConsoleSocket(browser as unknown as WebSocket, () => true)
  t.mock.timers.tick(4999); assert.equal(browser.readyState, WebSocket.OPEN)
  t.mock.timers.tick(1); assert.match(browser.sent.join(''), /timed out/); assert.equal(browser.readyState, WebSocket.CLOSED)

  const upstream = new Socket()
  let release: (value: unknown) => void = () => {}
  let pending = true
  let posts = 0
  const client = {
    get: (path: string) => path === '/cluster/resources' ? pending ? new Promise(resolve => { release = resolve }) : Promise.resolve([{ type: 'lxc', vmid: 101, node: 'pve1', status: 'running' }]) : Promise.resolve([{ node: 'pve1', status: 'online' }]),
    post: async () => { posts++; return { user: 'root@pam', ticket: 'ticket', port: 5901 } },
    openGuestConsole: async () => upstream,
  }
  t.mock.method(store, 'getCluster', () => ({} as ReturnType<typeof store.getCluster>))
  t.mock.method(ProxmoxClient, 'fromRecord', () => client as unknown as InstanceType<typeof ProxmoxClient>)
  const timeout = new Socket(); handleConsoleSocket(timeout as unknown as WebSocket, () => true); timeout.frame(target)
  t.mock.timers.tick(14999); assert.equal(timeout.readyState, WebSocket.OPEN)
  t.mock.timers.tick(1); assert.equal(timeout.readyState, WebSocket.CLOSED)
  release([{ type: 'lxc', vmid: 101, node: 'pve1', status: 'running' }]); await flush(); assert.equal(posts, 0)

  pending = false
  const active = new Socket(); handleConsoleSocket(active as unknown as WebSocket, () => true); active.frame(target); await flush()
  upstream.emit('open'); upstream.emit('message', Buffer.from('OK'), true)
  assert.ok(active.sent.some(v => v.includes('connected')))
  t.mock.timers.tick(29999); assert.equal(upstream.sent.filter(v => v === '2').length, 0)
  t.mock.timers.tick(1); assert.equal(upstream.sent.filter(v => v === '2').length, 1)
  active.close(); assert.equal(upstream.readyState, WebSocket.CLOSED)
  t.mock.timers.tick(60000); assert.equal(upstream.sent.filter(v => v === '2').length, 1)

  const blockedUpstream = new Socket()
  client.openGuestConsole = async () => blockedUpstream
  const blocked = new Socket(); handleConsoleSocket(blocked as unknown as WebSocket, () => true); blocked.frame(target); await flush()
  blockedUpstream.emit('open'); blockedUpstream.emit('message', Buffer.from('OK'), true)
  blockedUpstream.bufferedAmount = 1024 * 1024
  blocked.frame({ type: 'data', data: 'x' })
  assert.match(blocked.sent.join(''), /too slow/); assert.equal(blocked.readyState, WebSocket.CLOSED); assert.equal(blockedUpstream.readyState, WebSocket.CLOSED)

  const slowUpstream = new Socket(); client.openGuestConsole = async () => slowUpstream
  const slow = new Socket(); handleConsoleSocket(slow as unknown as WebSocket, () => true); slow.frame(target); await flush()
  slowUpstream.emit('open'); slowUpstream.emit('message', Buffer.from('OK'), true)
  slow.bufferedAmount = 1024 * 1024
  slowUpstream.emit('message', Buffer.from('output'), true)
  assert.equal(slow.readyState, WebSocket.CLOSED); assert.equal(slowUpstream.readyState, WebSocket.CLOSED)
})
