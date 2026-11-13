import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { verifySetupGuest } from './ai-setup.js'
import { readNicProperty } from './guest-nic-link.js'
import type { ProxmoxClient } from './proxmox.js'
import { normalizeNativeTask } from './task-history.js'

type Guest = { id: string; node: string; type: 'qemu' | 'lxc'; vmid: number }
type Client = Pick<ProxmoxClient, 'get' | 'put'>
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const zero = (v: unknown) => v === 0 || v === '0' || v === false
const bool = (v: string | undefined) => v === undefined || /^(?:0|off|no|false)$/i.test(v) ? false : /^(?:1|on|yes|true)$/i.test(v) ? true : undefined
function stable(v: unknown): unknown { return Array.isArray(v) ? v.map(stable) : record(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, stable(value)])) : v }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v)) ?? 'null').digest('hex')
const deviceKey = /^[a-z]+(?:0|[1-9]\d*)$/
export const bootOrderPreviewSchema = z.object({ sourceIdentity: z.string().regex(/^[a-f0-9]{64}$/), order: z.array(z.string().max(16).regex(deviceKey)).min(2).max(89) }).strict()
export const bootOrderExecuteSchema = z.object({ reviewId: z.string().uuid(), confirm: z.string().min(1).max(253).refine(s => !/[\u0000-\u001f\u007f]/.test(s)) }).strict()

interface BootDevice { id: string; kind: 'disk' | 'cdrom' | 'network' | 'unsupported'; label: string; identity: string; warning?: string }
interface Inventory { name: string; ready: boolean; reason?: string; errors: string[]; sourceIdentity: string | null; order: BootDevice[]; excluded: { id: string; reason: string }[] }
interface Inspection { view: Inventory; digest: string; config: Record<string, unknown>; untouched: string }
interface Review { reviewId: string; name: string; node: string; type: 'qemu'; vmid: number; sourceIdentity: string; currentOrder: BootDevice[]; proposedOrder: BootDevice[]; expiresAt: number }
interface Result { verified: true; name: string; node: string; type: 'qemu'; vmid: number; sourceIdentity: string; order: BootDevice[]; observedAt: number }

