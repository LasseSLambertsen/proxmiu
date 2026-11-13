import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import { verifySetupGuest } from './ai-setup.js'
import type { ProxmoxClient } from './proxmox.js'
import { normalizeNativeTask } from './task-history.js'

type Guest = { id: string; node: string; type: 'qemu' | 'lxc'; vmid: number }
type Client = Pick<ProxmoxClient, 'get' | 'put'>
const failure = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const zero = (v: unknown) => v === 0 || v === '0' || v === false
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const models = ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3']
const common = ['bridge', 'tag', 'firewall', 'link_down', 'mtu', 'rate']
const boolean = (v: string | undefined) => {
  const normalized = v?.toLowerCase()
  return normalized === undefined || ['0', 'off', 'no', 'false'].includes(normalized) ? false : ['1', 'on', 'yes', 'true'].includes(normalized) ? true : undefined
}
export const nicLinkPreviewSchema = z.object({ nic: z.string().regex(/^net(?:0|[1-9]\d?)$/), linkDown: z.boolean() }).strict()
export const nicLinkExecuteSchema = z.object({ reviewId: z.string().uuid(), confirm: z.string().min(1).max(253).refine(s => !/[\u0000-\u001f\u007f]/.test(s)) }).strict()

interface Nic { nic: string; mac: string | null; bridge: string | null; tag: number | null; model: string | null; ifname: string | null; linkDown: boolean | null; canEdit: boolean; reason?: string }
interface Inventory { name: string; ready: boolean; reason?: string; errors: string[]; interfaces: Nic[] }
interface Parsed { view: Nic; raw: string; semantics?: Record<string, string> }
interface Inspection { view: Inventory; digest: string; interfaces: Map<string, Parsed> }
interface Review { reviewId: string; name: string; node: string; type: Guest['type']; vmid: number; nic: string; mac: string; bridge: string; tag: number | null; model: string | null; ifname: string | null; currentLinkDown: boolean; linkDown: boolean; expiresAt: number }
interface Result { verified: true; name: string; node: string; type: Guest['type']; vmid: number; interface: Nic; observedAt: number }

