import { useQuery } from '@tanstack/react-query'
import { api, type ClusterOverview, type Connection, type Guest, type Template } from './api'

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<{ clusters: ClusterOverview[] }>('/overview'),
    refetchInterval: 5000,
  })
}

export function useGuests() {
  const q = useOverview()
  const guests: Guest[] =
    q.data?.clusters.flatMap((c) => c.guests.map((g) => ({ ...g, vmid: g.vmid!, clusterId: c.id, clusterName: c.name }))) ?? []
  return { ...q, guests }
}

/** Map of "type/vmid" -> IPv4 for one cluster, refreshed less often than the overview (it's N API calls). */
export function useGuestIps(clusterIds: string[]) {
  return useQuery({
    queryKey: ['ips', clusterIds],
    queryFn: async () => {
      const entries = await Promise.all(
        clusterIds.map(async (id) => [id, await api.get<Record<string, string>>(`/clusters/${id}/ips`).catch(() => ({}))] as const),
      )
      return Object.fromEntries(entries) as Record<string, Record<string, string>>
    },
    enabled: clusterIds.length > 0,
    refetchInterval: 20_000,
  })
}

export const useConnections = () => useQuery({ queryKey: ['connections'], queryFn: () => api.get<Connection[]>('/clusters') })
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') })
