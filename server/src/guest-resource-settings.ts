import { z } from 'zod'
import type { ProxmoxClient } from './proxmox.js'

type Client = Pick<ProxmoxClient, 'get' | 'put'>
type Guest = { node: string; type: 'qemu' | 'lxc'; vmid: number }
const path = (g: Guest) => `/nodes/${g.node}/${g.type}/${g.vmid}`
const digestSchema = z.string().min(1).max(128).regex(/^[a-f0-9]+$/i)
export const resourceSettingsSchema = z.object({
  cores: z.number().int().min(1).max(128),
  memoryMiB: z.number().int().min(16).max(1048576),
  onboot: z.boolean(),
  digest: digestSchema,
}).strict()
const failure = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode })
function integer(value: unknown): number | null {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

export async function loadResourceSettings(client: Pick<Client, 'get'>, guest: Guest) {
  const [configResult, statusResult, pendingResult] = await Promise.allSettled([
    client.get<Record<string, unknown>>(`${path(guest)}/config`),
    client.get<{ status?: string }>(`${path(guest)}/status/current`),
    client.get<unknown>(`${path(guest)}/pending`),
  ])
  if (configResult.status !== 'fulfilled' || statusResult.status !== 'fulfilled') throw failure('Resource settings could not load. Check the connection and VM.Audit permission, then refresh.', 502)
  const config = configResult.value
  const digest = digestSchema.safeParse(config?.digest)
  if (!digest.success) throw failure('Proxmox did not return a configuration digest. Refresh before editing resource settings.', 502)
  const cores = integer(config.cores)
  const memoryMiB = integer(config.memory)
  const sockets = guest.type === 'lxc' ? 1 : integer(config.sockets ?? 1) ?? 0
  const onboot = config.onboot === true || config.onboot === 1 || config.onboot === '1'
  const validBoot = config.onboot === undefined || [true, false, 1, 0, '1', '0'].includes(config.onboot as boolean | number | string)
  const status = ['running', 'stopped', 'paused'].includes(statusResult.value?.status ?? '') ? statusResult.value.status! : 'unknown'
  const pendingRows = pendingResult.status === 'fulfilled' ? pendingResult.value : null
  const verifiedPending = Array.isArray(pendingRows) && pendingRows.every(row => row && typeof row === 'object' && !Array.isArray(row) && typeof row.key === 'string')
  const pending = verifiedPending && pendingRows.some(row => row.pending !== undefined || (row.delete !== undefined && row.delete !== 0 && row.delete !== false && row.delete !== '0'))
  let reason: string | undefined
  if (status !== 'stopped') reason = 'Shut down this guest before editing its allocation. Proxmiu never stops it automatically.'
  else if (!verifiedPending) reason = 'Could not verify pending changes. Check VM.Audit permission and refresh, or use Proxmox to edit this guest.'
  else if (pending) reason = 'Resolve pending changes in Proxmox before editing this allocation.'
  else if (guest.type === 'qemu' && config.vcpus !== undefined) reason = 'This guest uses CPU hotplug settings. Edit its allocation in Proxmox to preserve the active vCPU count and topology.'
  else if (guest.type === 'qemu' && Object.keys(config).some(key => /^numa\d+$/.test(key))) reason = 'This guest uses explicit NUMA mappings. Edit its allocation in Proxmox to preserve the mapped CPUs and memory.'
  else if (!resourceSettingsSchema.safeParse({ cores, memoryMiB, onboot, digest: digest.data }).success || sockets < 1 || !validBoot) reason = 'This guest uses allocation settings outside this editor’s supported range. Edit them in Proxmox.'
  return { cores, sockets, memoryMiB, onboot, digest: digest.data, status, pending, editable: !reason, ...(reason ? { reason } : {}) }
}

export async function saveResourceSettings(client: Client, guest: Guest, input: z.infer<typeof resourceSettingsSchema>) {
  const patch = resourceSettingsSchema.parse(input)
  const before = await loadResourceSettings(client, guest)
  if (before.digest !== patch.digest) throw failure('Configuration changed in Proxmox. Your draft is kept; reload the current settings before saving.')
  if (!before.editable) throw failure(before.reason!)
  try {
    // Keep sockets, descriptions, ballooning, networking and all other settings intact.
    await client.put(`${path(guest)}/config`, { cores: patch.cores, memory: patch.memoryMiB, onboot: patch.onboot, digest: patch.digest })
  } catch (error) {
    const latest = await loadResourceSettings(client, guest).catch(() => null)
    if (latest && latest.digest !== patch.digest) throw failure('Configuration changed in Proxmox. Your draft is kept; reload the current settings before saving.')
    throw failure('Resource settings were not saved. Check VM.Config.CPU, VM.Config.Memory and VM.Config.Options permissions, then refresh.', (error as { statusCode?: number }).statusCode === 403 ? 403 : 502)
  }
  return loadResourceSettings(client, guest)
}
