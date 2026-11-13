import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AiSettings, type ClusterOverview, type CommunityScript, type Connection, type Guest, type GuestBackups, type GuestInsights, type GuestMetadata, type GuestNotes, type GuestOperations, type GuestResourceSettings, type GuestResourceUpdate, type GuestTask, type GuestTaskLog, type GuestTaskStatus, type NativeTaskHistory, type Template } from './api'
import { guestApiPath, guestKey, type HistoryRange } from './guest-workspace'
import type { GuestDiskCapacity, GuestNicLinks } from './api'

export const nicLinksKey = (guest: Guest) => ['guest-nic-links', guestKey(guest), guest.node]
export function useGuestNicLinks(guest: Guest, enabled: boolean) {
  return useQuery({ queryKey: nicLinksKey(guest), queryFn: () => api.get<GuestNicLinks>(`${guestApiPath(guest)}/nic-links`), enabled, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
}

export const diskCapacityKey = (guest: Guest) => ['guest-disk-capacity', guestKey(guest), guest.node]
export function useGuestDiskCapacity(guest: Guest, enabled: boolean) {
  return useQuery({ queryKey: diskCapacityKey(guest), queryFn: () => api.get<GuestDiskCapacity>(`${guestApiPath(guest)}/disk-capacity`), enabled, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false })
}

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

export function useGuestNotes(guest: Guest, enabled = true) {
  return useQuery({
    queryKey: ['guest-notes', guestKey(guest), guest.node],
    queryFn: () => api.get<GuestNotes>(`${guestApiPath(guest)}/notes`),
    enabled,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useSaveGuestNotes(guest: Guest) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (notes: Pick<GuestNotes, 'notes' | 'digest'>) => api.put<GuestNotes>(`${guestApiPath(guest)}/notes`, notes),
    onSuccess: value => {
      qc.setQueryData(['guest-notes', guestKey(guest), guest.node], value)
      qc.invalidateQueries({ queryKey: ['guest-insights', guestKey(guest)] })
    },
  })
}

export function useGuestOperations(guest: Guest, enabled = true) {
  return useQuery({
    queryKey: ['guest-operations', guestKey(guest), guest.node],
    queryFn: () => api.get<GuestOperations>(`${guestApiPath(guest)}/operations`),
    enabled,
    retry: false,
  })
}

export function useGuestResourceSettings(guest: Guest, enabled = true) {
  return useQuery({
    queryKey: ['guest-resource-settings', guestKey(guest), guest.node],
    queryFn: () => api.get<GuestResourceSettings>(`${guestApiPath(guest)}/resource-settings`),
    enabled,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useSaveGuestResourceSettings(guest: Guest) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: GuestResourceUpdate) => api.put<GuestResourceSettings>(`${guestApiPath(guest)}/resource-settings`, settings),
    onSuccess: value => {
      qc.setQueryData(['guest-resource-settings', guestKey(guest), guest.node], value)
      qc.invalidateQueries({ queryKey: ['guest-insights', guestKey(guest)] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useGuestBackups(guest: Guest, storage: string, enabled = true) {
  return useQuery({
    queryKey: ['guest-backups', guestKey(guest), guest.node, storage],
    queryFn: () => api.get<GuestBackups>(`${guestApiPath(guest)}/backups?storage=${encodeURIComponent(storage)}`),
    enabled: enabled && !!storage,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export function useLoadGuestTaskLog(clusterId: string, task: GuestTask) {
  return useMutation({
    mutationFn: (start: number) => api.get<GuestTaskLog>(`/clusters/${encodeURIComponent(clusterId)}/tasks/${encodeURIComponent(task.node)}/${encodeURIComponent(task.upid)}/log?start=${start}`),
  })
}

export function useGuestTask(guest: Guest, task: GuestTask | null) {
  return useQuery({
    queryKey: ['guest-task', guest.clusterId, task?.node, task?.upid],
    queryFn: () => api.get<GuestTaskStatus>(`/clusters/${encodeURIComponent(guest.clusterId)}/tasks/${encodeURIComponent(task!.node)}/${encodeURIComponent(task!.upid)}`),
    enabled: !!task,
    refetchInterval: query => query.state.data?.status === 'stopped' ? false : 1500,
    retry: false,
  })
}

export function useLoadTaskHistory(clusterId: string, node: string, vmid?: number) {
  return useMutation({
    mutationFn: (start: number) => {
      const query = new URLSearchParams({ node, start: String(start) })
      if (vmid !== undefined) query.set('vmid', String(vmid))
      return api.get<NativeTaskHistory>(`/clusters/${encodeURIComponent(clusterId)}/task-history?${query}`)
    },
    retry: false,
  })
}

export function useNativeTaskStatus(clusterId: string, task: GuestTask, enabled: boolean) {
  return useQuery({
    queryKey: ['native-task-status', clusterId, task.node, task.upid],
    queryFn: () => api.get<GuestTaskStatus>(`/clusters/${encodeURIComponent(clusterId)}/tasks/${encodeURIComponent(task.node)}/${encodeURIComponent(task.upid)}`),
    enabled,
    refetchInterval: query => enabled && !query.state.error && query.state.data?.status !== 'stopped' ? 1500 : false,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

export const useAiSettings = () => useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('/ai/settings'), retry: false })

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
