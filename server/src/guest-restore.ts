import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ProxmoxClient } from './proxmox.js'
import { verifySetupGuest } from './ai-setup.js'
import { loadGuestBackups } from './guest-maintenance.js'

type Client = Pick<ProxmoxClient, 'get' | 'post'>
type Guest = { id: string; node: string; type: 'qemu' | 'lxc'; vmid: number }
const identifier = z.string().min(1).max(253).regex(/^[\w][\w.-]*$/)
const guestId = z.number().int().min(100).max(999_999_999)
export const restorePreviewSchema = z.object({
  archive: z.string().min(1).max(255).refine(s => !/[\\\u0000-\u001f\u007f]/.test(s)),
  sourceStorage: identifier,
  storage: identifier,
  vmid: guestId,
}).strict()
export const restoreExecuteSchema = z.object({ reviewId: z.string().uuid(), confirm: z.string().regex(/^[1-9]\d{2,8}$/) }).strict()
type Input = z.infer<typeof restorePreviewSchema>
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const one = (value: unknown) => value === 1 || value === '1' || value === true
const zero = (value: unknown) => value === 0 || value === '0' || value === false
const signature = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const unsafe = () => fail('This backup has an unsupported configuration or host dependency. Inspect and restore it through Proxmox instead.')

async function nodeReady(client: Client, guest: Guest) {
  await verifySetupGuest(client, guest)
  const nodes = await client.get<unknown>('/nodes')
  if (!Array.isArray(nodes) || !nodes.some(n => object(n) && n.node === guest.node && n.status === 'online')) throw fail('The backup node is not online. Refresh the connection before restoring.')
}

async function storageOptions(client: Client, guest: Guest) {
  const rows = await client.get<unknown>(`/nodes/${guest.node}/storage`, { enabled: 1, content: guest.type === 'qemu' ? 'images' : 'rootdir' })
  if (!Array.isArray(rows)) throw fail('Destination storage could not be verified.', 502)
  return rows.filter(s => object(s) && identifier.safeParse(s.storage).success && one(s.active) && !zero(s.enabled) && typeof s.content === 'string' && s.content.split(',').map(v => v.trim()).includes(guest.type === 'qemu' ? 'images' : 'rootdir')).map(s => (s as { storage: string }).storage).sort()
}

export async function loadRestoreOptions(client: Client, guest: Guest) {
  try {
    await nodeReady(client, guest)
    const storages = await storageOptions(client, guest)
    const next = await client.get<unknown>('/cluster/nextid')
    const suggestedVmid = guestId.parse(typeof next === 'string' && /^\d+$/.test(next) ? Number(next) : next)
    return { storages, suggestedVmid }
  } catch {
    throw fail('Restore destinations could not load. Check the node and VM.Audit, Sys.Audit and Datastore.Audit access, then refresh.', 502)
  }
}

function archiveType(archive: string, format: string | undefined, guest: Guest) {
  const suffix = archive.slice(archive.indexOf(':') + 1)
  const pbs = /^backup\/(vm|ct)\/([1-9]\d*)\/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.exec(suffix)
  if (pbs) return Number(pbs[2]) === guest.vmid && pbs[1] === (guest.type === 'qemu' ? 'vm' : 'ct') && format === (guest.type === 'qemu' ? 'pbs-vm' : 'pbs-ct')
  const file = /^backup\/vzdump-(qemu|lxc)-([1-9]\d*)-\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2}\.(vma|tar)(?:\.(zst|gz|lzo))?$/.exec(suffix)
  if (!file || file[1] !== guest.type || Number(file[2]) !== guest.vmid || file[3] !== (guest.type === 'qemu' ? 'vma' : 'tar')) return false
  return format === file[3] || format === `${file[3]}${file[4] ? '.' + file[4] : ''}`
}

