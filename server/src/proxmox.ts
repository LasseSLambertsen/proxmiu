import { Agent, fetch } from 'undici'
import { decrypt, type ClusterRecord } from './store.js'

export class ProxmoxError extends Error {
  constructor(message: string, public statusCode: number, public details?: unknown) {
    super(message)
  }
}

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })
const secureAgent = new Agent()

type Params = Record<string, string | number | boolean | undefined>

export interface ConnectionInput {
  host: string
  port: number
  authType: 'token' | 'password'
  username: string
  secret: string
  verifyTls: boolean
}

export class ProxmoxClient {
  private ticket?: { cookie: string; csrf: string; expires: number }

  constructor(private conn: ConnectionInput) {}

  static fromRecord(rec: ClusterRecord) {
    const cached = clientCache.get(rec.id)
    if (cached) return cached
    const client = new ProxmoxClient({ ...rec, secret: decrypt(rec.secret) })
    clientCache.set(rec.id, client)
    return client
  }

  get baseUrl() {
    const host = this.conn.host.includes(':') && !this.conn.host.startsWith('[') ? `[${this.conn.host}]` : this.conn.host
    return `https://${host}:${this.conn.port}/api2/json`
  }

  private async authHeaders(write: boolean): Promise<Record<string, string>> {
    if (this.conn.authType === 'token') {
      return { Authorization: `PVEAPIToken=${this.conn.username}=${this.conn.secret}` }
    }
    if (!this.ticket || this.ticket.expires < Date.now()) await this.login()
    const headers: Record<string, string> = { Cookie: `PVEAuthCookie=${encodeURIComponent(this.ticket!.cookie)}` }
    if (write) headers.CSRFPreventionToken = this.ticket!.csrf
    return headers
  }

  private async login() {
    const res = await fetch(`${this.baseUrl}/access/ticket`, {
      method: 'POST',
      dispatcher: this.conn.verifyTls ? secureAgent : insecureAgent,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.conn.username, password: this.conn.secret }).toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new ProxmoxError('Proxmox rejected the username or password', 401)
    const { data } = (await res.json()) as { data: { ticket: string; CSRFPreventionToken: string } }
    // Tickets live for 2h; refresh well before that.
    this.ticket = { cookie: data.ticket, csrf: data.CSRFPreventionToken, expires: Date.now() + 90 * 60_000 }
  }

  async request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, params: Params = {}): Promise<T> {
    const clean = Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v)]),
    )
    const query = new URLSearchParams(clean).toString()
    const hasBody = method === 'POST' || method === 'PUT'
    const url = `${this.baseUrl}${path}${!hasBody && query ? `?${query}` : ''}`
    let res
    try {
      res = await fetch(url, {
        method,
        dispatcher: this.conn.verifyTls ? secureAgent : insecureAgent,
        headers: {
          ...(await this.authHeaders(method !== 'GET')),
          ...(hasBody ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: hasBody ? query : undefined,
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      const cause = (err as { cause?: { code?: string; message?: string } }).cause
      throw new ProxmoxError(`Could not reach ${this.conn.host}:${this.conn.port} (${cause?.code ?? cause?.message ?? (err as Error).message})`, 502)
    }
    const text = await res.text()
    let body: { data?: T; errors?: Record<string, string>; message?: string } = {}
    try {
      body = JSON.parse(text)
    } catch {
      /* Proxmox sometimes returns plain text errors */
    }
    if (!res.ok) {
      if (res.status === 401 && this.conn.authType === 'password') this.ticket = undefined
      const detail = body.errors ? Object.entries(body.errors).map(([k, v]) => `${k}: ${v}`).join('; ') : ''
      const reason = res.statusText || body.message || text.slice(0, 200)
      throw new ProxmoxError(`Proxmox ${method} ${path} failed: ${reason}${detail ? ` (${detail})` : ''}`, res.status === 401 ? 401 : 502, body.errors)
    }
    return body.data as T
  }

  get = <T = unknown>(path: string, params?: Params) => this.request<T>('GET', path, params)
  post = <T = unknown>(path: string, params?: Params) => this.request<T>('POST', path, params)
  put = <T = unknown>(path: string, params?: Params) => this.request<T>('PUT', path, params)
  del = <T = unknown>(path: string, params?: Params) => this.request<T>('DELETE', path, params)

  /** Waits for a task (UPID) to finish. Throws if it did not end with OK. */
  async waitForTask(node: string, upid: string, opts: { timeoutMs?: number; onProgress?: (line: string) => void } = {}) {
    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000)
    let logStart = 0
    const path = `/nodes/${node}/tasks/${encodeURIComponent(upid)}`
    while (Date.now() < deadline) {
      if (opts.onProgress) {
        const lines = await this.get<{ n: number; t: string }[]>(`${path}/log`, { start: logStart, limit: 500 }).catch(() => [])
        for (const l of lines) {
          if (l.t && l.t !== 'no content') opts.onProgress(l.t)
          logStart = l.n
        }
      }
      const status = await this.get<{ status: string; exitstatus?: string }>(`${path}/status`)
      if (status.status === 'stopped') {
        if (status.exitstatus !== 'OK' && !status.exitstatus?.startsWith('WARNINGS')) {
          throw new ProxmoxError(`Task failed: ${status.exitstatus ?? 'unknown error'}`, 502)
        }
        return
      }
      await sleep(1500)
    }
    throw new ProxmoxError('Timed out waiting for Proxmox task', 504)
  }
}

const clientCache = new Map<string, ProxmoxClient>()
export const forgetClient = (id: string) => clientCache.delete(id)

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface ClusterResource {
  id: string
  type: 'node' | 'qemu' | 'lxc' | 'storage' | 'pool' | 'sdn'
  node?: string
  vmid?: number
  name?: string
  status?: string
  template?: number
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  tags?: string
  storage?: string
  content?: string
  netin?: number
  netout?: number
}

/** Finds the first usable IPv4 address of a running guest, or undefined. */
export async function guestIp(client: ProxmoxClient, node: string, type: 'qemu' | 'lxc', vmid: number): Promise<string | undefined> {
  const usable = (ip?: string) => !!ip && !ip.startsWith('127.') && !ip.startsWith('169.254.') && !ip.startsWith('172.17.')
  if (type === 'lxc') {
    const ifaces = await client.get<{ name: string; inet?: string }[]>(`/nodes/${node}/lxc/${vmid}/interfaces`)
    for (const i of ifaces ?? []) {
      const ip = i.inet?.split('/')[0]
      if (i.name !== 'lo' && usable(ip)) return ip
    }
    return undefined
  }
  const res = await client.get<{ result: { name: string; 'ip-addresses'?: { 'ip-address': string; 'ip-address-type': string }[] }[] }>(
    `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`,
  )
  for (const i of res?.result ?? []) {
    if (i.name === 'lo' || i.name.startsWith('docker') || i.name.startsWith('br-')) continue
    const ip = i['ip-addresses']?.find((a) => a['ip-address-type'] === 'ipv4' && usable(a['ip-address']))
    if (ip) return ip['ip-address']
  }
  return undefined
}
