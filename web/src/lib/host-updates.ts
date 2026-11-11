export interface HostPackage { name: string; architecture: string; installed: string | null; candidate: string }
export interface HostPlan { id: string; digest: string; expiresAt: string; proxmoxMajor: number; codename: string; packages: HostPackage[]; kernelChange: boolean }
export interface HostJob {
  id: string
  state: 'running' | 'review' | 'success' | 'failed' | 'interrupted'
  phase: 'check' | 'apply'
  startedAt: string
  finishedAt?: string
  log: string[]
  logTruncated?: boolean
  plan?: HostPlan
  rebootSuggested?: boolean
  error?: { code: string; message: string }
}
export interface HostTarget {
  clusterId: string
  node: string
  publicKey: string
  revision: string
  configured: boolean
  configuration?: { host: string; port: number; fingerprint: string }
  info?: { ready: boolean; proxmoxVersion: string; proxmoxMajor: number; codename: string; reason?: { code: string; message: string }; latestJobId?: string; rebootSuggested: boolean }
  job?: HostJob
  unresolved: boolean
  setupCommand: string
}
export const hostUpdatesPath = (id: string, node: string) => `/nodes/${encodeURIComponent(id)}/${encodeURIComponent(node)}/updates`
