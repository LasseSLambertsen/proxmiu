import { z } from 'zod'

export interface NativeTask {
  upid: string
  node: string
  type: string
  vmid?: number
  starttime: number
  endtime?: number
  status: string
  state: 'running' | 'success' | 'warning' | 'error' | 'unknown'
}

const identifier = z.string().min(1).max(253).regex(/^[\w][\w.-]*$/)
const cursor = z.string().regex(/^(?:0|[1-9]\d*)$/).transform(Number).refine(n => Number.isSafeInteger(n) && n <= 1_000_000)
const guestId = z.string().regex(/^[1-9]\d*$/).transform(Number).refine(Number.isSafeInteger)

export const taskHistoryQuerySchema = z.object({
  node: identifier,
  start: cursor.default(0),
  vmid: guestId.optional(),
}).strict()

export interface TaskHistoryPage {
  tasks: NativeTask[]
  next: number
  hasMore: boolean
  warnings: string[]
}

interface HistoryClient {
  get(path: string, params?: Record<string, string | number>): Promise<unknown>
}

const failure = (message: string, statusCode = 502) => Object.assign(new Error(message), { statusCode })
const epoch = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff

function nativeIdentity(value: unknown, node: string): { type: string; id: string; vmid?: number } | undefined {
  if (typeof value !== 'string' || value.length > 1024) return
  const parts = value.split(':')
  if (parts.length !== 9 || parts[0] !== 'UPID' || parts[8] !== '' || parts[1] !== node || !identifier.safeParse(parts[1]).success) return
  // The native %08X process start tick field grows beyond eight digits on long-running nodes.
  if (!/^[0-9a-f]{8}$/i.test(parts[2]) || !/^[0-9a-f]{8,16}$/i.test(parts[3]) || !/^[0-9a-f]{8}$/i.test(parts[4])) return
  const [type, id, owner] = parts.slice(5, 8)
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(type) || !/^[A-Za-z0-9_.@!+-]{0,255}$/.test(id)) return
  // Native owners may contain email names, directory domains or machine accounts.
  if (owner.length > 255 || !/^[^:\s/\u0000-\u001f\u007f-\u009f]+$/u.test(owner)) return
  const parsedId = guestId.safeParse(id)
  return { type, id, ...(parsedId.success ? { vmid: parsedId.data } : {}) }
}

function normalizeTask(value: unknown, node: string): NativeTask | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  const native = nativeIdentity(row.upid, node)
  if (!native || (row.node !== undefined && row.node !== node) || (row.type !== undefined && row.type !== native.type)) return
  if (row.id !== undefined && row.id !== native.id && row.id !== native.vmid) return
  if (row.vmid !== undefined && row.vmid !== native.vmid) return
  if (!epoch(row.starttime) || (row.endtime !== undefined && (!epoch(row.endtime) || row.endtime < row.starttime))) return
  if (row.status !== undefined && row.status !== null && typeof row.status !== 'string') return
  const status = typeof row.status === 'string' ? row.status.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 1000) : ''
  let state: NativeTask['state']
  if (status === 'OK') state = 'success'
  else if (status.startsWith('WARNINGS')) state = 'warning'
  else if (status === 'unexpected status') state = 'unknown'
  else if (!status || status === 'running' || status === 'RUNNING') state = row.endtime === undefined ? 'running' : 'unknown'
  else state = 'error'
  return {
    upid: row.upid as string,
    node,
    type: native.type,
    ...(native.vmid === undefined ? {} : { vmid: native.vmid }),
    starttime: row.starttime,
    ...(row.endtime === undefined ? {} : { endtime: row.endtime as number }),
    status: status || (state === 'running' ? 'Running' : 'Unknown'),
    state,
  }
}

export async function loadTaskHistory(client: HistoryClient, node: string, options: { start: number; vmid?: number }): Promise<TaskHistoryPage> {
  const query = taskHistoryQuerySchema.parse({ node, start: String(options.start), ...(options.vmid === undefined ? {} : { vmid: String(options.vmid) }) })
  let raw: unknown
  try {
    raw = await client.get(`/nodes/${query.node}/tasks`, {
      source: 'all', start: query.start, limit: 50,
      ...(query.vmid === undefined ? {} : { vmid: query.vmid }),
    })
  } catch (error) {
    // Proxmox errors may contain upstream response bodies or credentials.
    const code = (error as { statusCode?: unknown } | null)?.statusCode
    // Reserve API 401 for the agent session; expired Proxmox credentials are an upstream failure.
    throw failure('Proxmox task history is unavailable. Check connection access and task permissions, then refresh.', code === 403 ? 403 : 502)
  }
  if (!Array.isArray(raw)) throw failure('Proxmox returned invalid task history. Refresh history and check the connection.')
  const rows = raw.slice(0, 50)
  const tasks: NativeTask[] = []
  const warnings: string[] = []
  let omitted = 0
  for (const row of rows) {
    const task = normalizeTask(row, node)
    if (!task || (query.vmid !== undefined && task.vmid !== query.vmid)) omitted++
    else tasks.push(task)
  }
  if (omitted) warnings.push(`${omitted} task ${omitted === 1 ? 'row was' : 'rows were'} omitted because its data or source identity could not be verified.`)
  if (raw.length > 50) warnings.push('Proxmox returned more tasks than requested. Only the first 50 rows were read; load more to continue.')
  const next = Math.min(1_000_000, query.start + rows.length)
  return { tasks, next, hasMore: rows.length === 50 && next > query.start, warnings }
}

export class TaskHistoryAccess {
  private entries = new Map<string, { clusterId: string; expires: number }>()

  constructor(private clock: () => number = Date.now) {}

  remember(clusterId: string, node: string, tasks: readonly NativeTask[]) {
    if (!identifier.safeParse(clusterId).success || !identifier.safeParse(node).success || !Array.isArray(tasks)) return
    const now = this.clock()
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key)
    for (const task of tasks.slice(0, 5000)) {
      if (!normalizeTask(task, node)) continue
      const key = JSON.stringify([clusterId, node, task.upid])
      this.entries.delete(key)
      this.entries.set(key, { clusterId, expires: now + 30 * 60_000 })
      if (this.entries.size > 5000) this.entries.delete(this.entries.keys().next().value!)
    }
  }

  canRead(clusterId: string, node: string, upid: string): boolean {
    if (!nativeIdentity(upid, node)) return false
    const key = JSON.stringify([clusterId, node, upid])
    const entry = this.entries.get(key)
    if (!entry) return false
    if (entry.expires <= this.clock()) {
      this.entries.delete(key)
      return false
    }
    return true
  }

  removeConnection(clusterId: string) {
    for (const [key, entry] of this.entries) if (entry.clusterId === clusterId) this.entries.delete(key)
  }
}