function driveKey(key: string) {
  const match = /^(ide|sata|scsi|virtio)(0|[1-9]\d*)$/.exec(key)
  return !!match && Number(match[2]) <= ({ ide: 3, sata: 5, scsi: 30, virtio: 15 }[match[1] as 'ide' | 'sata' | 'scsi' | 'virtio'])
}
function properties(raw: unknown): { file: string; options: Map<string, string> } | undefined {
  if (typeof raw !== 'string' || !raw || raw.length > 8192 || /[\u0000-\u001f\u007f"'\\]/.test(raw)) return
  const options = new Map<string, string>()
  let implicit: string | undefined
  for (const [index, token] of raw.split(',').entries()) {
    if (token !== token.trim() || !token) return
    const equal = token.indexOf('=')
    if (equal === -1) { if (index !== 0) return; implicit = token }
    else {
      const key = token.slice(0, equal), value = token.slice(equal + 1)
      if (!/^[a-z][a-z0-9_-]*$/.test(key) || !value || options.has(key)) return
      options.set(key, value)
    }
  }
  if (implicit && options.has('file')) return
  const file = implicit ?? options.get('file')
  return file ? { file, options } : undefined
}
const storageReference = (file: string) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*:[^\s,:\\]+$/.test(file)
const cloudinit = (file: string) => /[:/](?:vm-\d+-)?cloudinit(?:\.(?:raw|qcow|qcow2|qed|vmdk|cloop))?$/.test(file)
function describe(id: string, config: Record<string, unknown>): BootDevice {
  const raw = config[id], identity = hash({ id, raw }), unsupported: BootDevice = { id, kind: 'unsupported', label: 'Unsupported or missing configured boot target', identity }
  if (/^net(?:[0-9]|[12][0-9]|3[01])$/.test(id)) {
    const nic = readNicProperty(id, raw, 'qemu').view
    if (!nic.canEdit) return unsupported
    return { id, kind: 'network', label: `${nic.model} · ${nic.mac} · ${nic.bridge}${nic.tag === null ? '' : ` · VLAN ${nic.tag}`}`, identity, ...(nic.linkDown ? { warning: 'This NIC is configured disconnected; PXE reachability is not established.' } : {}) }
  }
  if (!driveKey(id)) return unsupported
  const parsed = properties(raw)
  if (!parsed || !storageReference(parsed.file) || cloudinit(parsed.file) || bool(parsed.options.get('scsiblock')) !== false) return unsupported
  const media = parsed.options.get('media')
  if (media === 'cdrom') return /:iso\/[^\s/]+\.iso$/i.test(parsed.file) ? { id, kind: 'cdrom', label: parsed.file, identity } : unsupported
  if (media !== undefined && media !== 'disk') return unsupported
  return { id, kind: 'disk', label: parsed.file, identity }
}
function unusedAlias(config: Record<string, unknown>) {
  const unused = Object.entries(config).filter(([key]) => /^unused\d+$/.test(key))
  if (!unused.length) return false
  const files = Object.keys(config).filter(key => driveKey(key) || /^(?:efidisk|tpmstate)\d+$/.test(key)).map(key => properties(config[key])?.file)
  // An excluded drive still participates in native unused-reference cleanup.
  if (files.some(file => !file)) return true
  const attached = new Set(files)
  return unused.some(([, value]) => typeof value !== 'string' || !storageReference(value) || attached.has(value))
}
const relevant = (key: string) => /^[a-z]+\d+$/.test(key) || ['boot', 'bootdisk', 'bios', 'machine', 'scsihw', 'onboot', 'startup', 'hookscript', 'args'].includes(key)
async function inspect(client: Client, guest: Guest): Promise<Inspection> {
  if (guest.type !== 'qemu') throw fail('Boot-device order is available for QEMU VMs only.', 400)
  let resource: Record<string, unknown>
  try { resource = await verifySetupGuest(client, guest) } catch { throw fail('This VM could not be verified at its original node. Refresh the guest inventory.') }
  const nodePath = `/nodes/${guest.node}`, base = `${nodePath}/qemu/${guest.vmid}`
  let permissions: unknown
  try { permissions = await client.get('/access/permissions', { path: nodePath }) } catch { /* Keep incomplete task visibility read-only. */ }
  const rights = record(permissions) ? permissions[nodePath] : undefined
  const audit = record(rights) && Object.hasOwn(rights, 'Sys.Audit') && (rights['Sys.Audit'] === 0 || rights['Sys.Audit'] === 1)
  const requests = await Promise.allSettled([client.get<unknown>(`${base}/config`, { current: 1 }), client.get<unknown>(`${base}/status/current`), client.get<unknown>(`${base}/pending`), client.get<unknown>(`${base}/snapshot`), client.get<unknown>('/nodes'), client.get<unknown>(`${nodePath}/tasks`, { source: 'active', vmid: guest.vmid, limit: 500 })])
  const value = (index: number) => requests[index].status === 'fulfilled' ? (requests[index] as PromiseFulfilledResult<unknown>).value : undefined
  const config = value(0), status = value(1), pending = value(2), snapshots = value(3), nodes = value(4), tasks = value(5)
  if (!record(config)) throw fail('Current boot configuration could not be read. Check the connection and VM.Audit permission, then refresh.', 502)
  const nameValue = config.name ?? resource.name
  const name = typeof nameValue === 'string' && nameValue.length > 0 && nameValue.length <= 253 && !/[\u0000-\u001f\u007f]/.test(nameValue) ? nameValue : String(guest.vmid)
  const digest = typeof config.digest === 'string' && /^[a-f0-9]{40}$/i.test(config.digest) ? config.digest : ''
  const errors = requests.flatMap((r, index) => r.status === 'rejected' ? [`${['Configuration', 'VM status', 'Pending changes', 'Snapshots', 'Node status', 'Active tasks'][index]} could not be read safely. Check permissions and refresh.`] : [])
  const matchingNodes = Array.isArray(nodes) ? nodes.filter(n => record(n) && n.node === guest.node) : []
  let reason: string | undefined
  if (!record(status) || status.status !== 'stopped' || resource.status !== 'stopped') reason = 'Shut down this VM before reviewing boot order. Proxmiu does not stop it automatically.'
  else if (!digest) reason = 'A valid configuration digest is required before editing boot order.'
  else if (config.lock !== undefined || config.template !== undefined && !zero(config.template) || resource.template !== undefined && !zero(resource.template)) reason = 'This VM is locked, a template or its template state is unverified.'
  else if (!Array.isArray(pending) || pending.length > 4096 || pending.some(r => !record(r) || typeof r.key !== 'string' || r.pending !== undefined || r.delete !== undefined && !zero(r.delete))) reason = 'Resolve pending or unreadable configuration changes before reviewing boot order.'
  else if (!Array.isArray(snapshots) || snapshots.some(r => !record(r) || typeof r.name !== 'string' || r.name !== 'current')) reason = 'VMs with snapshots or unreadable snapshot state are outside this first boot editor.'
  else if (!record(status.ha) || !zero(status.ha.managed)) reason = 'HA-managed VMs or unverified HA state are outside this stopped-VM editor.'
  else if (matchingNodes.length !== 1 || matchingNodes[0].status !== 'online') reason = 'The original node is offline or could not be verified.'
  else if (!audit) reason = 'Sys.Audit on this exact node is required to verify complete VM task visibility.'
  else if (!Array.isArray(tasks) || tasks.length >= 500 || tasks.some(row => { const task = normalizeNativeTask(row, guest.node); return !task || task.vmid !== guest.vmid || task.endtime === undefined || task.starttime !== Number.parseInt(task.upid.split(':')[4], 16) || !['success', 'warning', 'error'].includes(task.state) })) reason = 'A native VM task is active, unreadable or unconfirmed. Inspect task history first.'
  if (!reason && errors.length) reason = 'Some VM readiness checks are unavailable. Refresh before reviewing boot order.'
  const match = typeof config.boot === 'string' && config.boot.length <= 4096 ? /^order=([^,\s"'\\]+)$/.exec(config.boot) : null
  const ids = match ? match[1].split(';') : []
  const order = ids.map(id => describe(id, config))
  if (!reason && ['bootdisk', 'args', 'smp', 'cdrom', 'snapstate'].some(key => Object.hasOwn(config, key))) reason = 'Legacy bootdisk/custom arguments or native cleanup fields are outside this preservation-focused editor. Inspect them in Proxmox.'
  if (!reason && unusedAlias(config)) reason = 'A duplicate or unverifiable unused-disk reference may be cleaned by a native write. Inspect it in Proxmox first.'
  if (!reason && (!match || ids.length < 2 || ids.length > 89 || ids.some(id => !deviceKey.test(id)) || new Set(ids).size !== ids.length)) reason = 'This first editor reorders an existing nonempty explicit enabled-device set with at least two distinct devices. Legacy/default or ambiguous boot settings stay read-only.'
  if (!reason && order.some(device => device.kind === 'unsupported')) reason = 'The existing enabled set contains an unsupported or missing boot target. No entries will be silently removed.'
  const configured = Object.keys(config).filter(key => /^(?:ide|sata|scsi|virtio|net|efidisk|tpmstate|unused|usb|hostpci|serial|virtiofs)\d+$/.test(key))
  const excluded = configured.filter(id => !ids.includes(id)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(id => ({ id, reason: /^(?:efidisk|tpmstate)/.test(id) ? 'Firmware state is retained; this is not a boot-order entry.' : 'Outside the current enabled set; retained without changes.' }))
  const sourceIdentity = reason ? null : hash({ guest, name, config: Object.fromEntries(Object.entries(config).filter(([key]) => relevant(key))) })
  const untouched = hash(Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'boot' && key !== 'digest')))
  return { config, digest, untouched, view: { name, ready: !reason, ...(reason ? { reason } : {}), errors, sourceIdentity, order, excluded } }
}

export const loadBootOrder = async (client: Client, guest: Guest): Promise<Inventory> => (await inspect(client, guest)).view
function select(inspection: Inspection, sourceIdentity: string, order: string[]) {
  if (!inspection.view.ready || inspection.view.sourceIdentity !== sourceIdentity) throw fail(inspection.view.reason ?? 'The original boot/device identity changed. Inspect the current order and review again.')
  const current = inspection.view.order.map(device => device.id)
  if (new Set(order).size !== order.length || order.length !== current.length || order.some(id => !current.includes(id))) throw fail('Reorder exactly the same enabled devices; adding or removing boot eligibility is outside this editor.')
  if (order.every((id, index) => id === current[index])) throw fail('Move a device before requesting a boot-order review.')
}
export class BootOrderReviews {
  private entries = new Map<string, { guest: Guest; view: Review; fingerprint: string; revision: string; consumed: boolean; result?: Result }>()
  private active = new Set<string>()
  constructor(private clock: () => number = Date.now) {}
  private key(guest: Guest) { return JSON.stringify([guest.id, guest.type, guest.vmid]) }
  private fingerprint(inspection: Inspection, guest: Guest, order: string[]) { return hash({ guest, digest: inspection.digest, source: inspection.view.sourceIdentity, order }) }
  async preview(client: Client, guest: Guest, revision: string, input: unknown): Promise<Review> {
    const value = bootOrderPreviewSchema.parse(input)
    if (this.active.has(this.key(guest))) throw fail('Another boot-order change is being submitted. Inspect current configuration first.')
    const inspection = await inspect(client, guest); select(inspection, value.sourceIdentity, value.order)
    const now = this.clock()
    for (const [id, entry] of this.entries) if (entry.view.expiresAt <= now) this.entries.delete(id)
    if (this.entries.size >= 500) throw fail('Too many open boot reviews. Wait for older reviews to expire.', 429)
    const view: Review = { reviewId: randomUUID(), name: inspection.view.name, node: guest.node, type: 'qemu', vmid: guest.vmid, sourceIdentity: value.sourceIdentity, currentOrder: inspection.view.order, proposedOrder: value.order.map(id => inspection.view.order.find(device => device.id === id)!), expiresAt: now + 300000 }
    this.entries.set(view.reviewId, { guest: { ...guest }, view, revision, fingerprint: this.fingerprint(inspection, guest, value.order), consumed: false })
    return view
  }
  async execute(client: Client, guest: Guest, revision: string | (() => string), input: unknown): Promise<Result> {
    const value = bootOrderExecuteSchema.parse(input), entry = this.entries.get(value.reviewId)
    const currentRevision = () => { try { return typeof revision === 'function' ? revision() : revision } catch { return undefined } }
    if (!entry || entry.view.expiresAt <= this.clock() || hash(entry.guest) !== hash(guest)) throw fail('This boot review expired or is unavailable. Inspect and review again.')
    if (value.confirm !== entry.view.name) throw fail('Type the reviewed VM name exactly before changing boot order.')
    if (entry.revision !== currentRevision()) { entry.consumed = true; throw fail('Connection settings changed. Inspect and review again.') }
    if (entry.result) return entry.result
    if (entry.consumed) throw fail('This boot review was already submitted. Inspect current order and pending changes before another review.')
    entry.consumed = true
    const key = this.key(guest)
    if (this.active.has(key)) throw fail('Another boot-order change is being submitted. Inspect current configuration first.')
    this.active.add(key)
    try {
      const order = entry.view.proposedOrder.map(device => device.id)
      let before: Inspection
      try { before = await inspect(client, guest); select(before, entry.view.sourceIdentity, order) }
      catch { throw fail('Boot checks changed or are unavailable. No update was submitted. Your draft is kept; inspect and review again.') }
      if (this.fingerprint(before, guest, order) !== entry.fingerprint || entry.view.expiresAt <= this.clock() || entry.revision !== currentRevision()) throw fail('The reviewed boot configuration or connection changed. No update was submitted. Inspect and review again.')
      const unknown = () => fail('Boot-order outcome is unconfirmed. Inspect current order, devices and pending changes before another review. No automatic retry, rollback or power action was performed.', 502)
      const boot = 'order=' + order.join(';')
      let response: unknown
      try { response = await client.put(`/nodes/${guest.node}/qemu/${guest.vmid}/config`, { boot, digest: before.digest }) } catch { throw unknown() }
      if (response !== null) throw unknown()
      let after: Inspection
      try { after = await inspect(client, guest) } catch { throw unknown() }
      if (!after.view.ready || after.config.boot !== boot || after.untouched !== before.untouched || entry.revision !== currentRevision()) throw unknown()
      entry.result = { verified: true, name: after.view.name, node: guest.node, type: 'qemu', vmid: guest.vmid, sourceIdentity: after.view.sourceIdentity!, order: after.view.order, observedAt: this.clock() }
      return entry.result
    } finally { this.active.delete(key) }
  }
}
