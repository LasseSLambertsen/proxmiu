import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { verifySetupGuest } from './ai-setup.js'
import type { ProxmoxClient } from './proxmox.js'
import { normalizeNativeTask, taskMatchesGuest } from './task-history.js'

const GiB = 1024 ** 3
const maxGiB = 65536
const identifier = /^[\w][\w.-]{0,252}$/
const failure = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const one = (v: unknown) => v === 1 || v === '1' || v === true
const zero = (v: unknown) => v === 0 || v === '0' || v === false
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function integer(v: unknown): number | null {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+$/.test(v))) return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}
type Guest = { id: string; node: string; type: 'qemu' | 'lxc'; vmid: number }
type Client = Pick<ProxmoxClient, 'get' | 'put'>
export const diskGrowthPreviewSchema = z.object({ disk: z.string().min(1).max(32).regex(/^[a-z][a-z0-9]*$/), targetGiB: z.number().int().min(1).max(maxGiB) }).strict()
export const diskGrowthExecuteSchema = z.object({ reviewId: z.string().uuid(), confirm: z.string().min(1).max(253).refine(s => !/[\u0000-\u001f\u007f]/.test(s)) }).strict()
interface Disk {
  disk: string
  volume: string | null
  storage: string | null
  sizeBytes: number | null
  format: string | null
  availableBytes: number | null
  canGrow: boolean
  reason?: string
}
interface Inventory { name: string; ready: boolean; reason?: string; errors: string[]; disks: Disk[] }
interface InternalDisk { view: Disk; raw: string; backend?: string; owner?: number }
interface Inspection { view: Inventory; digest: string; disks: Map<string, InternalDisk> }

function diskKey(key: string, type: Guest['type']) {
  if (type === 'lxc') return key === 'rootfs' || /^mp(?:0|[1-9]\d*)$/.test(key) && Number(key.slice(2)) <= 255
  const match = /^(ide|sata|scsi|virtio)(0|[1-9]\d*)$/.exec(key)
  return !!match && Number(match[2]) <= ({ ide: 3, sata: 5, scsi: 30, virtio: 15 }[match[1] as 'ide' | 'sata' | 'scsi' | 'virtio'])
}
function property(raw: unknown, type: Guest['type']): { volume?: string; storage?: string; reason?: string } {
  if (typeof raw !== 'string' || raw.length > 8192 || /[\u0000-\u001f\u007f]/.test(raw)) return { reason: 'This disk configuration could not be verified.' }
  const options = new Map<string, string>()
  let implicit: string | undefined
  for (const [index, token] of raw.split(',').map(t => t.trim()).entries()) {
    const equal = token.indexOf('=')
    if (equal === -1) {
      if (index !== 0 || !token) return { reason: 'This disk configuration is ambiguous.' }
      implicit = token
    } else {
      const key = token.slice(0, equal)
      if (!/^[a-z][a-z0-9_-]*$/.test(key) || options.has(key)) return { reason: 'This disk configuration is ambiguous.' }
      options.set(key, token.slice(equal + 1))
    }
  }
  const explicit = options.get(type === 'qemu' ? 'file' : 'volume')
  if (implicit && explicit) return { reason: 'This disk configuration is ambiguous.' }
  const volume = implicit ?? explicit
  if (!volume || !/^[\w][\w.-]*:[^\s\\:,]+$/.test(volume)) return { reason: 'Host devices, bind mounts and unmanaged disks are outside this editor.' }
  const storage = volume.slice(0, volume.indexOf(':'))
  if (!identifier.test(storage)) return { reason: 'This storage identity could not be verified.' }
  if (options.get('media') && options.get('media') !== 'disk' || volume.includes('cloudinit')) return { volume, storage, reason: 'Optical media and cloud-init devices are outside this editor.' }
  if (['ro', 'readonly', 'shared', 'scsiblock'].some(key => options.has(key) && !zero(options.get(key)))) return { volume, storage, reason: 'Read-only, shared and passthrough disks are outside this editor.' }
  return { volume, storage }
}
function supported(type: Guest['type'], backend: string, format: string) {
  if (type === 'qemu') return backend === 'dir' ? ['raw', 'qcow2'].includes(format) : ['lvm', 'lvmthin', 'zfspool'].includes(backend) && format === 'raw'
  return backend === 'zfspool' ? ['raw', 'subvol'].includes(format) : ['dir', 'lvm', 'lvmthin'].includes(backend) && format === 'raw'
}

