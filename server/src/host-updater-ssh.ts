import { createHash, timingSafeEqual } from 'node:crypto'
import ssh2 from 'ssh2'
import { z } from 'zod'

export const updaterId = z.string().regex(/^[a-f0-9]{32}$/)
export const updaterNode = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$/)
const version = z.string().max(200).regex(/^[0-9][A-Za-z0-9.+:~\-]*$/)
export const packageSchema = z.object({ name: z.string().max(200).regex(/^[a-z0-9][a-z0-9+.-]+$/), architecture: z.string().max(40).regex(/^[a-z0-9][a-z0-9-]*$/), installed: version.nullable(), candidate: version }).strict()
const safeError = z.object({ code: z.string().max(80).regex(/^[a-z_]+$/), message: z.string().max(500) }).strict()
export const planSchema = z.object({ id: updaterId, digest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime({ offset: true }), proxmoxMajor: z.union([z.literal(8), z.literal(9)]), codename: z.enum(['bookworm', 'trixie']), packages: z.array(packageSchema).max(2000), kernelChange: z.boolean() }).strict().refine(plan => Buffer.byteLength(JSON.stringify(plan)) <= 96 * 1024 && new Set(plan.packages.map(p => `${p.name}:${p.architecture}`)).size === plan.packages.length, 'Invalid complete plan')
export const infoSchema = z.object({ proxmoxVersion: z.string().max(200), proxmoxMajor: z.number().int().min(0).max(99), codename: z.string().max(40), machineIdHash: z.string().regex(/^(?:[a-f0-9]{64})?$/), ready: z.boolean(), reason: safeError.optional(), latestJobId: updaterId.optional(), rebootSuggested: z.boolean() }).strict()
export const jobSchema = z.object({ id: updaterId, state: z.enum(['running', 'review', 'success', 'failed', 'interrupted']), phase: z.enum(['check', 'apply']), startedAt: z.iso.datetime({ offset: true }), finishedAt: z.iso.datetime({ offset: true }).optional(), log: z.array(z.string().max(2048)).max(500), logTruncated: z.boolean().optional(), plan: planSchema.optional(), rebootSuggested: z.boolean().optional(), error: safeError.optional() }).strict().refine(job => job.log.reduce((n, line) => n + Buffer.byteLength(line), 0) <= 128 * 1024 && (job.state !== 'review' || (job.phase === 'check' && !!job.plan && job.plan.packages.length > 0)), 'Invalid updater job')
export type HostInfo = z.infer<typeof infoSchema>
export type HostJob = z.infer<typeof jobSchema>
export type HostPlan = z.infer<typeof planSchema>
export type HostRequest = { action: 'inspect' | 'check' } | { action: 'status'; jobId: string } | { action: 'apply'; planId: string; digest: string }
export interface UpdaterTransportConfig { host: string; port: number; fingerprint: string; privateKey: string; node: string }

export class HostUpdaterError extends Error {
  statusCode = 502
  constructor(message = 'Could not verify the host updater response.', public sent = false, public rejected = false) { super(message) }
}

/** JSON.parse accepts repeated object keys. The protocol deliberately does not. */
function strictJson(text: string): unknown {
  let offset = 0
  const ws = () => { while (/\s/.test(text[offset] ?? '') && offset < text.length) offset++ }
  const string = () => {
    const start = offset++
    while (offset < text.length) {
      const char = text[offset++]
      if (char === '\\') offset++
      else if (char === '"') return JSON.parse(text.slice(start, offset)) as string
    }
    throw new Error('string')
  }
  const value = (depth: number): unknown => {
    if (depth > 30) throw new Error('depth')
    ws()
    if (text[offset] === '"') return string()
    if (text[offset] === '{') {
      offset++; ws()
      const object: Record<string, unknown> = Object.create(null)
      if (text[offset] === '}') { offset++; return object }
      while (true) {
        ws(); if (text[offset] !== '"') throw new Error('key')
        const key = string()
        if (Object.hasOwn(object, key)) throw new Error('duplicate')
        ws(); if (text[offset++] !== ':') throw new Error('colon')
        object[key] = value(depth + 1); ws()
        const end = text[offset++]
        if (end === '}') return object
        if (end !== ',') throw new Error('object')
      }
    }
    if (text[offset] === '[') {
      offset++; ws()
      const array: unknown[] = []
      if (text[offset] === ']') { offset++; return array }
      while (true) {
        array.push(value(depth + 1)); ws()
        const end = text[offset++]
        if (end === ']') return array
        if (end !== ',') throw new Error('array')
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset))?.[0]
    if (!token) throw new Error('value')
    offset += token.length
    return JSON.parse(token)
  }
  const parsed = value(0)
  ws(); if (offset !== text.length) throw new Error('tail')
  return parsed
}