// Only inspect locally; descriptions, keys and other archived values never enter reviews.
async function checkedConfig(client: Client, guest: Guest, archive: string) {
  const raw = await client.get<unknown>(`/nodes/${guest.node}/vzdump/extractconfig`, { volume: archive })
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 256_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) throw unsafe()
  const config = new Map<string, string>()
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const match = /^([a-z][a-z0-9_.-]*):[ \t]*(.*)$/.exec(line)
    if (!match || config.has(match[1])) throw unsafe()
    config.set(match[1], match[2])
  }
  if (!config.size) throw unsafe()
  const bridges = new Set<string>()
  for (const [key, value] of config) {
    if (/^(?:hookscript|args|affinity|numa\d+|hostpci\d+|usb\d+|parallel\d+|virtiofs\d+|ivshmem|shmem|rng\d+|unused\d+|vmstate|cicustom|dev\d+|lxc\..*|mp\d+)$/.test(key)) throw unsafe()
    if (/^serial\d+$/.test(key) && value !== 'socket') throw unsafe()
    if (/^net\d+$/.test(key)) {
      const bridge = value.split(',').filter(v => v.startsWith('bridge='))
      if (bridge.length > 1) throw unsafe()
      if (bridge.length) {
        const name = bridge[0].slice(7)
        if (!identifier.safeParse(name).success) throw unsafe()
        bridges.add(name)
      }
    }
    if (/^(?:ide|sata|scsi|virtio)\d+$|^(?:efidisk|tpmstate)\d+$/.test(key)) {
      if (value === 'none,media=cdrom') continue
      if (!/^[\w][\w.-]*:[^,\s/][^,\s]*/.test(value) || /(?:^|,)(?:backup=0|media=cdrom)(?:,|$)|cloudinit/.test(value)) throw unsafe()
    }
  }
  if (guest.type === 'lxc') {
    if (config.get('unprivileged') !== '1' || !/^[\w][\w.-]*:[^,\s/][^,\s]*/.test(config.get('rootfs') ?? '')) throw unsafe()
    if (config.has('features') && config.get('features') !== 'nesting=1') throw unsafe()
  }
  if (bridges.size) {
    const networks = await client.get<unknown>(`/nodes/${guest.node}/network`)
    if (!Array.isArray(networks) || [...bridges].some(bridge => !networks.some(n => object(n) && n.iface === bridge && (n.type === 'bridge' || n.type === 'OVSBridge') && one(n.active)))) throw unsafe()
  }
  return signature(raw)
}

async function inspect(client: Client, guest: Guest, input: Input) {
  await nodeReady(client, guest)
  if (input.vmid === guest.vmid) throw fail('Choose a new guest ID. Overwriting an existing guest is not supported here.')
  const inventory = await loadGuestBackups(client, guest, input.sourceStorage)
  const matches = inventory.backups.filter(b => b.volid === input.archive)
  if (inventory.errors.length || matches.length !== 1 || !archiveType(input.archive, matches[0].format, guest)) throw fail('This archive is unavailable, ambiguous or does not match this guest type. Refresh the backup inventory.')
  const backup = matches[0]
  const config = await checkedConfig(client, guest, input.archive)
  const storages = await storageOptions(client, guest)
  if (!storages.includes(input.storage)) throw fail('Choose an active destination storage for this guest type.')
  let unused: unknown
  try { unused = await client.get<unknown>('/cluster/nextid', { vmid: input.vmid }) }
  catch { throw fail('The new guest ID is already in use or could not be verified cluster-wide. Choose an unused ID.') }
  if (String(unused) !== String(input.vmid)) throw fail('Proxmox did not confirm that this guest ID is unused.')
  return { backup, fingerprint: signature({ guest, input, backup, config }) }
}

interface Review {
  reviewId: string
  archive: string
  sourceStorage: string
  storage: string
  vmid: number
  node: string
  type: 'qemu' | 'lxc'
  ctime?: number
  size?: number
  expiresAt: number
}
interface Result { upid: string; node: string; vmid: number; type: 'qemu' | 'lxc' }
interface Entry { view: Review; guest: Guest; revision: string; input: Input; fingerprint: string; state: 'ready' | 'consumed'; result?: Result }

export class RestoreReviews {
  private entries = new Map<string, Entry>()
  constructor(private clock: () => number = Date.now) {}