function parse(nic: string, value: unknown, type: Guest['type']): Parsed {
  const view: Nic = { nic, mac: null, bridge: null, tag: null, model: null, ifname: null, linkDown: null, canEdit: false }
  const raw = typeof value === 'string' ? value : ''
  const unsupported = () => ({ view: { ...view, reason: 'This NIC has unsupported or ambiguous native options. Inspect it in Proxmox.' }, raw })
  if (!raw || raw.length > 8192 || /[\u0000-\u0020\u007f"'\\]/.test(raw)) return unsupported()
  const props = new Map<string, string>()
  const allowed = new Set([...common, ...(type === 'qemu' ? [...models, 'model', 'macaddr', 'queues'] : ['name', 'hwaddr', 'ip', 'ip6', 'gw', 'gw6', 'type', 'host-managed'])])
  for (const token of raw.split(',')) {
    const match = /^([a-z][a-z0-9_-]*)=([A-Za-z0-9_.:/;+\-]+)$/.exec(token)
    if (!match || !allowed.has(match[1]) || props.has(match[1])) return unsupported()
    props.set(match[1], match[2])
  }
  let model: string | null = null, mac: string | undefined
  if (type === 'qemu') {
    const aliases = models.filter(m => props.has(m))
    if (aliases.length > 1 || aliases.length && (props.has('model') || props.has('macaddr'))) return unsupported()
    model = aliases[0] ?? props.get('model') ?? null
    mac = aliases.length ? props.get(aliases[0]) : props.get('macaddr')
    if (!model || !models.includes(model)) return unsupported()
  } else {
    mac = props.get('hwaddr')
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$/.test(props.get('name') ?? '') || props.has('type') && props.get('type') !== 'veth' || boolean(props.get('host-managed')) !== false) return unsupported()
    for (const [key, family] of [['ip', 4], ['ip6', 6], ['gw', 4], ['gw6', 6]] as const) {
      const address = props.get(key)
      if (!address) continue
      if (key === 'ip' && ['dhcp', 'manual'].includes(address) || key === 'ip6' && ['dhcp', 'manual', 'auto'].includes(address)) continue
      const parts = address.split('/')
      if (isIP(parts[0]) !== family || parts.length > (key.startsWith('gw') ? 1 : 2) || parts[1] !== undefined && (!/^\d+$/.test(parts[1]) || Number(parts[1]) > (family === 4 ? 32 : 128))) return unsupported()
    }
  }
  const bridge = props.get('bridge'), tag = props.get('tag')
  const linkDown = boolean(props.get('link_down')), firewall = boolean(props.get('firewall'))
  if (!mac || !/^(?:[a-f0-9]{2}:){5}[a-f0-9]{2}$/i.test(mac) || !bridge || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,14}$/.test(bridge) || linkDown === undefined || firewall === undefined) return unsupported()
  if (tag !== undefined && (!/^\d+$/.test(tag) || Number(tag) < 1 || Number(tag) > 4094)) return unsupported()
  for (const key of ['rate', 'queues', 'mtu']) if (props.has(key)) {
    const text = props.get(key)!, number = Number(text)
    if (!(key === 'rate' ? /^\d+(?:\.\d+)?$/.test(text) && number >= 0 && number <= 1e9 : /^\d+$/.test(text) && Number.isSafeInteger(number) && number >= (key === 'queues' ? 1 : 0) && number <= (key === 'queues' ? 64 : 65535))) return unsupported()
  }
  const semantics = Object.fromEntries(props)
  if (type === 'qemu') {
    for (const alias of models) delete semantics[alias]
    semantics.model = model!; semantics.macaddr = mac.toUpperCase()
  } else { semantics.hwaddr = mac.toUpperCase(); semantics.type = 'veth'; semantics['host-managed'] = '0' }
  semantics.link_down = linkDown ? '1' : '0'; semantics.firewall = firewall ? '1' : '0'
  for (const key of ['tag', 'rate', 'queues', 'mtu']) if (props.has(key)) semantics[key] = String(Number(props.get(key)))
  Object.assign(view, { mac, bridge, tag: tag === undefined ? null : Number(tag), model, ifname: type === 'lxc' ? props.get('name')! : null, linkDown, canEdit: true })
  return { view, raw, semantics: Object.fromEntries(Object.entries(semantics).sort(([a], [b]) => a.localeCompare(b))) }
}

