import { z } from 'zod'
import type { ProxmoxClient } from './proxmox.js'

type Client = Pick<ProxmoxClient, 'get'>
type Guest = { node: string; type: 'qemu' | 'lxc'; vmid: number }
interface Backup { storage: string; volid: string; size?: number; ctime?: number; format?: string }
interface BackupInventory { backups: Backup[]; errors: string[]; truncated: boolean }
interface TaskLog { lines: { n: number; t: string }[]; next: number; truncated: boolean }

const identifier = z.string().min(1).max(253).regex(/^[\w][\w.-]*$/)
const cursor = z.union([z.number(), z.string().regex(/^\d{1,7}$/).transform(Number)]).pipe(z.number().int().min(0).max(1_000_000))
export const backupQuerySchema = z.object({ storage: identifier }).strict()
export const taskLogQuerySchema = z.object({ start: cursor.default(0) }).strict()

const failure = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode })
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const enabled = (value: unknown) => value === 1 || value === '1' || value === true
const disabled = (value: unknown) => value === 0 || value === '0' || value === false
const inventoryError = (message: string): BackupInventory => ({ backups: [], errors: [message], truncated: false })

export async function loadGuestBackups(client: Client, guest: Guest, storage: string): Promise<BackupInventory> {
  backupQuerySchema.parse({ storage })
  identifier.parse(guest.node)
  let storages: unknown
  try {
    storages = await client.get<unknown>(`/nodes/${guest.node}/storage`, { enabled: 1, content: 'backup' })
  } catch {
    return inventoryError('Backup storage could not load. Check Datastore.Audit permissions and refresh.')
  }
  if (!Array.isArray(storages)) return inventoryError('Proxmox returned an invalid backup storage list. Refresh or check Proxmox.')
  const available = storages.some(s => record(s) && s.storage === storage && enabled(s.active) && !disabled(s.enabled) && typeof s.content === 'string' && s.content.split(',').map(c => c.trim()).includes('backup'))
  if (!available) throw failure('Choose an active backup storage on this node.', 409)

  let content: unknown
  try {
    content = await client.get<unknown>(`/nodes/${guest.node}/storage/${storage}/content`, { content: 'backup', vmid: guest.vmid })
  } catch {
    return inventoryError('Backups could not load from this storage. Check Datastore.Audit permissions and refresh.')
  }
  if (!Array.isArray(content)) return inventoryError('Proxmox returned an invalid backup inventory. Refresh or check Proxmox.')
  const backups: Backup[] = []
  let malformed = false
  for (const item of content) {
    if (!record(item)) {
      malformed = true
      continue
    }
    const vmid = typeof item.vmid === 'string' && /^\d+$/.test(item.vmid) ? Number(item.vmid) : item.vmid
    if (typeof vmid !== 'number' || !Number.isSafeInteger(vmid) || vmid < 1) {
      malformed = true
      continue
    }
    if (vmid !== guest.vmid) continue
    if ((item.content !== undefined && item.content !== 'backup') || typeof item.volid !== 'string' || !item.volid.startsWith(`${storage}:backup/`) || item.volid.length > 1024 || item.volid.length === `${storage}:backup/`.length || /[\\\u0000-\u001f\u007f]/.test(item.volid)) {
      malformed = true
      continue
    }
    backups.push({
      storage,
      volid: item.volid,
      ...(nonnegative(item.size) ? { size: item.size } : {}),
      ...(nonnegative(item.ctime) ? { ctime: item.ctime } : {}),
      ...(typeof item.format === 'string' && /^[a-z0-9][a-z0-9.+_-]{0,63}$/i.test(item.format) ? { format: item.format } : {}),
    })
  }
  backups.sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0) || a.volid.localeCompare(b.volid))
  return { backups: backups.slice(0, 500), errors: malformed ? ['Some backup records were invalid and could not be displayed. Refresh or check Proxmox.'] : [], truncated: backups.length > 500 }
}

export async function loadTaskLog(client: Client, node: string, upid: string, start: number): Promise<TaskLog> {
  const offset = taskLogQuerySchema.parse({ start }).start
  identifier.parse(node)
  let result: unknown
  try {
    result = await client.get<unknown>(`/nodes/${node}/tasks/${encodeURIComponent(upid)}/log`, { start: offset, limit: 200 })
  } catch {
    throw failure('Task logs could not load. Check Proxmox permissions and refresh.')
  }
  if (!Array.isArray(result)) throw failure('Proxmox returned an invalid task log. Refresh or check Proxmox.')
  let truncated = result.length > 200
  const seen = new Set<number>()
  const lines: TaskLog['lines'] = []
  for (const item of result) {
    if (record(item) && item.n === 0 && item.t === 'no content') continue
    const n = record(item) && typeof item.n === 'string' && /^\d{1,7}$/.test(item.n) ? Number(item.n) : record(item) ? item.n : undefined
    if (!record(item) || typeof n !== 'number' || !Number.isInteger(n) || n <= offset || n > 1_000_000 || typeof item.t !== 'string' || seen.has(n)) {
      truncated = true
      continue
    }
    seen.add(n)
    const marker = '… [truncated]'
    const t = item.t.length > 2000 ? item.t.slice(0, 2000 - marker.length) + marker : item.t
    if (t !== item.t) truncated = true
    lines.push({ n, t })
  }
  lines.sort((a, b) => a.n - b.n)
  const page = lines.slice(0, 200)
  return { lines: page, next: page.at(-1)?.n ?? offset, truncated }
}
