import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DATA_DIR } from './store.js'

const execFileAsync = promisify(execFile)
const HELPER = '/usr/local/bin/proxmiu-self-update'
const MARKER = '/etc/proxmiu/self-update'
const UPDATE_ENV = '/etc/proxmiu/update.env'
const STATUS_FILE = join(DATA_DIR, 'self-update.json')
// dist/server or server/src both sit two levels below the checkout root.
const APP_DIR = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_REPO = 'https://github.com/LasseSLambertsen/proxmiu.git'
const DEFAULT_REF = 'main'
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
const STATES = new Set(['idle', 'running', 'success', 'failed'])

export type SelfUpdateState = 'idle' | 'running' | 'success' | 'failed'

export interface SelfUpdateStatus {
  state: SelfUpdateState
  startedAt?: string
  finishedAt?: string
}

export interface SelfUpdateInfo {
  enabled: boolean
  status: SelfUpdateStatus
  available: boolean | null
  currentCommit?: string
  latestCommit?: string
  checkedAt?: string
}

// update.env is written by install.sh with printf %q, so accept both bare and
// single- or double-quoted values.
export function parseUpdateEnv(text: string) {
  const values: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq)
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1)
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\\(.)/g, '$1')
    }
    values[key] = value
  }
  return values
}

function updateSource() {
  let env: Record<string, string> = {}
  try {
    env = parseUpdateEnv(readFileSync(UPDATE_ENV, 'utf8'))
  } catch {}
  return { repo: env.PROXMIU_REPO || DEFAULT_REPO, ref: env.PROXMIU_REF || DEFAULT_REF }
}

async function localCommit() {
  const { stdout } = await execFileAsync('git', ['-C', APP_DIR, 'rev-parse', 'HEAD'], { timeout: 5_000, env: GIT_ENV })
  return stdout.trim()
}

async function remoteCommit(repo: string, ref: string) {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-remote', repo, `refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`],
    { timeout: 10_000, env: GIT_ENV },
  )
  const refs = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const [sha, name] = line.split('\t')
    if (sha && name) refs.set(name, sha)
  }
  return refs.get(`refs/tags/${ref}^{}`) ?? refs.get(`refs/heads/${ref}`) ?? refs.get(`refs/tags/${ref}`) ?? null
}

export function selfUpdateEnabled() {
  try {
    return existsSync(HELPER) && readFileSync(MARKER, 'utf8').trim() === '1'
  } catch {
    return false
  }
}

export function selfUpdateStatus(): SelfUpdateStatus {
  try {
    const parsed = JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as SelfUpdateStatus
    if (!STATES.has(parsed.state)) return { state: 'idle' }
    return parsed
  } catch {
    return { state: 'idle' }
  }
}

export async function selfUpdateInfo(): Promise<SelfUpdateInfo> {
  const enabled = selfUpdateEnabled()
  const status = selfUpdateStatus()
  if (!enabled) return { enabled, status, available: null }
  // The installer is rewriting the checkout while an update runs; the answer
  // would be meaningless and the browser already polls the status.
  if (status.state === 'running') return { enabled, status, available: null }

  const checkedAt = new Date().toISOString()
  try {
    const { repo, ref } = updateSource()
    const [current, latest] = await Promise.all([localCommit(), remoteCommit(repo, ref)])
    if (!latest) return { enabled, status, available: null, currentCommit: current, checkedAt }
    return { enabled, status, available: current !== latest, currentCommit: current, latestCommit: latest, checkedAt }
  } catch {
    return { enabled, status, available: null, checkedAt }
  }
}

export async function startSelfUpdate() {
  if (!selfUpdateEnabled()) {
    throw Object.assign(new Error('Self-update is disabled. Re-run the installer with PROXMIU_ALLOW_SELF_UPDATE=1 to enable it.'), { statusCode: 409 })
  }
  try {
    await execFileAsync('sudo', ['-n', HELPER], { timeout: 15_000 })
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw Object.assign(new Error(e.stderr?.trim() || e.message || 'Could not start the update'), { statusCode: 409 })
  }
  return selfUpdateStatus()
}
