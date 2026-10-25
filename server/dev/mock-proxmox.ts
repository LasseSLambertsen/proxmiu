/**
 * A small fake Proxmox VE API for developing the UI without a real host.
 *   npm run mock   → https://127.0.0.1:8006, token: root@pam!proxmiu / secret "mock"
 * Containers it "creates" report MOCK_GUEST_IP (default 127.0.0.1) so provisioning can SSH somewhere real.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.MOCK_PORT ?? 8006)
const TOKEN = `PVEAPIToken=${process.env.MOCK_TOKEN_ID ?? 'root@pam!proxmiu'}=mock`
const GUEST_IP = process.env.MOCK_GUEST_IP ?? '127.0.0.1'

const dir = mkdtempSync(join(tmpdir(), 'mock-pve-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=pve-mock', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' })

interface Guest {
  vmid: number
  type: 'qemu' | 'lxc'
  name: string
  node: string
  status: 'running' | 'stopped'
  maxcpu: number
  maxmem: number
  maxdisk: number
  ip?: string
  tags?: string
  template?: number
  started?: number
}

const GiB = 1024 ** 3
const nodes = [
  { node: 'pve1', ip: '192.168.1.10', maxcpu: 16, maxmem: 64 * GiB },
  { node: 'pve2', ip: '192.168.1.11', maxcpu: 8, maxmem: 32 * GiB },
]
const now = () => Math.floor(Date.now() / 1000)
const guests: Guest[] = [
  { vmid: 100, type: 'qemu', name: 'home-assistant', node: 'pve1', status: 'running', maxcpu: 2, maxmem: 4 * GiB, maxdisk: 32 * GiB, ip: '192.168.1.50', started: now() - 86400 * 12 },
  { vmid: 101, type: 'lxc', name: 'pihole', node: 'pve1', status: 'running', maxcpu: 1, maxmem: 0.5 * GiB, maxdisk: 4 * GiB, ip: '192.168.1.53', started: now() - 86400 * 40 },
  { vmid: 102, type: 'lxc', name: 'jellyfin', node: 'pve1', status: 'running', maxcpu: 4, maxmem: 8 * GiB, maxdisk: 16 * GiB, ip: '192.168.1.61', started: now() - 3600 * 7 },
  { vmid: 103, type: 'qemu', name: 'win11', node: 'pve2', status: 'stopped', maxcpu: 8, maxmem: 16 * GiB, maxdisk: 128 * GiB },
  { vmid: 104, type: 'lxc', name: 'nextcloud', node: 'pve2', status: 'running', maxcpu: 2, maxmem: 4 * GiB, maxdisk: 64 * GiB, ip: '192.168.1.70', started: now() - 86400 * 3 },
  { vmid: 110, type: 'lxc', name: 'claude-box', node: 'pve1', status: 'running', maxcpu: 4, maxmem: 8 * GiB, maxdisk: 32 * GiB, ip: '192.168.1.80', tags: 'proxmiu;claude-code', started: now() - 3600 * 30 },
  { vmid: 9000, type: 'qemu', name: 'debian-12-cloud', node: 'pve1', status: 'stopped', maxcpu: 2, maxmem: 2 * GiB, maxdisk: 3 * GiB, template: 1 },
]
const tasks = new Map<string, { done: number; log: string[] }>()
const local = ['local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst']

function task(node: string, kind: string, ms = 1500, log: string[] = []) {
  const upid = `UPID:${node}:0000${Math.floor(Math.random() * 9999)}:0:${now().toString(16)}:${kind}::root@pam:`
  tasks.set(upid, { done: Date.now() + ms, log })
  return upid
}
const usage = (g: Guest) => (g.status === 'running' ? { cpu: Math.random() * 0.4, mem: Math.floor(g.maxmem * (0.3 + Math.random() * 0.4)), uptime: now() - (g.started ?? now()) } : { cpu: 0, mem: 0, uptime: 0 })

type Handler = (m: RegExpMatchArray, body: URLSearchParams) => unknown
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/version$/, () => ({ version: '8.4.1', release: '8.4' })],
  ['GET', /^\/cluster\/status$/, () => [{ type: 'cluster', name: 'homelab' }, ...nodes.map((n) => ({ type: 'node', name: n.node, ip: n.ip, online: 1 }))]],
  ['GET', /^\/nodes$/, () => nodes.map((n) => ({ node: n.node, status: 'online' }))],
  ['GET', /^\/cluster\/nextid$/, () => String(Math.max(...guests.filter((g) => g.vmid < 9000).map((g) => g.vmid)) + 1)],
  [
    'GET',
    /^\/cluster\/resources$/,
    () => [
      ...nodes.map((n) => ({ id: `node/${n.node}`, type: 'node', node: n.node, status: 'online', maxcpu: n.maxcpu, cpu: 0.1 + Math.random() * 0.25, maxmem: n.maxmem, mem: n.maxmem * (0.35 + Math.random() * 0.1), uptime: 86400 * 41 })),
      ...guests.map((g) => ({ id: `${g.type}/${g.vmid}`, type: g.type, vmid: g.vmid, name: g.name, node: g.node, status: g.status, maxcpu: g.maxcpu, maxmem: g.maxmem, maxdisk: g.maxdisk, template: g.template ?? 0, tags: g.tags, ...usage(g) })),
    ],
  ],
  [
    'GET',
    /^\/nodes\/([\w-]+)\/storage$/,
    (_m, q) =>
      [
        { storage: 'local', content: 'iso,vztmpl,backup', type: 'dir', avail: 80 * GiB, total: 100 * GiB, active: 1 },
        { storage: 'local-lvm', content: 'rootdir,images', type: 'lvmthin', avail: 610 * GiB, total: 900 * GiB, active: 1 },
        { storage: 'tank', content: 'rootdir,images', type: 'zfspool', avail: 2400 * GiB, total: 4000 * GiB, active: 1 },
      ].filter((s) => !q.get('content') || s.content.includes(q.get('content')!)),
  ],
  ['GET', /^\/nodes\/[\w-]+\/storage\/([\w-]+)\/content$/, (m) => local.filter((v) => v.startsWith(`${m[1]}:`)).map((volid) => ({ volid }))],
  ['GET', /^\/nodes\/[\w-]+\/aplinfo$/, () => ['debian-12-standard_12.7-1_amd64.tar.zst', 'debian-13-standard_13.1-2_amd64.tar.zst', 'ubuntu-24.04-standard_24.04-2_amd64.tar.zst', 'alpine-3.22-default_20250617_amd64.tar.xz'].map((template) => ({ template, section: 'system' }))],
  [
    'POST',
    /^\/nodes\/([\w-]+)\/aplinfo$/,
    (m, b) => {
      local.push(`${b.get('storage')}:vztmpl/${b.get('template')}`)
      return task(m[1], 'download', 3000, [`downloading ${b.get('template')}`, 'download finished'])
    },
  ],
  ['GET', /^\/nodes\/[\w-]+\/network$/, () => [{ iface: 'vmbr0' }, { iface: 'vmbr1' }]],
  [
    'POST',
    /^\/nodes\/([\w-]+)\/lxc$/,
    (m, b) => {
      const vmid = Number(b.get('vmid'))
      guests.push({ vmid, type: 'lxc', name: b.get('hostname')!, node: m[1], status: 'stopped', maxcpu: Number(b.get('cores')), maxmem: Number(b.get('memory')) * 1024 ** 2, maxdisk: 32 * GiB, ip: GUEST_IP, tags: b.get('tags') ?? undefined })
      return task(m[1], 'vzcreate', 2500, ['extracting archive', `Creating filesystem with ${b.get('rootfs')}`, 'Detected container architecture: amd64', 'Setting up SSH host keys'])
    },
  ],
  [
    'POST',
    /^\/nodes\/([\w-]+)\/qemu\/(\d+)\/clone$/,
    (m, b) => {
      guests.push({ vmid: Number(b.get('newid')), type: 'qemu', name: b.get('name')!, node: m[1], status: 'stopped', maxcpu: 2, maxmem: 2 * GiB, maxdisk: 3 * GiB, ip: GUEST_IP })
      return task(m[1], 'qmclone', 3000, ['create full clone of drive scsi0', 'transferred 3.0 GiB of 3.0 GiB (100.00%)'])
    },
  ],
  ['POST', /^\/nodes\/[\w-]+\/qemu\/\d+\/config$/, () => null],
  ['GET', /^\/nodes\/[\w-]+\/qemu\/\d+\/config$/, () => ({ net0: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0', scsi0: 'local-lvm:vm-disk-0,size=3G' })],
  ['PUT', /^\/nodes\/[\w-]+\/qemu\/\d+\/resize$/, () => null],
  [
    'POST',
    /^\/nodes\/([\w-]+)\/(qemu|lxc)\/(\d+)\/status\/(\w+)$/,
    (m) => {
      const g = guests.find((g) => g.vmid === Number(m[3]))!
      const action = m[4]
      g.status = action === 'start' || action === 'reboot' ? 'running' : 'stopped'
      if (action === 'start' || action === 'reboot') g.started = now()
      return task(m[1], `${m[2]}${action}`, 800)
    },
  ],
  ['GET', /^\/nodes\/[\w-]+\/(qemu|lxc)\/(\d+)\/status\/current$/, (m) => ({ status: guests.find((g) => g.vmid === Number(m[2]))?.status })],
  [
    'DELETE',
    /^\/nodes\/([\w-]+)\/(qemu|lxc)\/(\d+)$/,
    (m) => {
      guests.splice(guests.findIndex((g) => g.vmid === Number(m[3])), 1)
      return task(m[1], 'destroy', 800)
    },
  ],
  ['GET', /^\/nodes\/[\w-]+\/lxc\/(\d+)\/interfaces$/, (m) => {
    const g = guests.find((g) => g.vmid === Number(m[1]))
    return [{ name: 'lo', inet: '127.0.0.1/8' }, ...(g?.status === 'running' && g.ip ? [{ name: 'eth0', inet: `${g.ip}/24` }] : [])]
  }],
  ['GET', /^\/nodes\/[\w-]+\/qemu\/(\d+)\/agent\/network-get-interfaces$/, (m) => {
    const g = guests.find((g) => g.vmid === Number(m[1]))
    if (!g?.ip || g.status !== 'running') throw new Error('QEMU guest agent is not running')
    return { result: [{ name: 'eth0', 'ip-addresses': [{ 'ip-address': g.ip, 'ip-address-type': 'ipv4' }] }] }
  }],
  ['POST', /^\/nodes\/[\w-]+\/status$/, () => null],
  ['GET', /^\/nodes\/[\w-]+\/tasks\/([^/]+)\/status$/, (m) => {
    const t = tasks.get(decodeURIComponent(m[1]))
    return t && Date.now() < t.done ? { status: 'running' } : { status: 'stopped', exitstatus: 'OK' }
  }],
  ['GET', /^\/nodes\/[\w-]+\/tasks\/([^/]+)\/log$/, (m, q) => {
    const t = tasks.get(decodeURIComponent(m[1]))
    const start = Number(q.get('start') ?? 0)
    const lines = t && Date.now() >= t.done ? [...t.log, 'TASK OK'] : (t?.log.slice(0, 1) ?? [])
    return lines.slice(start).map((l, i) => ({ n: start + i + 1, t: l }))
  }],
]

createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url!, 'https://x')
  const send = (code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end('<html><head><title>pve1 - Proxmox Virtual Environment</title><script src="/pve2/js/pvemanagerlib.js?ver=8.4.1"></script></head></html>')
  }
  if (req.headers.authorization !== TOKEN) return send(401, { data: null, message: 'authentication failure' })
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const path = url.pathname.replace(/^\/api2\/json/, '')
    const params = req.method === 'GET' || req.method === 'DELETE' ? url.searchParams : new URLSearchParams(raw)
    for (const [method, re, fn] of routes) {
      const m = path.match(re)
      if (m && method === req.method) {
        try {
          return send(200, { data: fn(m, params) })
        } catch (err) {
          return send(500, { data: null, message: (err as Error).message })
        }
      }
    }
    send(501, { data: null, message: `mock: ${req.method} ${path} not implemented` })
  })
}).listen(PORT, () => console.log(`Mock Proxmox API on https://127.0.0.1:${PORT}  (token root@pam!proxmiu, secret "mock")`))