function verifiedFinishedTask(row: unknown, guest: Guest) {
  const task = normalizeNativeTask(row, guest.node)
  return !!task && task.vmid === guest.vmid && task.endtime !== undefined && task.starttime === Number.parseInt(task.upid.split(':')[4], 16) && ['success', 'warning', 'error'].includes(task.state)
}

async function inspect(client: Client, guest: Guest): Promise<Inspection> {
  let resource: Record<string, unknown>
  try { resource = await verifySetupGuest(client, guest) }
  catch { throw failure('This guest could not be verified at its current node. Refresh the inventory before growing a disk.', 409) }
  const nodePath = `/nodes/${guest.node}`
  let permissions: unknown
  try { permissions = await client.get('/access/permissions', { path: nodePath }) } catch { /* Unknown task visibility remains read-only. */ }
  const nodeRights = record(permissions) ? permissions[nodePath] : undefined
  // The native value is an ACL propagation flag: both 0 and 1 grant at this path.
  const canAuditTasks = record(nodeRights) && Object.hasOwn(nodeRights, 'Sys.Audit') && (nodeRights['Sys.Audit'] === 0 || nodeRights['Sys.Audit'] === 1)
  const base = `/nodes/${guest.node}/${guest.type}/${guest.vmid}`
  const requests = await Promise.allSettled([
    client.get<unknown>(`${base}/config`, { current: 1 }), client.get<unknown>(`${base}/status/current`),
    client.get<unknown>(`${base}/pending`), client.get<unknown>(`${base}/snapshot`),
    client.get<unknown>('/nodes'), client.get<unknown>(`/nodes/${guest.node}/storage`, { enabled: 1, content: guest.type === 'qemu' ? 'images' : 'rootdir' }),
    client.get<unknown>(`/nodes/${guest.node}/tasks`, { source: 'active', vmid: guest.vmid, limit: 500 }),
  ])
  const value = (i: number) => requests[i].status === 'fulfilled' ? (requests[i] as PromiseFulfilledResult<unknown>).value : undefined
  const config = value(0), status = value(1), pending = value(2), snapshots = value(3), nodes = value(4), storages = value(5), tasks = value(6)
  if (!record(config)) throw failure('Disk configuration could not load. Check the connection and VM.Audit permission, then refresh.', 502)
  const nameValue = config[guest.type === 'qemu' ? 'name' : 'hostname'] ?? resource.name
  const name = typeof nameValue === 'string' && nameValue.length > 0 && nameValue.length <= 253 && !/[\u0000-\u001f\u007f]/.test(nameValue) ? nameValue : String(guest.vmid)
  const digest = typeof config.digest === 'string' && /^[a-f0-9]{40}$/i.test(config.digest) ? config.digest : ''
  const errors = requests.flatMap((r, i) => r.status === 'rejected' ? [`${['Configuration', 'Guest status', 'Pending changes', 'Snapshots', 'Node status', 'Storage', 'Active tasks'][i]} could not be read safely. Check Proxmox permissions and refresh.`] : [])
  const sourceNode = Array.isArray(nodes) ? nodes.filter(n => record(n) && n.node === guest.node) : []
  const online = sourceNode.length === 1 && sourceNode[0].status === 'online'
  let reason: string | undefined
  if (!record(status) || status.status !== 'stopped' || resource.status !== 'stopped') reason = 'Shut down this guest before reviewing disk growth. Proxmiu never stops it automatically.'
  else if (!digest) reason = 'A valid configuration digest is required before disk growth.'
  else if (config.lock !== undefined || one(config.template)) reason = 'This guest is locked or a template. Inspect its current configuration in Proxmox.'
  else if (!Array.isArray(pending) || pending.length > 4096 || pending.some(r => !record(r) || typeof r.key !== 'string')) reason = 'Pending changes could not be verified. Refresh before growing a disk.'
  else if (pending.some(r => r.pending !== undefined || r.delete !== undefined && !zero(r.delete))) reason = 'Resolve pending changes in Proxmox before growing a disk.'
  else if (!Array.isArray(snapshots) || snapshots.some(r => !record(r) || typeof r.name !== 'string')) reason = 'Snapshots could not be verified. Refresh before growing a disk.'
  else if (snapshots.some(r => r.name !== 'current')) reason = 'This first disk editor does not grow disks on guests with snapshots. Use Proxmox for this configuration.'
  else if (!record(status.ha) || !one(status.ha.managed) && !zero(status.ha.managed)) reason = 'High-availability state could not be verified. Refresh before reviewing disk growth.'
  else if (one(status.ha.managed)) reason = 'HA-managed guests are outside this stopped-guest disk editor.'
  else if (!online) reason = 'The guest node is offline or could not be verified.'
  else if (!Array.isArray(storages)) reason = 'Destination storage state could not be verified.'
  else if (!canAuditTasks) reason = 'Sys.Audit on this node is required to verify complete guest task visibility.'
  else if (!Array.isArray(tasks) || tasks.length >= 500) reason = 'Active guest tasks could not be verified.'
  else if (tasks.some(row => !verifiedFinishedTask(row, guest))) reason = 'A native guest task is active or unconfirmed. Inspect task history and wait before reviewing disk growth.'
  if (!reason && errors.length) reason = 'Some disk safety checks are unavailable. Refresh before reviewing disk growth.'

  const keys = Object.keys(config).filter(k => diskKey(k, guest.type)).sort((a, b) => a === 'rootfs' ? -1 : b === 'rootfs' ? 1 : a.localeCompare(b, 'en', { numeric: true }))
  // Special/unused volumes stay unselectable, but can alias an ordinary slot.
  const references = Object.keys(config).filter(key => guest.type === 'qemu' ? /^(?:(?:ide|sata|scsi|virtio|efidisk|tpmstate|unused)\d+|vmstate)$/.test(key) : /^(?:rootfs|(?:mp|unused)\d+)$/.test(key))
  const parsed = new Map(references.map(key => [key, property(config[key], guest.type)]))
  const counts = new Map<string, number>()
  for (const p of parsed.values()) if (p.volume) counts.set(p.volume, (counts.get(p.volume) ?? 0) + 1)
  const content = new Map<string, Promise<unknown>>()
  const disks = new Array<InternalDisk>(keys.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, keys.length) }, async () => {
    while (next < keys.length) {
      const index = next++, disk = keys[index], p = parsed.get(disk)!
      const view: Disk = { disk, volume: p.volume ?? null, storage: p.storage ?? null, sizeBytes: null, format: null, availableBytes: null, canGrow: false }
      const entry: InternalDisk = { view, raw: typeof config[disk] === 'string' ? config[disk] : '' }
      disks[index] = entry
      if (p.reason) { view.reason = p.reason; continue }
      if (counts.get(p.volume!) !== 1) { view.reason = 'This volume is attached more than once. Inspect it in Proxmox.'; continue }
      const candidates = Array.isArray(storages) ? storages.filter(s => record(s) && s.storage === p.storage) : []
      const storage = candidates.length === 1 && record(candidates[0]) ? candidates[0] : undefined
      const expectedContent = guest.type === 'qemu' ? 'images' : 'rootdir'
      if (!online || !storage || !one(storage.active) || storage.enabled !== undefined && !one(storage.enabled) || storage.disabled !== undefined && !zero(storage.disabled) || typeof storage.content !== 'string' || !storage.content.split(',').map(s => s.trim()).includes(expectedContent)) { view.reason = 'The disk storage is unavailable or its content type could not be verified.'; continue }
      view.availableBytes = integer(storage.avail)
      const backend = storage.type
      if (typeof backend !== 'string' || !['dir', 'lvm', 'lvmthin', 'zfspool'].includes(backend)) { view.reason = 'This storage backend is outside the initial disk-growth editor.'; continue }
      try {
        if (!content.has(p.storage!)) content.set(p.storage!, client.get(`/nodes/${guest.node}/storage/${p.storage}/content`, { content: expectedContent, vmid: guest.vmid }))
        const rows = await content.get(p.storage!)
        const volumes = Array.isArray(rows) ? rows.filter(r => record(r) && r.volid === p.volume) : []
        const volume = volumes.length === 1 && record(volumes[0]) ? volumes[0] : undefined
        if (!volume || integer(volume.vmid) !== guest.vmid || volume.parent || volume.content !== undefined && volume.content !== expectedContent) { view.reason = 'Disk ownership or a linked-parent volume could not be verified.'; continue }
        const attributes = await client.get<unknown>(`/nodes/${guest.node}/storage/${p.storage}/content/${encodeURIComponent(p.volume!)}`)
        const bytes = record(attributes) ? integer(attributes.size) : null
        const format = record(attributes) ? attributes.format : undefined
        if (!bytes || bytes >= maxGiB * GiB || typeof format !== 'string' || format !== volume.format || !supported(guest.type, backend, format)) { view.reason = 'Capacity, format or quota is outside this editor’s supported range.'; continue }
        view.sizeBytes = bytes; view.format = format; view.canGrow = !reason
        entry.backend = backend; entry.owner = guest.vmid
      } catch { view.reason = 'Disk capacity or ownership could not load. Check VM.Config.Disk and Datastore.Audit access, then refresh.' }
    }
  }))
  return { digest, disks: new Map(disks.map(d => [d.view.disk, d])), view: { name, ready: !reason, ...(reason ? { reason } : {}), errors, disks: disks.map(d => d.view) } }
}

