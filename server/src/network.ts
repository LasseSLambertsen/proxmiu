import { promises as dns } from 'node:dns'
import { readFile } from 'node:fs/promises'
import { Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { Agent, fetch } from 'undici'

const insecure = new Agent({ connect: { rejectUnauthorized: false } })

export interface LocalSubnet {
  iface: string
  address: string
  cidr: string
}

const ipToInt = (ip: string) => ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')

/** IPv4 subnets this machine is attached to. Anything wider than /24 is narrowed to the host's own /24. */
export function localSubnets(): LocalSubnet[] {
  const out: LocalSubnet[] = []
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|tailscale|utun|lo)/.test(iface)) continue
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue
      const prefix = Math.max(Number(a.cidr?.split('/')[1] ?? 24), 24)
      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
      out.push({ iface, address: a.address, cidr: `${intToIp(ipToInt(a.address) & mask)}/${prefix}` })
    }
  }
  return out
}

export function expandCidr(cidr: string, maxHosts = 1024): string[] {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim())
  if (!m) throw Object.assign(new Error(`Invalid CIDR "${cidr}"`), { statusCode: 400 })
  const prefix = Number(m[2])
  if (prefix < 22 || prefix > 32) throw Object.assign(new Error('Scan range must be between /22 and /32'), { statusCode: 400 })
  const size = 2 ** (32 - prefix)
  const base = ipToInt(m[1]) & (prefix === 32 ? ~0 : (~0 << (32 - prefix)) >>> 0)
  const hosts: string[] = []
  for (let i = size > 2 ? 1 : 0; i < (size > 2 ? size - 1 : size) && hosts.length < maxHosts; i++) hosts.push(intToIp(base + i))
  return hosts
}

export function portOpen(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new Socket()
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
    sock.connect(port, host)
  })
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export interface DiscoveredHost {
  ip: string
  port: number
  hostname?: string
  proxmox: boolean
  version?: string
}

/** Scans for hosts with the Proxmox web/API port open and confirms they are Proxmox VE. */
export async function discoverProxmox(cidrs: string[], port = 8006): Promise<DiscoveredHost[]> {
  const hosts = [...new Set(cidrs.flatMap((c) => expandCidr(c)))]
  const open = (await mapLimit(hosts, 128, async (ip) => ((await portOpen(ip, port)) ? ip : null))).filter((x): x is string => !!x)
  return mapLimit(open, 16, async (ip) => {
    const result: DiscoveredHost = { ip, port, proxmox: false }
    try {
      const res = await fetch(`https://${ip}:${port}/`, { dispatcher: insecure, signal: AbortSignal.timeout(3000) })
      const html = await res.text()
      result.proxmox = /proxmox/i.test(html)
      result.version = /pvemanagerlib\.js\?ver=(\d+\.\d+(?:\.\d+)?)/.exec(html)?.[1]
    } catch {
      /* port open but not https / not responding */
    }
    result.hostname = await dns.reverse(ip).then((n) => n[0], () => undefined)
    return result
  })
}

/** Looks up an IPv4 address for a MAC in the kernel ARP table, sweeping local subnets first to populate it. */
export async function ipForMac(mac: string, sweep = true): Promise<string | undefined> {
  const wanted = mac.toLowerCase()
  const lookup = async () => {
    const table = await readFile('/proc/net/arp', 'utf8').catch(() => '')
    for (const line of table.split('\n').slice(1)) {
      const [ip, , flags, hw] = line.trim().split(/\s+/)
      if (hw?.toLowerCase() === wanted && flags !== '0x0') return ip
    }
    return undefined
  }
  const found = await lookup()
  if (found || !sweep) return found
  const hosts = localSubnets().flatMap((s) => expandCidr(s.cidr))
  await mapLimit(hosts, 128, (ip) => portOpen(ip, 22, 300))
  return lookup()
}
