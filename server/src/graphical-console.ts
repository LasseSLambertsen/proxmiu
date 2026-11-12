import WebSocket, { type RawData } from 'ws'
import { z } from 'zod'
import { ProxmoxClient, type ClusterResource } from './proxmox.js'
import { RfbAuthBridge } from './rfb-auth.js'
import { store } from './store.js'

const messageLimit = 16 * 1024 * 1024
const bufferLimit = 32 * 1024 * 1024
const chunkLimit = 256 * 1024
const connectFrame = z.strictObject({ type: z.literal('connect'), clusterId: z.string().min(1).max(128), node: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), guestType: z.literal('qemu'), vmid: z.number().int().min(1).max(999999999), token: z.string().max(4096).optional() })
const bytesOf = (raw: RawData) => Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw)

export function handleGraphicalConsoleSocket(browser: WebSocket, authorize: (token?: string) => boolean) {
  let upstream: WebSocket | undefined, bridge: RfbAuthBridge | undefined
  let started = false, done = false, binaryReady = false
  let setupTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let browserPong = Date.now(), upstreamPong = Date.now()
  const firstTimer = setTimeout(() => fail('Graphical console connection timed out.'), 5000)
  function sendJson(value: object) {
    if (done || binaryReady || browser.readyState !== WebSocket.OPEN) return
    const data = JSON.stringify(value)
    if (browser.bufferedAmount + Buffer.byteLength(data) > bufferLimit) throw new Error('Console backpressure')
    browser.send(data)
  }
  function send(socket: WebSocket | undefined, bytes: Buffer) {
    if (done) return
    if (!socket || socket.readyState !== WebSocket.OPEN || bytes.length > messageLimit || socket.bufferedAmount + bytes.length > bufferLimit) throw new Error('Console backpressure')
    for (let start = 0; start < bytes.length; start += chunkLimit) socket.send(bytes.subarray(start, start + chunkLimit), { binary: true })
  }
  function cleanup() {
    if (done) return
    done = true
    clearTimeout(firstTimer); clearTimeout(setupTimer); clearInterval(heartbeat)
    bridge?.dispose(); bridge = undefined
    browser.off('message', onMessage); browser.off('close', onClose); browser.off('error', onClose); browser.off('pong', onBrowserPong)
    browser.once('error', () => {})
    if (upstream) {
      for (const event of ['open', 'message', 'close', 'error', 'pong']) upstream.removeAllListeners(event)
      upstream.once('error', () => {})
      if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate()
      upstream = undefined
    }
  }
  function fail(message: string) {
    if (done) return
    try { sendJson({ type: 'error', message }) } catch { /* Close on backpressure. */ }
    cleanup()
    if (browser.readyState === WebSocket.OPEN) browser.close(1008, 'Graphical console ended.')
  }
  function onClose() { cleanup() }
  function onBrowserPong() { browserPong = Date.now() }

  async function start(msg: z.infer<typeof connectFrame>) {
    setupTimer = setTimeout(() => fail('Graphical console connection timed out.'), 15000)
    try {
      sendJson({ type: 'status', status: 'connecting' })
      const record = store.getCluster(msg.clusterId)
      const revision = JSON.stringify(record)
      const active = () => {
        if (done) return false
        try { return revision === JSON.stringify(store.getCluster(msg.clusterId)) } catch { return false }
      }
      const check = () => { if (active()) return true; fail('Connection settings changed. Reconnect deliberately.'); return false }
      const client = ProxmoxClient.fromRecord(record)
      const resources = await client.get<ClusterResource[]>('/cluster/resources', { type: 'vm' })
      if (!check()) return
      const matches = Array.isArray(resources) ? resources.filter(g => g && g.type === 'qemu' && g.vmid === msg.vmid) : []
      const guest = matches.length === 1 ? matches[0] : undefined
      if (!guest || guest.node !== msg.node || guest.status !== 'running' || guest.template) return fail('Guest is unavailable, moved, stopped, or a template. Refresh the workspace.')
      const nodes = await client.get<{ node: string; status: string }[]>('/nodes')
      if (!check()) return
      if (!Array.isArray(nodes) || !nodes.some(n => n?.node === msg.node && n.status === 'online')) return fail('Guest node is offline. Refresh the workspace.')
      const path = `/nodes/${encodeURIComponent(msg.node)}/qemu/${msg.vmid}`
      const config = await client.get<Record<string, unknown>>(`${path}/config`)
      if (!check()) return
      if (!config || typeof config !== 'object' || Array.isArray(config)) return fail('VM display configuration is unavailable. Refresh and check permissions.')
      if (config.vga !== undefined && typeof config.vga !== 'string') return fail('VM display configuration is unsupported.')
      const display = typeof config.vga === 'string' ? config.vga.split(',').map(part => part.trim()).find(part => part.startsWith('type='))?.slice(5) ?? config.vga.split(',')[0].trim() : 'std'
      if (display === 'none' || /^serial\d+$/.test(display)) return fail('This VM has no graphical display. Choose Serial text or configure a display in Proxmox first.')
      const response = await client.post<{ ticket?: unknown; password?: unknown; port?: unknown }>(`${path}/vncproxy`, { websocket: 1, 'generate-password': 1 })
      if (!check()) return
      const { ticket, password } = response ?? {}
      const port = Number(response?.port)
      if (typeof ticket !== 'string' || !/^[^\s\p{Cc}]{1,4096}$/u.test(ticket) || typeof password !== 'string' || !/^[\x20-\x7e]{8}$/.test(password) || !Number.isInteger(port) || port < 5900 || port > 5999) return fail('Proxmox returned an invalid graphical console response.')
      bridge = new RfbAuthBridge(password, {
        toUpstream: bytes => send(upstream, bytes),
        toBrowser: bytes => send(browser, bytes),
        ready: () => { if (!check()) return; sendJson({ type: 'ready' }); binaryReady = true },
        connected: () => clearTimeout(setupTimer),
      })
      const socket = await client.openGuestConsole(msg.node, 'qemu', msg.vmid, port, ticket, active, 'graphical')
      if (!check()) { socket.once('error', () => {}); socket.terminate(); return }
      upstream = socket
      socket.on('open', () => {
        if (!check()) return
        browserPong = upstreamPong = Date.now()
        heartbeat = setInterval(() => {
          if (!check()) return
          if (Date.now() - browserPong >= 60000 || Date.now() - upstreamPong >= 60000) return fail('Graphical console stopped responding.')
          try { browser.ping(); socket.ping() } catch { fail('Graphical console stopped responding.') }
        }, 30000)
      })
      socket.on('pong', () => { upstreamPong = Date.now() })
      socket.on('message', (raw, binary) => {
        if (done) return
        try {
          if (!binary) throw new Error('Invalid RFB message')
          bridge?.upstream(bytesOf(raw))
        } catch { fail('Could not authenticate or read the graphical console. Check the VM display and connection permissions.') }
      })
      socket.on('error', () => fail('Could not connect to the graphical console. Check connection settings and VM.Console permissions.'))
      socket.on('close', () => { if (done) return; fail('The graphical console disconnected. Reconnect deliberately.') })
    } catch { fail('Could not connect to the graphical console. Check connection settings and VM.Console permissions.') }
  }
  function onMessage(raw: RawData, binary: boolean) {
    if (done) return
    try {
      if (!started) {
        const bytes = bytesOf(raw)
        if (binary || bytes.length > 8192) return fail('Invalid graphical console connection request.')
        let value: unknown
        try { value = JSON.parse(bytes.toString()) } catch { return fail('Invalid graphical console connection request.') }
        const parsed = connectFrame.safeParse(value)
        if (!parsed.success) return fail('Invalid graphical console connection request.')
        started = true; clearTimeout(firstTimer)
        if (!authorize(parsed.data.token)) return fail('Not logged in')
        void start(parsed.data)
      } else {
        if (!binaryReady || !binary) return fail('Invalid graphical console message.')
        bridge?.browser(bytesOf(raw))
      }
    } catch { fail('Graphical console traffic could not be accepted. Reconnect deliberately.') }
  }
  browser.on('message', onMessage)
  browser.on('close', onClose)
  browser.on('error', onClose)
  browser.on('pong', onBrowserPong)
}
