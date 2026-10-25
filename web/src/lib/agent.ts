/**
 * The UI talks to a Proxmiu agent running on the LAN. When the agent serves this page itself the
 * base URL is '' (same origin); when the UI is hosted elsewhere (Vercel, Netlify) the user enters it.
 */
export interface AgentConfig {
  url: string
  token?: string
}

const KEY = 'proxmiu-agent'
let current: AgentConfig | null = read()

function read(): AgentConfig | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const getAgent = () => current

export function setAgent(config: AgentConfig | null) {
  current = config
  try {
    if (config) localStorage.setItem(KEY, JSON.stringify(config))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: keep it in memory for this tab */
  }
}

export const normalizeAgentUrl = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
}

export const agentHttpUrl = (path: string) => `${current?.url ?? ''}${path}`

export function agentWsUrl(path: string) {
  const base = current?.url || `${location.protocol}//${location.host}`
  return base.replace(/^http/, 'ws') + path
}

export const isLocalhostUrl = (url: string) => addressSpace(url) === 'loopback'

/**
 * Where an agent URL points, as Chrome's Local Network Access sees it. Only literal private IPs,
 * localhost and .local names count; anything else is "public" (e.g. a Tailscale *.ts.net name).
 */
export function addressSpace(url: string): 'loopback' | 'local' | 'public' {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return 'public'
  }
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return 'loopback'
  if (host.endsWith('.local')) return 'local'
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return 'local'
  if (/^(fc|fd|fe80)/.test(host) && host.includes(':')) return 'local'
  return 'public'
}

/**
 * Chrome 142+ (Local Network Access) lets an https page call http:// agents on private IPs once the
 * user allows it. Safari and every iOS browser do not support this yet.
 */
export const localNetworkAccessSupported: Promise<boolean> = (async () => {
  for (const name of ['local-network-access', 'local-network']) {
    try {
      await navigator.permissions.query({ name } as unknown as PermissionDescriptor)
      return true
    } catch {
      /* unknown permission name */
    }
  }
  return false
})()

export const isAppleWebKit = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
  (/Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(navigator.userAgent))

/** Mixed content: an https page calling a plain-http agent somewhere other than localhost. */
export const isMixedContent = (url: string) => location.protocol === 'https:' && url.startsWith('http:') && !isLocalhostUrl(url)

/** fetch() to the agent, annotated so Chrome applies Local Network Access instead of blocking mixed content. */
export function agentFetch(url: string, init: RequestInit = {}) {
  const space = addressSpace(url)
  const crossSite = !url.startsWith(location.origin) && url.startsWith('http')
  return fetch(url, crossSite && space !== 'public' ? ({ ...init, targetAddressSpace: space } as RequestInit) : init)
}

export interface Health {
  name: string
  version: string
  authRequired: boolean
}

export async function probeAgent(url: string): Promise<Health> {
  const res = await agentFetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) })
  const data = await res.json().catch(() => null)
  if (data?.name !== 'proxmiu-agent') throw new Error(data?.error ?? 'That address answered, but it is not a Proxmiu agent.')
  return data
}
