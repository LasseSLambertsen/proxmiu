import { createHash, randomUUID } from 'node:crypto'
import { guestInsightsParamsSchema, normalizeGuestMetrics } from './guest-insights.js'
import { loadResourceSettings } from './guest-resource-settings.js'
import type { AiSettings } from './ai.js'
import type { ProxmoxClient } from './proxmox.js'

export const setupQuerySchema = guestInsightsParamsSchema.strict()
type Guest = { id: string; node: string; type: 'qemu' | 'lxc'; vmid: number }
type Client = Pick<ProxmoxClient, 'get'>
const fail = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })

/** Identity stays local; only the numeric context below may leave the agent. */
export async function verifySetupGuest(client: Client, guest: Guest) {
  let resources: Record<string, unknown>[]
  try { resources = await client.get('/cluster/resources') }
  catch { throw fail('Could not verify this guest. Check the connection and refresh the guest list.', 502) }
  if (!Array.isArray(resources)) throw fail('Guest inventory is unavailable. Refresh the connection.', 502)
  const matches = resources.filter(row => row && row.type === guest.type && Number(row.vmid) === guest.vmid)
  if (matches.length !== 1 || matches[0].node !== guest.node || matches[0].template === 1 || matches[0].template === '1') {
    throw fail('This guest moved, became a template or is no longer available. Refresh the guest list and select it again.')
  }
  return matches[0]
}

export async function loadSetupSnapshot(client: Client, guest: Guest, now = Date.now) {
  const resource = await verifySetupGuest(client, guest)
  const captured = now()
  const before = await loadResourceSettings(client, guest)
  const history: {
    timeframe: 'day'; samples: number; firstSample?: number; lastSample?: number
    cpuSamples?: number; cpuMean?: number; cpuPeak?: number
    memorySamples?: number; memoryMeanBytes?: number; memoryPeakBytes?: number; unavailable?: string
  } = { timeframe: 'day', samples: 0 }
  try {
    const raw = await client.get<unknown>(`/nodes/${guest.node}/${guest.type}/${guest.vmid}/rrddata`, { timeframe: 'day', cf: 'AVERAGE' })
    if (!Array.isArray(raw) || raw.length > 10_000) throw new Error('Invalid history')
    const rows = normalizeGuestMetrics(raw).filter(row => row.time >= captured / 1000 - 86400 && row.time <= captured / 1000).slice(-2880)
    history.samples = rows.length
    if (rows.length) {
      history.firstSample = rows[0].time
      history.lastSample = rows.at(-1)!.time
    }
    const cpu = rows.flatMap(row => row.cpu === undefined ? [] : [row.cpu])
    const memory = rows.flatMap(row => row.mem === undefined || row.mem > Number.MAX_SAFE_INTEGER ? [] : [row.mem])
    if (cpu.length) Object.assign(history, { cpuSamples: cpu.length, cpuMean: cpu.reduce((a, b) => a + b, 0) / cpu.length, cpuPeak: Math.max(...cpu) })
    if (memory.length) Object.assign(history, { memorySamples: memory.length, memoryMeanBytes: memory.reduce((a, b) => a + b / memory.length, 0), memoryPeakBytes: Math.max(...memory) })
    if (!cpu.length && !memory.length) history.unavailable = 'Resource history is unavailable for this period. No sustained usage can be inferred.'
  } catch { history.unavailable = 'Resource history is unavailable. Check VM.Audit permission or reconnect and refresh.' }
  // Recheck location after reads: never consent to a snapshot from a stale node.
  await verifySetupGuest(client, guest)
  const name = typeof resource.name === 'string' && resource.name.trim() ? resource.name.trim().slice(0, 200) : `${guest.type === 'qemu' ? 'VM' : 'Container'} ${guest.vmid}`
  return {
    target: { clusterId: guest.id, node: guest.node, type: guest.type, vmid: guest.vmid, name },
    before,
    context: {
      capturedAt: new Date(captured).toISOString(), type: guest.type, status: before.status,
      allocation: { cores: before.cores, sockets: before.sockets, memoryMiB: before.memoryMiB, onboot: before.onboot },
      editable: before.editable, ...(before.reason ? { reason: before.reason } : {}), history,
    },
  }
}

export type SetupSnapshot = Awaited<ReturnType<typeof loadSetupSnapshot>>
export type SetupPreview = SetupSnapshot & { previewId: string; expiresAt: string; provider: AiSettings['provider']; model: string }
const identity = (settings: AiSettings) => createHash('sha256').update(JSON.stringify(settings)).digest('hex')

export class SetupPreviewCache {
  private entries = new Map<string, { expires: number; identity: string; preview: SetupPreview }>()
  constructor(private now = Date.now) {}
  clear() { this.entries.clear() }
  create(settings: AiSettings, snapshot: SetupSnapshot): SetupPreview {
    const time = this.now()
    for (const [key, entry] of this.entries) if (entry.expires <= time) this.entries.delete(key)
    while (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!)
    const preview: SetupPreview = { ...structuredClone(snapshot), previewId: randomUUID(), expiresAt: new Date(time + 600_000).toISOString(), provider: settings.provider, model: settings.model }
    this.entries.set(preview.previewId, { expires: time + 600_000, identity: identity(settings), preview: structuredClone(preview) })
    return preview
  }
  resolve(previewId: string, settings: AiSettings): SetupSnapshot {
    const entry = this.entries.get(previewId)
    if (!entry || entry.expires <= this.now()) {
      this.entries.delete(previewId)
      throw fail('This setup preview expired. Refresh it and review sharing consent again.')
    }
    if (entry.identity !== identity(settings)) throw fail('AI settings changed. Refresh the setup preview and review sharing consent again.')
    return structuredClone(entry.preview)
  }
}
