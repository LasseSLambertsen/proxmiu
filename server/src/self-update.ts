import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DATA_DIR } from './store.js'

const execFileAsync = promisify(execFile)
const HELPER = '/usr/local/bin/proxmiu-self-update'
const MARKER = '/etc/proxmiu/self-update'
const STATUS_FILE = join(DATA_DIR, 'self-update.json')
const STATES = new Set(['idle', 'running', 'success', 'failed'])

export type SelfUpdateState = 'idle' | 'running' | 'success' | 'failed'

export interface SelfUpdateStatus {
  state: SelfUpdateState
  startedAt?: string
  finishedAt?: string
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
