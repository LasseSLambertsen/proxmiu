import { agentFetch, agentHttpUrl, getAgent } from './agent'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getAgent()?.token
  if (token) headers.Authorization = `Bearer ${token}`
  let res: Response
  try {
    res = await agentFetch(agentHttpUrl(`/api${path}`), { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch {
    throw new ApiError('Cannot reach the Proxmiu agent', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('proxmiu:unauthorized'))
    throw new ApiError(data.error ?? `${res.status} ${res.statusText}`, res.status)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
}

export type GuestType = 'qemu' | 'lxc'

export interface Resource {
  id: string
  type: 'node' | GuestType
  node: string
  vmid?: number
  name?: string
  status: string
  template?: number
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  tags?: string
  /** nodes only: address to SSH to */
  ip?: string
}

export interface ClusterOverview {
  id: string
  name: string
  host: string
  ok: boolean
  error?: string
  nodes: Resource[]
  guests: Resource[]
}

export interface Guest extends Resource {
  clusterId: string
  clusterName: string
  vmid: number
}

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  authType: 'token' | 'password'
  username: string
  verifyTls: boolean
  createdAt: string
}

export interface TemplateOption {
  key: string
  label: string
  type: 'text' | 'secret' | 'boolean'
  default?: string | boolean
  placeholder?: string
  help?: string
}

export interface Template {
  id: string
  name: string
  description: string
  icon: string
  tags: string[]
  kind: GuestType
  os: string[]
  resources: { cores: number; memory: number; disk: number; swap: number }
  nesting: boolean
  user: string
  options: TemplateOption[]
  script: string
  notes: string
  builtin?: boolean
}

export interface StorageInfo {
  storage: string
  type: string
  avail?: number
  total?: number
}

export interface CreateOptions {
  node: string
  nodes: string[]
  nextid: number
  storages: { rootdir: StorageInfo[]; images: StorageInfo[]; vztmpl: StorageInfo[] }
  bridges: string[]
  osTemplates: { downloaded: string[]; available: string[] }
  vmTemplates: { vmid: number; name: string; node: string }[]
}

export interface Job {
  id: string
  title: string
  templateId: string
  clusterId: string
  status: 'running' | 'success' | 'error'
  createdAt: string
  finishedAt?: string
  steps: { id: string; label: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped' }[]
  log?: string[]
  error?: string
  result?: { vmid: number; node: string; type: GuestType; hostname: string; ip?: string; user: string; notes: string }
}

export interface DiscoveredHost {
  ip: string
  port: number
  hostname?: string
  proxmox: boolean
  version?: string
  known: boolean
}
