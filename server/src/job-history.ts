import * as fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { encrypt, decrypt } from './store.js'

export const retention = Object.freeze({ maxJobs: 50, maxLogLines: 5000, maxJobBytes: 128 * 1024 })
const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_PLAIN_BYTES = 8 * 1024 * 1024
export const recoveryGuidance = 'The guest or remote command may still exist/run; inspect it before starting again.'
const unavailable = 'Provisioning history is unavailable. The saved journal was preserved; inspect agent storage before starting again.'
const unsaved = 'Provisioning history could not be saved. Live diagnostics remain available; recent changes may be lost on restart.'

export interface JobTarget { vmid?: number; node: string; type: 'lxc' | 'qemu'; hostname: string }
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
  target?: JobTarget
  steps: { id: string; label: string; status: 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'interrupted' }[]
  log: string[]
  logTruncated?: boolean
  error?: string
  result?: { vmid: number; node: string; type: 'lxc' | 'qemu'; hostname: string; ip?: string; user: string; notes: string }
}
export interface JobHistoryStatus {
  available: boolean
  writable: boolean
  warning?: string
  lastSavedAt?: string
  retention: typeof retention
}

const identifier = z.string().min(1).max(256)
const targetSchema = z.object({ vmid: z.number().int().positive().optional(), node: identifier, type: z.enum(['lxc', 'qemu']), hostname: z.string().max(128) }).strict()
const jobSchema = z.object({
  id: identifier, title: z.string().max(512), kind: z.enum(['provision', 'update']).optional(), templateId: identifier, clusterId: identifier,
  status: z.enum(['running', 'success', 'error', 'interrupted']), createdAt: z.iso.datetime(), finishedAt: z.iso.datetime().optional(), interruptedAt: z.iso.datetime().optional(),
  recoveryGuidance: z.string().max(512).optional(), target: targetSchema.optional(),
  steps: z.array(z.object({ id: z.string().min(1).max(64), label: z.string().max(128), status: z.enum(['pending', 'running', 'done', 'error', 'skipped', 'interrupted']) }).strict()).max(32),
  log: z.array(z.string().max(4096)).max(retention.maxLogLines), logTruncated: z.boolean().optional(), error: z.string().max(2048).optional(),
  result: targetSchema.extend({ vmid: z.number().int().positive(), ip: z.string().max(128).optional(), user: z.string().max(128), notes: z.string().max(4096) }).strict().optional(),
}).strict()
const journalSchema = z.object({ version: z.literal(1), savedAt: z.iso.datetime(), jobs: z.array(jobSchema).max(retention.maxJobs) }).strict()

/** Only execution-time memory contains this registry; neither snapshots nor the journal serialize it. */
export function jobSecrets(req: { password?: string; options?: Record<string, string | boolean> }, template: { options: { key: string; type: string; default?: string | boolean }[] }): string[] {
  const values = [req.password, ...Object.values(req.options ?? {}).filter(value => typeof value === 'string' && value.length >= 6)]
  for (const option of template.options) {
    if (option.type !== 'secret') continue
    // Include defaults even when overridden: scripts and template notes can contain either value.
    values.push(option.default, req.options?.[option.key])
  }
  const strings = values.filter((value): value is string => typeof value === 'string' && !!value)
  // SSH emits lone CR as a line break too, so redact those separately emitted fragments.
  return [...new Set(strings.flatMap(value => [value, ...value.split(/\r\n?|\n/).filter(Boolean)]))].sort((a, b) => b.length - a.length)
}
export function redactJobText(text: string, secrets: readonly string[]): string {
  for (const value of secrets) text = text.split(value).join('••••••')
  return text
}

