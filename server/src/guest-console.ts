import { StringDecoder } from 'node:string_decoder'
import WebSocket, { type RawData } from 'ws'
import { z } from 'zod'
import { ProxmoxClient, type ClusterResource } from './proxmox.js'
import { store } from './store.js'

const limit = 1024 * 1024
const size = { cols: z.number().int().min(2).max(500), rows: z.number().int().min(2).max(300) }
const connectFrame = z.strictObject({ type: z.literal('connect'), clusterId: z.string().min(1).max(128), node: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), guestType: z.enum(['lxc', 'qemu']), vmid: z.number().int().min(1).max(999999999), ...size, token: z.string().max(4096).optional() })
const dataFrame = z.strictObject({ type: z.literal('data'), data: z.string() })
const resizeFrame = z.strictObject({ type: z.literal('resize'), ...size })

export function handleConsoleSocket(browser: WebSocket, authorize: (token?: string) => boolean) {
  let upstream: WebSocket | undefined
  let started = false, done = false, connected = false
  let resize: { cols: number; rows: number } | undefined
  let setupTimer: ReturnType<typeof setTimeout> | undefined
  let keepalive: ReturnType<typeof setInterval> | undefined
  const firstTimer = setTimeout(() => fail('Console connection timed out.'), 5000)
  const send = (msg: object) => {
    if (done || browser.readyState !== WebSocket.OPEN) return
    const payload = JSON.stringify(msg)
    if (browser.bufferedAmount + Buffer.byteLength(payload) > limit) { cleanup(); browser.close(); return }
    browser.send(payload)
  }
  function cleanup() {
    if (done) return
    done = true
    clearTimeout(firstTimer); clearTimeout(setupTimer); clearInterval(keepalive)
    if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate()
  }
  function fail(message: string) {
    if (done) return
    send({ type: 'error', message }); cleanup()
    if (browser.readyState === WebSocket.OPEN) browser.close()
  }
  function native(data: string) {
    if (!upstream || upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount + Buffer.byteLength(data) > limit) return fail('Console connection is too slow.')
    upstream.send(Buffer.from(data), { binary: true })
  }
  async function start(msg: z.infer<typeof connectFrame>) {
    send({ type: 'status', status: 'connecting' })
    setupTimer = setTimeout(() => fail('Console connection timed out.'), 15000)
    try {
      const client = ProxmoxClient.fromRecord(store.getCluster(msg.clusterId))
      const resources = await client.get<ClusterResource[]>('/cluster/resources', { type: 'vm' })
      if (done) return
      const guest = resources?.find(g => g.type === msg.guestType && g.vmid === msg.vmid && g.node === msg.node)
      if (!guest || guest.status !== 'running' || guest.template) return fail('Guest is unavailable, moved, stopped, or a template. Refresh the workspace.')
      const nodes = await client.get<{ node: string; status: string }[]>('/nodes')
      if (done) return
      if (!nodes?.some(n => n.node === msg.node && n.status === 'online')) return fail('Guest node is offline. Refresh the workspace.')
      const path = `/nodes/${encodeURIComponent(msg.node)}/${msg.guestType}/${msg.vmid}`
      let serial: string | undefined
      if (msg.guestType === 'qemu') {
        const config = await client.get<Record<string, unknown>>(`${path}/config`)
        if (done) return
        serial = ['serial0', 'serial1', 'serial2', 'serial3'].find(k => config?.[k] === 'socket')
        if (!serial) return fail('This VM needs a configured serial socket before its console can connect.')
      }
      const result = await client.post<{ user?: unknown; ticket?: unknown; port?: unknown }>(`${path}/termproxy`, { serial })
      if (done) return
      const { user, ticket } = result ?? {}
      const port = Number(result?.port)
      if (typeof user !== 'string' || !/^[^:\s\p{Cc}]{1,256}$/u.test(user) || typeof ticket !== 'string' || !/^[^\s\p{Cc}]{1,4096}$/u.test(ticket) || !Number.isInteger(port) || port < 5900 || port > 5999) return fail('Proxmox returned an invalid console response.')
      const socket = await client.openGuestConsole(msg.node, msg.guestType, msg.vmid, port, ticket, () => !done)
      if (done) { socket.on('error', () => {}); socket.terminate(); return }
      upstream = socket
      let ack = Buffer.alloc(0)
      const decoder = new StringDecoder('utf8')
      socket.on('open', () => { if (!done) native(`${user}:${ticket}\n`) })
      socket.on('message', (raw: RawData, binary: boolean) => {
        if (done) return
        if (!binary) return fail('Invalid console response from Proxmox.')
        let bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
        if (!connected) {
          const needed = 2 - ack.length
          ack = Buffer.concat([ack, bytes.subarray(0, needed)])
          bytes = bytes.subarray(needed)
          if (!Buffer.from('OK').subarray(0, ack.length).equals(ack)) return fail('Proxmox rejected the console session.')
          if (ack.length < 2) return
          connected = true; clearTimeout(setupTimer)
          send({ type: 'status', status: 'connected' })
          const dimensions = resize ?? { cols: msg.cols, rows: msg.rows }
          native(`1:${dimensions.cols}:${dimensions.rows}:`)
          keepalive = setInterval(() => native('2'), 30000)
        }
        const output = decoder.write(bytes)
        // Keep JSON output frames bounded even for control characters that expand when escaped.
        for (let offset = 0; offset < output.length && !done;) {
          let end = Math.min(offset + 32768, output.length)
          if (end < output.length && /[\uD800-\uDBFF]/.test(output[end - 1])) end--
          send({ type: 'data', data: output.slice(offset, end) })
          offset = end
        }
      })
      socket.on('error', () => fail('Could not connect to the guest console. Check permissions and connection settings.'))
      socket.on('close', () => { if (!done) { send({ type: 'status', status: 'closed' }); cleanup(); browser.close() } })
    } catch {
      fail('Could not connect to the guest console. Check permissions and connection settings.')
    }
  }
  browser.on('message', (raw, binary) => {
    if (done) return
    if (binary || Buffer.byteLength(raw.toString()) > 256 * 1024) return fail('Invalid console message.')
    let value: unknown
    try { value = JSON.parse(raw.toString()) } catch { return fail('Invalid console message.') }
    if (!started) {
      const parsed = connectFrame.safeParse(value)
      if (!parsed.success) return fail('Invalid console connection request.')
      started = true; clearTimeout(firstTimer)
      if (!authorize(parsed.data.token)) return fail('Not logged in')
      void start(parsed.data)
      return
    }
    const data = dataFrame.safeParse(value)
    if (data.success) {
      const length = Buffer.byteLength(data.data.data)
      if (length > 65536) return fail('Console input is too large.')
      if (connected) native(`0:${length}:${data.data.data}`)
      return
    }
    const dimensions = resizeFrame.safeParse(value)
    if (dimensions.success) {
      resize = dimensions.data
      if (connected) native(`1:${resize.cols}:${resize.rows}:`)
      return
    }
    fail('Invalid console message.')
  })
  browser.on('close', cleanup)
  browser.on('error', cleanup)
}