async function inspect(client: Client, guest: Guest): Promise<Inspection> {
  let resource: Record<string, unknown>
  try { resource = await verifySetupGuest(client, guest) } catch { throw failure('This guest could not be verified at its original node. Refresh the guest inventory.') }
  const nodePath = `/nodes/${guest.node}`, base = `${nodePath}/${guest.type}/${guest.vmid}`
  let permissions: unknown
  try { permissions = await client.get('/access/permissions', { path: nodePath }) } catch { /* Keep incomplete visibility read-only. */ }
  const rights = record(permissions) ? permissions[nodePath] : undefined
  const audit = record(rights) && Object.hasOwn(rights, 'Sys.Audit') && (rights['Sys.Audit'] === 0 || rights['Sys.Audit'] === 1)
  const requests = await Promise.allSettled([client.get<unknown>(`${base}/config`, { current: 1 }), client.get<unknown>(`${base}/status/current`), client.get<unknown>(`${base}/pending`), client.get<unknown>(`${base}/snapshot`), client.get<unknown>('/nodes'), client.get<unknown>(`${nodePath}/tasks`, { source: 'active', vmid: guest.vmid, limit: 500 })])
  const value = (i: number) => requests[i].status === 'fulfilled' ? (requests[i] as PromiseFulfilledResult<unknown>).value : undefined
  const config = value(0), status = value(1), pending = value(2), snapshots = value(3), nodes = value(4), tasks = value(5)
  if (!record(config)) throw failure('Current NIC configuration could not be read. Check the connection and VM.Audit permission, then refresh.', 502)
  const nameValue = config[guest.type === 'qemu' ? 'name' : 'hostname'] ?? resource.name
  const name = typeof nameValue === 'string' && nameValue.length > 0 && nameValue.length <= 253 && !/[\u0000-\u001f\u007f]/.test(nameValue) ? nameValue : String(guest.vmid)
  const digest = typeof config.digest === 'string' && /^[a-f0-9]{40}$/i.test(config.digest) ? config.digest : ''
  const errors = requests.flatMap((r, i) => r.status === 'rejected' ? [`${['Configuration', 'Guest status', 'Pending changes', 'Snapshots', 'Node status', 'Active tasks'][i]} could not be read safely. Check permissions and refresh.`] : [])
  const matchingNodes = Array.isArray(nodes) ? nodes.filter(n => record(n) && n.node === guest.node) : []
  let reason: string | undefined
  if (!record(status) || status.status !== 'stopped' || resource.status !== 'stopped') reason = 'Shut down this guest before reviewing link state. Proxmiu does not stop it automatically.'
  else if (!digest) reason = 'A valid configuration digest is required before editing link state.'
  else if (config.lock !== undefined || config.template !== undefined && !zero(config.template) || resource.template !== undefined && !zero(resource.template)) reason = 'This guest is locked, a template or its template state is unverified.'
  else if (!Array.isArray(pending) || pending.length > 4096 || pending.some(r => !record(r) || typeof r.key !== 'string' || r.pending !== undefined || r.delete !== undefined && !zero(r.delete))) reason = 'Resolve pending or unreadable changes before reviewing link state.'
  else if (!Array.isArray(snapshots) || snapshots.some(r => !record(r) || typeof r.name !== 'string' || r.name !== 'current')) reason = 'Guests with snapshots or unreadable snapshot state are outside this first link editor.'
  else if (!record(status.ha) || !zero(status.ha.managed)) reason = 'HA-managed guests or unverified HA state are outside this stopped-guest link editor.'
  else if (matchingNodes.length !== 1 || matchingNodes[0].status !== 'online') reason = 'The original node is offline or could not be verified.'
  else if (!audit) reason = 'Sys.Audit on this exact node is required to verify complete guest task visibility.'
  else if (!Array.isArray(tasks) || tasks.length >= 500 || tasks.some(row => {
    const task = normalizeNativeTask(row, guest.node)
    return !task || task.vmid !== guest.vmid || task.endtime === undefined || task.starttime !== Number.parseInt(task.upid.split(':')[4], 16) || !['success', 'warning', 'error'].includes(task.state)
  })) reason = 'A native guest task is active, unreadable or unconfirmed. Inspect task history before reviewing a change.'
  else if (guest.type === 'lxc' && (Object.keys(config).some(k => k.startsWith('lxc.')) || config.lxc !== undefined && (!Array.isArray(config.lxc) || config.lxc.length > 0))) reason = 'Custom low-level container configuration is outside this ordinary NIC editor.'
  if (!reason && errors.length) reason = 'Some NIC readiness checks are unavailable. Refresh before reviewing link state.'
  const interfaces = new Map<string, Parsed>()
  for (const key of Object.keys(config).filter(k => /^net(?:0|[1-9]\d*)$/.test(k) && Number(k.slice(3)) <= 31).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))) {
    const parsed = parse(key, config[key], guest.type)
    if (reason) parsed.view.canEdit = false
    interfaces.set(key, parsed)
  }
  return { digest, interfaces, view: { name, ready: !reason, ...(reason ? { reason } : {}), errors, interfaces: [...interfaces.values()].map(n => n.view) } }
}

export const loadNicLinks = async (client: Client, guest: Guest): Promise<Inventory> => (await inspect(client, guest)).view
export { parse as readNicProperty }
function selected(inspection: Inspection, nic: string, linkDown: boolean) {
  const item = inspection.interfaces.get(nic)
  if (!inspection.view.ready || !item?.view.canEdit || !item.semantics) throw failure(inspection.view.reason ?? item?.view.reason ?? 'Choose an eligible NIC and refresh its configuration.')
  if (item.view.linkDown === linkDown) throw failure('Choose a different link state before requesting a review.')
  return item
}
const patch = (raw: string, linkDown: boolean) => raw.split(',').some(t => t.startsWith('link_down=')) ? raw.split(',').map(t => t.startsWith('link_down=') ? `link_down=${linkDown ? 1 : 0}` : t).join(',') : `${raw},link_down=${linkDown ? 1 : 0}`