export async function loadDiskInventory(client: Client, guest: Guest): Promise<Inventory> {
  return (await inspect(client, guest)).view
}
interface Review {
  reviewId: string; node: string; type: Guest['type']; vmid: number; name: string
  disk: string; volume: string; storage: string; format: string
  currentBytes: number; targetGiB: number; targetBytes: number; deltaBytes: number
  availableBytes: number | null; shortfall: boolean; expiresAt: number
}
interface Result { node: string; type: Guest['type']; vmid: number; upid: string }
interface Entry { view: Review; guest: Guest; revision: string; fingerprint: string; state: 'ready' | 'consumed'; result?: Result }
function selected(inspection: Inspection, guest: Guest, input: z.infer<typeof diskGrowthPreviewSchema>) {
  const entry = inspection.disks.get(input.disk), disk = entry?.view
  if (!inspection.view.ready || !entry || !disk?.canGrow || !disk.volume || !disk.storage || !disk.format || !disk.sizeBytes) throw failure(inspection.view.reason ?? disk?.reason ?? 'Choose an eligible ordinary disk and refresh its capacity.')
  const targetBytes = input.targetGiB * GiB
  if (!Number.isSafeInteger(targetBytes) || targetBytes <= disk.sizeBytes) throw failure('Choose an absolute capacity larger than the disk’s actual current size. Shrinking is not supported.')
  const deltaBytes = targetBytes - disk.sizeBytes, shortfall = disk.availableBytes !== null && deltaBytes > disk.availableBytes
  const fingerprint = hash({ guest, name: inspection.view.name, digest: inspection.digest, disk: input.disk, raw: entry.raw, volume: disk.volume, owner: entry.owner, backend: entry.backend, format: disk.format, currentBytes: disk.sizeBytes, targetBytes, availabilityKnown: disk.availableBytes !== null, shortfall })
  return { disk, fingerprint, targetBytes, deltaBytes, shortfall }
}

