import { z } from 'zod'
import type { ProxmoxClient } from './proxmox.js'

type Client = Pick<ProxmoxClient, 'get' | 'post' | 'put' | 'del'>
type Guest = { node: string; type: 'qemu' | 'lxc'; vmid: number }
const base = (g: Guest) => `/nodes/${g.node}/${g.type}/${g.vmid}`
const identifier = z.string().min(1).max(253).regex(/^[\w][\w.-]*$/)
const snapshotName = z.string().max(40).regex(/^[A-Za-z][A-Za-z0-9_-]*$/).refine(n => n !== 'current', 'Choose a different snapshot name')
export const notesSchema = z.object({ notes: z.string().max(64_000), digest: z.string().min(1).max(128).regex(/^[a-f0-9]+$/i) }).strict()
export const operationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('snapshot'), name: snapshotName, description: z.string().max(1000).optional() }).strict(),
  z.object({ action: z.literal('rollback'), name: snapshotName, confirm: z.string().min(1).max(253) }).strict(),
  z.object({ action: z.literal('delete-snapshot'), name: snapshotName, confirm: z.string().min(1).max(253) }).strict(),
  z.object({ action: z.literal('backup'), storage: identifier }).strict(),
  z.object({ action: z.literal('migrate'), target: identifier }).strict(),
])

const failure = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })

export async function loadNotes(client: Client, guest: Guest) {
  const config = await client.get<{ description?: string; digest?: string }>(`${base(guest)}/config`)
  if (!config || typeof config.digest !== 'string' || !/^[a-f0-9]{1,128}$/i.test(config.digest)) {
    throw failure('Proxmox did not return a configuration digest. Reload before editing notes.', 502)
  }
  return { notes: typeof config.description === 'string' ? config.description : '', digest: config.digest }
}

export async function saveNotes(client: Client, guest: Guest, input: z.infer<typeof notesSchema>) {
  const patch = notesSchema.parse(input)
  const current = await loadNotes(client, guest)
  if (current.digest !== patch.digest) throw failure('Notes changed in Proxmox. Your draft is kept; reload the current notes before saving.')
  // Empty form fields are omitted by the PVE client; use Proxmox's explicit deletion API.
  try {
    await client.put(`${base(guest)}/config`, { digest: patch.digest, ...(patch.notes === '' ? { delete: 'description' } : { description: patch.notes }) })
  } catch (error) {
    // A second writer can win after the preflight read. Proxmox reports digest
    // failures inconsistently, so compare fresh state rather than parsing its text.
    const latest = await loadNotes(client, guest).catch(() => null)
    if (latest && latest.digest !== patch.digest) throw failure('Notes changed in Proxmox. Your draft is kept; reload the current notes before saving.')
    throw error
  }
  return loadNotes(client, guest)
}

interface Snapshot { name: string; description?: string; snaptime?: number }
export async function loadOperations(client: Client, guest: Guest) {
  const [snapshots, storages, nodes] = await Promise.allSettled([
    client.get<Snapshot[]>(`${base(guest)}/snapshot`),
    client.get<{ storage: string; active?: number; enabled?: number; content: string }[]>(`/nodes/${guest.node}/storage`, { enabled: 1, content: 'backup' }),
    client.get<{ node: string; status: string }[]>('/nodes'),
  ])
  return {
    snapshots: snapshots.status === 'fulfilled' ? snapshots.value.filter(s => snapshotName.safeParse(s.name).success).map(s => ({ name: s.name, ...(typeof s.description === 'string' ? { description: s.description } : {}), ...(Number.isFinite(s.snaptime) ? { snaptime: s.snaptime } : {}) })) : [],
    storages: storages.status === 'fulfilled' ? storages.value.filter(s => s.active === 1 && s.enabled !== 0 && s.content?.split(',').includes('backup') && identifier.safeParse(s.storage).success).map(s => s.storage) : [],
    targets: nodes.status === 'fulfilled' ? nodes.value.filter(n => n.node !== guest.node && n.status === 'online' && identifier.safeParse(n.node).success).map(n => n.node) : [],
    errors: [snapshots.status === 'rejected' && 'Snapshots could not load. Check VM.Audit permissions and refresh.', storages.status === 'rejected' && 'Backup storage could not load. Check Datastore.Audit permissions and refresh.', nodes.status === 'rejected' && 'Migration targets could not load. Check Sys.Audit permissions and refresh.'].filter((s): s is string => !!s),
  }
}

export async function runOperation(client: Client, guest: Guest, input: z.infer<typeof operationSchema>) {
  const op = operationSchema.parse(input)
  const path = base(guest)
  let upid: string
  if (op.action === 'snapshot') {
    upid = await client.post<string>(`${path}/snapshot`, { snapname: op.name, description: op.description })
  } else if (op.action === 'rollback' || op.action === 'delete-snapshot') {
    const current = await client.get<{ name?: string; hostname?: string }>(`${path}/config`)
    const status = await client.get<{ name?: string }>(`${path}/status/current`)
    const name = current.name ?? current.hostname ?? status.name ?? String(guest.vmid)
    if (op.confirm !== name) throw failure('The guest name confirmation does not match.')
    const { snapshots, errors } = await loadOperations(client, guest)
    if (errors.some(e => e.startsWith('Snapshots')) || !snapshots.some(s => s.name === op.name)) throw failure('The snapshot is unavailable. Refresh the snapshots list.')
    const snapshot = `${path}/snapshot/${op.name}`
    upid = op.action === 'rollback' ? await client.post<string>(`${snapshot}/rollback`) : await client.del<string>(snapshot)
  } else if (op.action === 'backup') {
    const { storages } = await loadOperations(client, guest)
    if (!storages.includes(op.storage)) throw failure('Choose an active backup storage on this node.')
    upid = await client.post<string>(`/nodes/${guest.node}/vzdump`, { vmid: guest.vmid, storage: op.storage, mode: 'snapshot', compress: 'zstd' })
  } else {
    const { targets } = await loadOperations(client, guest)
    if (!targets.includes(op.target)) throw failure('Choose another online node in this cluster.')
    const status = await client.get<{ status: string; ha?: { managed?: number | boolean | string } }>(`${path}/status/current`)
    if (status.ha?.managed === 1 || status.ha?.managed === true || status.ha?.managed === '1') {
      throw failure('Use Proxmox HA controls to migrate this HA-managed guest. An HA request does not confirm that migration completed.')
    }
    const running = status.status === 'running'
    upid = await client.post<string>(`${path}/migrate`, { target: op.target, ...(guest.type === 'qemu' ? { online: running } : { restart: running }) })
  }
  if (typeof upid !== 'string' || !upid.startsWith('UPID:')) throw failure('Proxmox did not return a task ID. Check Proxmox before retrying.', 502)
  return { upid, node: guest.node }
}

export async function readTask(client: Client, node: string, upid: string) {
  const task = await client.get<{ status: string; exitstatus?: string }>(`/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`)
  if (task?.status !== 'running' && task?.status !== 'stopped') throw failure('Proxmox returned an unknown task status.', 502)
  return { status: task.status, ...(typeof task.exitstatus === 'string' ? { exitstatus: task.exitstatus.slice(0, 1000) } : {}) }
}
