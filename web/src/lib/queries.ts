import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ClusterOverview, type CommunityScript, type Connection, type Guest, type GuestInsights, type GuestMetadata, type Template } from './api'
import { guestApiPath, guestKey, type HistoryRange } from './guest-workspace'

export const useGuestMetadata = () => useQuery({ queryKey: ['guest-metadata'], queryFn: () => api.get<Record<string, GuestMetadata>>('/guest-metadata') })

export function useSaveGuestMetadata() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ guest, patch }: { guest: Guest; patch: Partial<Pick<GuestMetadata, 'favorite' | 'notes'>> }) =>
      api.put<GuestMetadata>(`/guest-metadata/${encodeURIComponent(guest.clusterId)}/${guest.type}/${guest.vmid}`, patch),
    onSuccess: (value, { guest }) => {
      qc.setQueryData<Record<string, GuestMetadata>>(['guest-metadata'], previous => ({ ...previous, [guestKey(guest)]: value }))
      qc.invalidateQueries({ queryKey: ['guest-metadata'] })
    },
  })
}

export function useGuestInsights(guest: Guest | undefined, timeframe: HistoryRange, enabled = true) {
  return useQuery({
    queryKey: ['guest-insights', guest ? guestKey(guest) : '', guest?.node, timeframe],
    queryFn: () => api.get<GuestInsights>(`${guestApiPath(guest!)}/insights?timeframe=${timeframe}`),
    enabled: !!guest && enabled,
    refetchInterval: 60_000,
    retry: 1,
  })
}

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
export const useCommunityScripts = (enabled = true) =>
  useQuery({
    queryKey: ['community-scripts'],
    queryFn: () => api.get<{ scripts: CommunityScript[] }>('/community-scripts'),
    staleTime: 10 * 60_000,
    enabled,
  })
