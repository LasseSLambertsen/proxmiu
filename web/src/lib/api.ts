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
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
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

export interface GuestMetadata {
  favorite: boolean
  notes: string
  updatedAt: string
}

export interface GuestNotes {
  notes: string
  digest: string
  legacyNotes?: string
}

export interface GuestResourceSettings {
  cores: number | null
  sockets: number
  memoryMiB: number | null
  onboot: boolean
  digest: string
  status: string
  pending: boolean
  editable: boolean
  reason?: string
}

export type GuestResourceUpdate = Pick<GuestResourceSettings, 'onboot' | 'digest'> & { cores: number; memoryMiB: number }

export interface GuestBackups {
  backups: { storage: string; volid: string; size?: number; ctime?: number; format?: string }[]
  errors: string[]
  truncated: boolean
}

export interface GuestTaskLog {
  lines: { n: number; t: string }[]
  next: number
  truncated: boolean
}

export interface GuestOperations {
  snapshots: { name: string; description?: string; snaptime?: number }[]
  storages: string[]
  targets: string[]
  errors: string[]
}

export type GuestOperation =
  | { action: 'snapshot'; name: string; description?: string }
  | { action: 'rollback' | 'delete-snapshot'; name: string; confirm: string }
  | { action: 'backup'; storage: string }
  | { action: 'migrate'; target: string }

export interface GuestTask {
  upid: string
  node: string
}

export interface GuestTaskStatus {
  status: string
  exitstatus?: string
}

export interface NativeTask extends GuestTask {
  type: string
  vmid?: number
  starttime: number
  endtime?: number
  status: string
  state: 'running' | 'success' | 'warning' | 'error' | 'unknown'
}

export interface NativeTaskHistory {
  tasks: NativeTask[]
  next: number
  hasMore: boolean
  warnings: string[]
}

export interface AiCreateDraft {
  templateId: string
  templateName: string
  kind: GuestType
  cores: number
  memoryMiB: number
  diskGiB: number
}

export interface AiSettings {
  configured: boolean
  provider: 'openai' | 'anthropic' | 'openrouter'
  model: string
}

export interface AiSetupTarget {
  clusterId: string
  node: string
  type: GuestType
  vmid: number
  name: string
}

export interface AiSetupPreview {
  previewId: string
  expiresAt: string
  provider: AiSettings['provider']
  model: string
  target: AiSetupTarget
  before: GuestResourceSettings
  context: {
    capturedAt: string
    type: GuestType
    status: string
    allocation: { cores: number | null; sockets: number; memoryMiB: number | null; onboot: boolean }
    editable: boolean
    reason?: string
    history: {
      timeframe: 'day'; samples: number; firstSample?: number; lastSample?: number
      cpuSamples?: number; cpuMean?: number; cpuPeak?: number
      memorySamples?: number; memoryMeanBytes?: number; memoryPeakBytes?: number; unavailable?: string
    }
  }
}

export interface AiSetupProposal {
  target: AiSetupTarget
  before: GuestResourceSettings
  after: GuestResourceUpdate
}

export interface AiChatReply { reply: string; proposal?: AiSetupProposal; createDraft?: AiCreateDraft }

export interface AiContext {
  clusters: {
    nodes: { cpu?: number; maxcpu?: number; mem?: number; maxmem?: number }[]
    guests: { type: string; status?: string; cpu?: number; maxcpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number }[]
  }[]
  unavailableConnections: number
}

export interface GuestInsights {
  config: {
    name?: string
    description?: string
    cores?: number
    sockets?: number
    memory?: number
    ostype?: string
    onboot?: boolean
    unprivileged?: boolean
    networks: { name: string; value: string }[]
    disks: { name: string; value: string }[]
  } | null
  metrics: {
    time: number
    cpu?: number
    mem?: number
    maxmem?: number
    netin?: number
    netout?: number
    diskread?: number
    diskwrite?: number
  }[]
  configError?: string
  metricsError?: string
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
  /** env var the script reads; defaults to OPT_<KEY>, or var_<key> for community-scripts */
  env?: string
}

export type TemplateSource =
  | { type: 'github'; repo: string; ref: string; path: string }
  | { type: 'community-scripts'; slug: string; ref: string }

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
  privileged: boolean
  user: string
  options: TemplateOption[]
  script: string
  source?: TemplateSource
  notes: string
  builtin?: boolean
}

export interface CommunityScript {
  slug: string
  name: string
  description: string
  logo?: string
  category?: string
  updateable: boolean
  architectures: string[]
  resources: { cpu: number; ram: number; hdd: number; os?: string; version?: string }
}

export type SelfUpdateState = 'idle' | 'running' | 'success' | 'failed'

export interface SelfUpdate {
  enabled: boolean
  status: { state: SelfUpdateState; startedAt?: string; finishedAt?: string }
  available: boolean | null
  currentCommit?: string
  latestCommit?: string
  checkedAt?: string
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
  kind?: 'provision' | 'update'
  templateId: string
  clusterId: string
  status: 'running' | 'success' | 'error' | 'interrupted'
  createdAt: string
  finishedAt?: string
  interruptedAt?: string
  recoveryGuidance?: string
  target?: { vmid?: number; node: string; type: GuestType; hostname: string }
  logTruncated?: boolean
  steps: { id: string; label: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'interrupted' }[]
  log?: string[]
  error?: string
  result?: { vmid: number; node: string; type: GuestType; hostname: string; ip?: string; user: string; notes: string }
}

export interface JobHistoryStatus {
  available: boolean
  writable: boolean
  warning?: string
  lastSavedAt?: string
  retention: { maxJobs: number; maxLogLines: number; maxJobBytes: number }
}

export interface DiscoveredHost {
  ip: string
  port: number
  hostname?: string
  proxmox: boolean
  version?: string
  known: boolean
}