export class DiskGrowthReviews {
  private entries = new Map<string, Entry>()
  private active = new Set<string>()
  constructor(private clock: () => number = Date.now) {}
  private key(guest: Guest) { return JSON.stringify([guest.id, guest.type, guest.vmid]) }

  async preview(client: Client, guest: Guest, revision: string, value: unknown): Promise<Review> {
    const input = diskGrowthPreviewSchema.parse(value)
    if (this.active.has(this.key(guest))) throw failure('Disk growth is being submitted for this guest. Inspect its task before reviewing another change.')
    const inspection = await inspect(client, guest)
    const checked = selected(inspection, guest, input)
    const now = this.clock()
    for (const [id, entry] of this.entries) if (entry.view.expiresAt <= now) this.entries.delete(id)
    if (this.entries.size >= 500) throw failure('Too many open disk reviews. Wait for older reviews to expire.', 429)
    const view: Review = { reviewId: randomUUID(), node: guest.node, type: guest.type, vmid: guest.vmid, name: inspection.view.name, disk: input.disk, volume: checked.disk.volume!, storage: checked.disk.storage!, format: checked.disk.format!, currentBytes: checked.disk.sizeBytes!, targetGiB: input.targetGiB, targetBytes: checked.targetBytes, deltaBytes: checked.deltaBytes, availableBytes: checked.disk.availableBytes, shortfall: checked.shortfall, expiresAt: now + 300000 }
    this.entries.set(view.reviewId, { view, guest: { ...guest }, revision, fingerprint: checked.fingerprint, state: 'ready' })
    return view
  }

