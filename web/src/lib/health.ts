import type { ClusterOverview } from './api'
import { guestHref } from './guest-workspace'

export interface HealthWarning { id: string; title: string; description: string; href: string; severity: 'error' | 'warning' }

export function healthWarnings(clusters: ClusterOverview[]): HealthWarning[] {
  const warnings: HealthWarning[] = []
  for (const cluster of clusters) {
    if (!cluster.ok) {
      warnings.push({ id: cluster.id, title: `${cluster.name} is unreachable`, description: 'Check the host, network connection and API credentials.', href: '/connections', severity: 'error' })
      continue
    }
    for (const node of cluster.nodes) {
      if (node.status !== 'online') warnings.push({ id: `${cluster.id}/${node.id}`, title: `${node.node} is ${node.status}`, description: `Node in ${cluster.name} is not reporting as online.`, href: '/connections', severity: 'error' })
    }
    for (const guest of cluster.guests) {
      if (guest.template || guest.status !== 'running' || guest.vmid === undefined) continue
      const target = { ...guest, vmid: guest.vmid, clusterId: cluster.id }
      const name = guest.name ?? String(guest.vmid)
      if ((guest.cpu ?? 0) >= .9) warnings.push({ id: `${cluster.id}/${guest.id}/cpu`, title: `${name} is using most of its CPU`, description: `${Math.round(guest.cpu! * 100)}% CPU usage in the latest reading.`, href: guestHref(target), severity: 'warning' })
      if (guest.maxmem && guest.mem !== undefined && guest.mem / guest.maxmem >= .9) warnings.push({ id: `${cluster.id}/${guest.id}/memory`, title: `${name} is low on memory`, description: `${Math.round(guest.mem / guest.maxmem * 100)}% of allocated memory is in use.`, href: guestHref(target), severity: 'warning' })
    }
  }
  return warnings
}