/** Budget each newest line once, including JSON escapes and UTF-8, rather than repeatedly serializing a shrinking log. */
export function normalizeJob(job: Job, secrets: readonly string[] = []): Job {
  const text = (value: string, max: number) => redactJobText(value, secrets).slice(0, max)
  const target = (value: JobTarget): JobTarget => ({ ...(value.vmid === undefined ? {} : { vmid: value.vmid }), node: value.node, type: value.type, hostname: value.hostname.slice(0, 128) })
  const snapshot: Job = {
    id: job.id, title: text(job.title, 512), ...(job.kind ? { kind: job.kind } : {}), templateId: job.templateId, clusterId: job.clusterId,
    status: job.status, createdAt: job.createdAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}), ...(job.interruptedAt ? { interruptedAt: job.interruptedAt } : {}),
    ...(job.recoveryGuidance ? { recoveryGuidance: text(job.recoveryGuidance, 512) } : {}), ...(job.target ? { target: target(job.target) } : {}),
    steps: job.steps.slice(0, 32).map(step => ({ id: step.id.slice(0, 64), label: text(step.label, 128), status: step.status })),
    log: [], ...(job.logTruncated ? { logTruncated: true } : {}), ...(job.error ? { error: text(job.error, 2048) } : {}),
    ...(job.result ? { result: { ...target(job.result), vmid: job.result.vmid, ...(job.result.ip ? { ip: job.result.ip.slice(0, 128) } : {}), user: job.result.user.slice(0, 128), notes: text(job.result.notes, 4096) } } : {}),
  }
  let budget = retention.maxJobBytes - Buffer.byteLength(JSON.stringify(snapshot)) - 24 // reserve the truncation marker
  let truncated = !!job.logTruncated
  for (let i = job.log.length - 1; i >= 0; i--) {
    if (snapshot.log.length >= retention.maxLogLines) { truncated = true; break }
    const clean = redactJobText(job.log[i], secrets)
    const line = clean.slice(0, 4096)
    if (line.length < clean.length) truncated = true
    const bytes = Buffer.byteLength(JSON.stringify(line)) + (snapshot.log.length ? 1 : 0)
    if (bytes > budget) { truncated = true; break }
    snapshot.log.push(line)
    budget -= bytes
  }
  snapshot.log.reverse()
  if (truncated) snapshot.logTruncated = true
  jobSchema.parse(snapshot)
  if (Buffer.byteLength(JSON.stringify(snapshot)) > retention.maxJobBytes) throw new Error('Job metadata exceeds retention limits')
  return snapshot
}

type JournalIO = Pick<typeof fs, 'renameSync' | 'writeFileSync' | 'fsyncSync' | 'closeSync' | 'openSync'>
export class JobHistory {
  private jobs = new Map<string, Job>()
  private secrets = new Map<string, readonly string[]>()
  private io: JournalIO
  private health: JobHistoryStatus = { available: true, writable: true, retention }
  private timer?: NodeJS.Timeout
  private dirty = false
  private file: string

