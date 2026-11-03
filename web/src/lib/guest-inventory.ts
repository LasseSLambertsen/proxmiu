import type { Guest, GuestMetadata } from './api'
import { guestKey } from './guest-workspace'

export interface InventoryFilters {
  query: string
  status: 'all' | 'running' | 'stopped'
  kind: 'all' | 'lxc' | 'qemu'
  node: string
  sort: 'status' | 'name' | 'cpu' | 'memory' | 'id'
  pinnedOnly: boolean
}
export interface SavedView { id: string; name: string; filters: InventoryFilters }
export interface Workspace { filters: InventoryFilters; views: SavedView[] }
export const defaultFilters: InventoryFilters = { query: '', status: 'all', kind: 'all', node: 'all', sort: 'status', pinnedOnly: false }
type Ips = Record<string, Record<string, string>>
type Metadata = Record<string, GuestMetadata>
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function normalizeFilters(value: unknown): InventoryFilters {
  const input = record(value)
  return {
    query: typeof input.query === 'string' ? input.query.slice(0, 200) : '',
    status: input.status === 'running' || input.status === 'stopped' ? input.status : 'all',
    kind: input.kind === 'qemu' || input.kind === 'lxc' ? input.kind : 'all',
    node: typeof input.node === 'string' && input.node.length <= 200 ? input.node : 'all',
    sort: ['status', 'name', 'cpu', 'memory', 'id'].includes(String(input.sort)) ? input.sort as InventoryFilters['sort'] : 'status',
    pinnedOnly: input.pinnedOnly === true,
  }
}

export function parseWorkspace(raw: string | null): Workspace {
  const empty = () => ({ filters: { ...defaultFilters }, views: [] })
  if (!raw) return empty()
  try {
    const input = record(JSON.parse(raw))
    if (input.version !== 1) return empty()
    const seen = new Set<string>()
    const views: SavedView[] = []
    if (Array.isArray(input.views)) for (const item of input.views) {
      const view = record(item)
      if (typeof view.id !== 'string' || !/^[\w-]{1,80}$/.test(view.id) || seen.has(view.id) || typeof view.name !== 'string' || !view.name.trim()) continue
      seen.add(view.id)
      views.push({ id: view.id, name: view.name.trim().slice(0, 40), filters: normalizeFilters(view.filters) })
      if (views.length === 20) break
    }
    return { filters: normalizeFilters(input.filters), views }
  } catch { return empty() }
}

export const workspaceStorageKey = (agent: string) => `proxmiu-workspace-v1:${encodeURIComponent(agent.trim().replace(/\/+$/, '') || 'same-origin')}`

export function filterGuests(guests: Guest[], filters: InventoryFilters, ips: Ips, metadata: Metadata): Guest[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const memory = (guest: Guest) => guest.maxmem ? (guest.mem ?? 0) / guest.maxmem : -1
  return guests.filter(guest => !guest.template)
    .filter(guest => filters.status === 'all' || (filters.status === 'running' ? guest.status === 'running' : guest.status === 'stopped'))
    .filter(guest => filters.kind === 'all' || guest.type === filters.kind)
    .filter(guest => filters.node === 'all' || `${guest.clusterId}/${guest.node}` === filters.node)
    .filter(guest => !filters.pinnedOnly || metadata[guestKey(guest)]?.favorite)
    .filter(guest => !query || [guest.name, String(guest.vmid), guest.node, guest.clusterName, guest.tags, ips[guest.clusterId]?.[`${guest.type}/${guest.vmid}`]].some(value => value?.toLocaleLowerCase().includes(query)))
    .sort((a, b) => {
      const fallback = a.vmid - b.vmid || a.clusterId.localeCompare(b.clusterId)
      if (filters.sort === 'cpu') return (b.cpu ?? -1) - (a.cpu ?? -1) || fallback
      if (filters.sort === 'memory') return memory(b) - memory(a) || fallback
      if (filters.sort === 'id') return fallback
      const names = (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' }) || fallback
      return filters.sort === 'name' ? names : Number(b.status === 'running') - Number(a.status === 'running') || names
    })
}

function csvCell(value: unknown) {
  let text = String(value ?? '')
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function inventoryCsv(guests: Guest[], ips: Ips, metadata: Metadata): string {
  const rows: unknown[][] = [['Name', 'ID', 'Type', 'Status', 'Connection', 'Node', 'IP address', 'CPU %', 'Memory used (bytes)', 'Memory allocated (bytes)', 'Disk allocated (bytes)', 'Uptime (seconds)', 'Pinned']]
  for (const guest of guests) rows.push([guest.name, guest.vmid, guest.type, guest.status, guest.clusterName, guest.node, ips[guest.clusterId]?.[`${guest.type}/${guest.vmid}`], guest.cpu === undefined ? '' : (guest.cpu * 100).toFixed(1), guest.mem, guest.maxmem, guest.maxdisk, guest.uptime, metadata[guestKey(guest)]?.favorite ? 'Yes' : 'No'])
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}