export class NicLinkReviews {
  private entries = new Map<string, { guest: Guest; view: Review; fingerprint: string; revision: string; consumed: boolean; result?: Result }>()
  private active = new Set<string>()
  constructor(private clock: () => number = Date.now) {}
  private key(guest: Guest) { return JSON.stringify([guest.id, guest.type, guest.vmid]) }
  private fingerprint(inspection: Inspection, guest: Guest, item: Parsed, linkDown: boolean) { return hash({ guest, name: inspection.view.name, digest: inspection.digest, raw: item.raw, linkDown }) }
  async preview(client: Client, guest: Guest, revision: string, input: unknown): Promise<Review> {
    const value = nicLinkPreviewSchema.parse(input)
    if (this.active.has(this.key(guest))) throw failure('Another link change is being submitted for this guest. Inspect its current configuration first.')
    const inspection = await inspect(client, guest), item = selected(inspection, value.nic, value.linkDown), now = this.clock()
    for (const [id, entry] of this.entries) if (entry.view.expiresAt <= now) this.entries.delete(id)
    if (this.entries.size >= 500) throw failure('Too many open NIC reviews. Wait for older reviews to expire.', 429)
    const view: Review = { reviewId: randomUUID(), name: inspection.view.name, node: guest.node, type: guest.type, vmid: guest.vmid, nic: value.nic, mac: item.view.mac!, bridge: item.view.bridge!, tag: item.view.tag, model: item.view.model, ifname: item.view.ifname, currentLinkDown: item.view.linkDown!, linkDown: value.linkDown, expiresAt: now + 300000 }
    this.entries.set(view.reviewId, { guest: { ...guest }, view, revision, fingerprint: this.fingerprint(inspection, guest, item, value.linkDown), consumed: false })
    return view
  }
  async execute(client: Client, guest: Guest, revision: string | (() => string), input: unknown): Promise<Result> {
    const value = nicLinkExecuteSchema.parse(input), entry = this.entries.get(value.reviewId)
    const currentRevision = () => { try { return typeof revision === 'function' ? revision() : revision } catch { return undefined } }
    if (!entry || entry.view.expiresAt <= this.clock() || hash(entry.guest) !== hash(guest)) throw failure('This NIC review expired or is unavailable. Inspect and review again.')
    if (value.confirm !== entry.view.name) throw failure('Type the reviewed guest name exactly before changing link state.')
    if (entry.revision !== currentRevision()) { entry.consumed = true; throw failure('Connection settings changed. Inspect and review again.') }
    if (entry.result) return entry.result
    if (entry.consumed) throw failure('This NIC review was already submitted. Inspect current configuration and pending changes before another review.')
    entry.consumed = true
    const key = this.key(guest)
    if (this.active.has(key)) throw failure('Another link change is being submitted for this guest. Inspect its current configuration first.')
    this.active.add(key)
    try {
      let inspection: Inspection, item: Parsed
      try { inspection = await inspect(client, guest); item = selected(inspection, entry.view.nic, entry.view.linkDown) }
      catch { throw failure('NIC checks changed or are unavailable. No update was submitted. Your draft is kept; refresh and review again.') }
      if (this.fingerprint(inspection, guest, item, entry.view.linkDown) !== entry.fingerprint || entry.view.expiresAt <= this.clock() || entry.revision !== currentRevision()) throw failure('The reviewed NIC, configuration or connection changed. No update was submitted. Inspect and review again.')
      const uncertain = () => failure('Link change outcome is unconfirmed. Inspect the current NIC configuration and pending changes before another review. No automatic retry or rollback was performed.', 502)
      let response: unknown
      const raw = patch(item.raw, entry.view.linkDown)
      try { response = await client.put(`/nodes/${guest.node}/${guest.type}/${guest.vmid}/config`, { [entry.view.nic]: raw, digest: inspection.digest }) }
      catch { throw uncertain() }
      if (response !== null) throw uncertain()
      let after: Inspection
      try { after = await inspect(client, guest) } catch { throw uncertain() }
      const observed = after.interfaces.get(entry.view.nic), expected = parse(entry.view.nic, raw, guest.type)
      if (!after.view.ready || after.view.name !== entry.view.name || !observed?.view.canEdit || !observed.semantics || hash(observed.semantics) !== hash(expected.semantics) || entry.revision !== currentRevision()) throw uncertain()
      entry.result = { verified: true, name: after.view.name, node: guest.node, type: guest.type, vmid: guest.vmid, interface: observed.view, observedAt: this.clock() }
      return entry.result
    } finally { this.active.delete(key) }
  }
}