  async execute(client: Client, guest: Guest, revision: string | (() => string), value: unknown): Promise<Result> {
    const input = diskGrowthExecuteSchema.parse(value), entry = this.entries.get(input.reviewId)
    if (!entry || entry.view.expiresAt <= this.clock() || hash(entry.guest) !== hash(guest)) throw failure('This disk review expired or is unavailable. Refresh and review again.')
    if (input.confirm !== entry.view.name) throw failure('Type the reviewed guest name exactly before growing this disk.')
    const currentRevision = () => typeof revision === 'function' ? revision() : revision
    if (entry.revision !== currentRevision()) { entry.state = 'consumed'; throw failure('Connection settings changed. Review the disk again.') }
    if (entry.result) return entry.result
    if (entry.state !== 'ready') throw failure('This disk review was already submitted. Inspect task history and actual capacity before another review.')
    entry.state = 'consumed'
    const key = this.key(guest)
    if (this.active.has(key)) throw failure('Another disk growth request is being submitted for this guest. Inspect task history first.')
    this.active.add(key)
    try {
      let inspection: Inspection, checked: ReturnType<typeof selected>
      try { inspection = await inspect(client, guest); checked = selected(inspection, guest, { disk: entry.view.disk, targetGiB: entry.view.targetGiB }) }
      catch { throw failure('Disk checks changed or are unavailable. No resize was submitted. Your target is kept; refresh and review again.') }
      if (checked.fingerprint !== entry.fingerprint || entry.view.expiresAt <= this.clock() || entry.revision !== currentRevision()) throw failure('The reviewed disk, configuration or connection changed. No resize was submitted. Refresh and review again.')
      const uncertain = () => failure('Disk growth acceptance is unknown. Inspect Proxmox task history and actual disk capacity before another review. No automatic retry or cleanup was performed.', 502)
      let upid: unknown
      try { upid = await client.put(`/nodes/${guest.node}/${guest.type}/${guest.vmid}/resize`, { disk: entry.view.disk, size: `${entry.view.targetGiB}G`, digest: inspection.digest }) }
      catch { throw uncertain() }
      if (!taskMatchesGuest(upid, guest.node, 'resize', guest.vmid)) throw uncertain()
      entry.result = { node: guest.node, type: guest.type, vmid: guest.vmid, upid }
      return entry.result
    } finally { this.active.delete(key) }
  }
}