export function validateResponse(bytes: Buffer, node: string): HostInfo | HostJob {
  try {
    if (bytes.length > 256 * 1024) throw new Error('limit')
    const input = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const envelope = z.object({ protocol: z.literal(1), node: z.literal(node), result: z.unknown().optional(), error: safeError.optional() }).strict().parse(input)
    if (envelope.error && envelope.result !== undefined) throw new Error('ambiguous response')
    if (envelope.error) {
      const refusals: Record<string, string> = {
        busy: 'The host already has an active update operation.',
        stale_plan: 'The host refused this stale or consumed plan. Check updates again.',
        not_ready: 'The host needs administrator attention before managed updates.',
        invalid_request: 'The host refused an invalid updater request.',
        unsupported_host: 'The host Proxmox and Debian versions need administrator review.',
        unhealthy_dpkg: 'The host package database needs administrator attention.',
        unsafe_sources: 'The host repository definitions need administrator review.',
        unsafe_config: 'The host APT configuration is unsupported for managed updates.',
        unsafe_files: 'The host package files could not be verified safely.',
        command_failed: 'The host readiness check failed. Inspect the host locally.',
      }
      if (refusals[envelope.error.code]) throw new HostUpdaterError(refusals[envelope.error.code], true, true)
      throw new Error('unclassified host refusal')
    }
    if (!envelope.result) throw new Error('missing result')
    return z.union([infoSchema, jobSchema]).parse(envelope.result)
  } catch (cause) { if (cause instanceof HostUpdaterError) throw cause; throw new HostUpdaterError() }
}

export function invokeHostUpdater(config: UpdaterTransportConfig, request: HostRequest): Promise<HostInfo | HostJob> {
  return new Promise((resolve, reject) => {
    const client = new ssh2.Client()
    let sent = false, settled = false, pinned = false
    const fail = (message?: string, refusal?: HostUpdaterError) => {
      if (settled) return
      settled = true; clearTimeout(timer); client.destroy()
      reject(refusal ?? new HostUpdaterError(message, sent))
    }
    const timer = setTimeout(() => fail('Host updater contact timed out. Accepted work continues on the host.'), 30_000)
    client.on('error', () => fail('Could not verify the pinned host SSH connection.'))
    client.on('close', () => { if (!settled) fail() })
    client.on('ready', () => {
      if (!pinned) { fail(); return }
      client.exec('proxmiu-host-updater', { pty: false }, (error, channel) => {
        if (error) { fail(); return }
        const buffers: Buffer[] = []
        let length = 0, exit: number | undefined
        channel.on('data', (chunk: Buffer) => {
          length += chunk.length
          if (length > 256 * 1024) { fail(); return }
          buffers.push(Buffer.from(chunk))
        })
        channel.stderr.on('data', () => {})
        channel.on('error', () => fail())
        channel.on('exit', (code: number) => { exit = code })
        channel.on('close', () => {
          if (settled) return
          if (exit !== 0) { fail(); return }
          try {
            const result = validateResponse(Buffer.concat(buffers), config.node)
            if (request.action === 'inspect' ? !('ready' in result) : !('state' in result)) { fail(); return }
            if (request.action === 'status' && 'id' in result && result.id !== request.jobId) { fail(); return }
            settled = true; clearTimeout(timer); client.end(); resolve(result)
          } catch (cause) { fail(undefined, cause instanceof HostUpdaterError && cause.rejected ? cause : undefined) }
        })
        sent = true
        channel.end(JSON.stringify(request) + '\n')
      })
    })
    try {
      client.connect({ host: config.host, port: config.port, username: 'root', privateKey: config.privateKey,
        readyTimeout: 15_000, keepaliveInterval: 0, tryKeyboard: false, algorithms: { serverHostKey: ['ssh-ed25519'] },
        hostVerifier: (raw: Buffer) => {
          const fingerprint = 'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')
          const actual = Buffer.from(fingerprint), expected = Buffer.from(config.fingerprint)
          pinned = raw.length === 51 && raw.subarray(4, 15).toString() === 'ssh-ed25519' && actual.length === expected.length && timingSafeEqual(actual, expected)
          return pinned
        } })
    } catch { fail('Could not establish the pinned host SSH connection.') }
  })
}