  async preview(client: Client, guest: Guest, revision: string, value: unknown): Promise<Review> {
    const input = restorePreviewSchema.parse(value)
    let checked: Awaited<ReturnType<typeof inspect>>
    try { checked = await inspect(client, guest, input) }
    catch (error) {
      if ((error as { statusCode?: number })?.statusCode === 409) throw error
      throw fail('The backup review could not be verified. Check source backup, network and destination permissions, then refresh.', 502)
    }
    const now = this.clock()
    for (const [key, entry] of this.entries) if (entry.view.expiresAt <= now) this.entries.delete(key)
    if (this.entries.size >= 500) throw fail('Too many open restore reviews. Close old reviews and try again later.', 429)
    const view: Review = { reviewId: randomUUID(), ...input, node: guest.node, type: guest.type, ctime: checked.backup.ctime, size: checked.backup.size, expiresAt: now + 5 * 60_000 }
    this.entries.set(view.reviewId, { view, input, guest: { ...guest }, revision, fingerprint: checked.fingerprint, state: 'ready' })
    return view
  }

  async execute(client: Client, guest: Guest, revision: string | (() => string), value: unknown): Promise<Result> {
    const input = restoreExecuteSchema.parse(value)
    const entry = this.entries.get(input.reviewId)
    if (!entry || entry.view.expiresAt <= this.clock() || signature(entry.guest) !== signature(guest)) throw fail('This restore review expired or is unavailable. Review the backup again.')
    if (input.confirm !== String(entry.input.vmid)) throw fail('Type the new guest ID exactly before restoring.')
    const currentRevision = () => typeof revision === 'function' ? revision() : revision
    if (entry.revision !== currentRevision()) {
      entry.state = 'consumed'
      throw fail('Connection settings changed. Review the backup again.')
    }
    if (entry.result) return entry.result
    if (entry.state !== 'ready') throw fail('This review was already submitted. Inspect the new guest ID and Proxmox task history before attempting another restore.')
    // Claim synchronously before the first await; errors cannot make this review replayable.
    entry.state = 'consumed'
    let checked: Awaited<ReturnType<typeof inspect>>
    try { checked = await inspect(client, guest, entry.input) }
    catch { throw fail('Restore checks changed or could not be completed. No restore was submitted. Review the backup again.') }
    if (checked.fingerprint !== entry.fingerprint) throw fail('The backup changed after review. No restore was submitted. Review it again.')
    if (entry.view.expiresAt <= this.clock() || entry.revision !== currentRevision()) throw fail('The restore review expired or connection settings changed during checks. No restore was submitted. Review again.')
    const body = {
      vmid: entry.input.vmid, storage: entry.input.storage, force: 0, unique: 1, start: 0, onboot: 0,
      ...(guest.type === 'qemu' ? { archive: entry.input.archive } : { ostemplate: entry.input.archive, restore: 1 }),
    }
    const uncertain = () => fail('Restore acceptance is unknown. Inspect Proxmox task history and guest ' + entry.input.vmid + ' before attempting another restore. No automatic retry or cleanup was performed.', 502)
    let upid: unknown
    try { upid = await client.post(`/nodes/${guest.node}/${guest.type}`, body) }
    catch { throw uncertain() }
    if (typeof upid !== 'string' || upid.length > 1024) throw uncertain()
    const parts = upid.split(':')
    if (parts.length !== 9 || parts[0] !== 'UPID' || parts[1] !== guest.node || !/^[0-9a-f]{8}$/i.test(parts[2]) || !/^[0-9a-f]{8,16}$/i.test(parts[3]) || !/^[0-9a-f]{8}$/i.test(parts[4]) || parts[5] !== (guest.type === 'qemu' ? 'qmrestore' : 'vzrestore') || parts[6] !== String(entry.input.vmid) || !/^[^:\s/\u0000-\u001f\u007f-\u009f]{1,255}$/u.test(parts[7]) || parts[8] !== '') throw uncertain()
    entry.result = { upid, node: guest.node, type: guest.type, vmid: entry.input.vmid }
    return entry.result
  }
}