  constructor(private directory: string, io: Partial<JournalIO> = {}) {
    this.io = { ...fs, ...io }
    this.file = join(directory, 'jobs.json')
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      fs.chmodSync(directory, 0o700)
      let fd: number
      try { fd = fs.openSync(this.file, 'r') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      let encrypted: string
      try {
        const size = fs.fstatSync(fd).size
        if (size > MAX_FILE_BYTES) throw new Error('Journal too large')
        // A bounded read also closes the growth race between fstat and read.
        const buffer = Buffer.alloc(size + 1)
        let read = 0
        while (read < buffer.length) {
          const count = fs.readSync(fd, buffer, read, buffer.length - read, null)
          if (!count) break
          read += count
        }
        if (read > size) throw new Error('Journal changed during load')
        encrypted = buffer.subarray(0, read).toString('utf8')
      } finally { fs.closeSync(fd) }
      // Validate the envelope before invoking the shared codec, which intentionally accepts state-secret payloads too.
      const parts = encrypted.split(':')
      if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid envelope')
      for (const part of parts.slice(1)) {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(part) || Buffer.from(part, 'base64').toString('base64') !== part) throw new Error('Invalid encoding')
      }
      if (Buffer.from(parts[1], 'base64').length !== 12 || Buffer.from(parts[2], 'base64').length !== 16 || Buffer.from(parts[3], 'base64').length > MAX_PLAIN_BYTES) throw new Error('Invalid envelope size')
      const plain = decrypt(encrypted)
      if (Buffer.byteLength(plain) > MAX_PLAIN_BYTES) throw new Error('Journal plaintext too large')
      const journal = journalSchema.parse(JSON.parse(plain))
      for (const job of journal.jobs) {
        if (this.jobs.has(job.id) || Buffer.byteLength(JSON.stringify(job)) > retention.maxJobBytes) throw new Error('Invalid job record')
        this.jobs.set(job.id, job)
      }
      this.health.lastSavedAt = journal.savedAt
    } catch {
      this.jobs.clear()
      this.health = { available: false, writable: false, warning: unavailable, retention }
      return
    }
    let recovered = false
    for (const job of this.jobs.values()) {
      if (job.status !== 'running') continue
      recovered = true
      job.status = 'interrupted'
      job.interruptedAt = new Date().toISOString()
      job.recoveryGuidance = recoveryGuidance
      delete job.finishedAt
      delete job.result
      for (const step of job.steps) {
        if (step.status === 'running') step.status = 'interrupted'
        else if (step.status === 'pending') step.status = 'skipped'
      }
    }
    if (recovered) {
      this.checkpoint()
      if (!this.health.writable) this.health.warning = 'Recovered interrupted runs are not saved. ' + unsaved
    }
  }

  status(): JobHistoryStatus { return { ...this.health, retention: { ...retention } } }
  private assertAvailable() { if (!this.health.available) throw Object.assign(new Error(unavailable), { statusCode: 503 }) }
  list(): Job[] {
    this.assertAvailable()
    return [...this.jobs.values()].map(job => normalizeJob(job, this.secrets.get(job.id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  get(id: string): Job | undefined {
    this.assertAvailable()
    const job = this.jobs.get(id)
    return job ? normalizeJob(job, this.secrets.get(id)) : undefined
  }
  assertAdmission() {
    this.assertAvailable()
    if (this.jobs.size >= retention.maxJobs && [...this.jobs.values()].every(job => job.status === 'running')) throw Object.assign(new Error('All provisioning history slots contain active jobs. Wait for a run to finish.'), { statusCode: 409 })
  }
  register(job: Job, secrets: readonly string[] = []) {
    this.assertAdmission()
    if (this.jobs.has(job.id)) throw new Error('Duplicate job ID')
    const previous = new Map(this.jobs)
    if (this.jobs.size >= retention.maxJobs) {
      const oldest = [...this.jobs.values()].filter(job => job.status !== 'running').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      this.jobs.delete(oldest.id)
    }
    this.jobs.set(job.id, job)
    this.secrets.set(job.id, secrets)
    try { this.save() }
    catch {
      this.jobs = previous
      this.secrets.delete(job.id)
      throw Object.assign(new Error('Provisioning history could not save the new run. No operation was started.'), { statusCode: 503 })
    }
    for (const id of this.secrets.keys()) if (!this.jobs.has(id)) this.secrets.delete(id)
  }
  append(job: Job, line: string) {
    const clean = redactJobText(line, this.secrets.get(job.id) ?? [])
    if (clean.length > 4096) job.logTruncated = true
    job.log.push(clean.slice(0, 4096))
    if (job.log.length > retention.maxLogLines) {
      job.log.splice(0, job.log.length - retention.maxLogLines)
      job.logTruncated = true
    }
    // Keep live memory and API snapshots on the same bounded diagnostic tail.
    const snapshot = normalizeJob(job, this.secrets.get(job.id))
    job.log = snapshot.log
    if (snapshot.logTruncated) job.logTruncated = true
    this.dirty = true
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = undefined; this.checkpoint() }, 250)
      this.timer.unref()
    }
  }
  checkpoint() {
    this.dirty = true
    this.flush()
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
    if (!this.dirty || !this.health.available) return
    try { this.save() } catch { /* State callbacks must never turn storage failure into a false operation outcome. */ }
  }
  private save() {
    this.assertAvailable()
    const temporary = `${this.file}.${randomUUID()}.tmp`
    let fd: number | undefined
    try {
      const savedAt = new Date().toISOString()
      const jobs = this.list()
      const plaintext = JSON.stringify({ version: 1, savedAt, jobs })
      if (Buffer.byteLength(plaintext) > MAX_PLAIN_BYTES) throw new Error('Journal too large')
      const payload = encrypt(plaintext)
      if (Buffer.byteLength(payload) > MAX_FILE_BYTES) throw new Error('Encrypted journal too large')
      fd = this.io.openSync(temporary, 'wx', 0o600)
      this.io.writeFileSync(fd, payload, 'utf8')
      this.io.fsyncSync(fd)
      this.io.closeSync(fd)
      fd = undefined
      this.io.renameSync(temporary, this.file)
      this.health = { available: true, writable: true, lastSavedAt: savedAt, retention }
      this.dirty = false
    } catch (error) {
      this.health.writable = false
      this.health.warning = unsaved
      this.dirty = true
      throw error
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd) } catch {} }
      try { fs.unlinkSync(temporary) } catch {}
    }
  }
}
