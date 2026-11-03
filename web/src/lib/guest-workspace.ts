import type { Guest, GuestInsights, GuestType } from './api'

type GuestIdentity = { clusterId: string; node: string; type: Guest['type']; vmid: number }
export type MetricKind = 'cpu' | 'memory' | 'network' | 'disk'
export type HistoryRange = 'hour' | 'day' | 'week'

export const guestKey = (guest: Pick<GuestIdentity, 'clusterId' | 'type' | 'vmid'>) => `${guest.clusterId}/${guest.type}/${guest.vmid}`
export const guestHref = (guest: GuestIdentity) => `/guests/${encodeURIComponent(guest.clusterId)}/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}`
export const guestApiPath = (guest: GuestIdentity) => `/clusters/${encodeURIComponent(guest.clusterId)}/guests/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}`
export const isGuestType = (value?: string): value is GuestType => value === 'lxc' || value === 'qemu'

const finite = (value?: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function metricValue(sample: GuestInsights['metrics'][number], kind: MetricKind): number | null {
  if (kind === 'cpu') return finite(sample.cpu) ? Math.min(100, sample.cpu * 100) : null
  if (kind === 'memory') return finite(sample.mem) && finite(sample.maxmem) && sample.maxmem > 0 ? Math.min(100, sample.mem / sample.maxmem * 100) : null
  const [incoming, outgoing] = kind === 'network' ? [sample.netin, sample.netout] : [sample.diskread, sample.diskwrite]
  return finite(incoming) && finite(outgoing) ? incoming + outgoing : null
}
