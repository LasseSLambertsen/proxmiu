import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import ssh2 from 'ssh2'
import { z } from 'zod'
import { HostUpdaterError, updaterId, updaterNode, type HostInfo, type HostJob, type HostRequest, type UpdaterTransportConfig } from './host-updater-ssh.js'

interface Target {
  clusterId: string
  node: string
  publicKey: string
  privateKey: string
  revision: string
  keyRevision: string
  configuration?: { host: string; port: number; fingerprint: string; machineIdHash: string }
  info?: HostInfo
  job?: HostJob
  binding?: { planId: string; digest: string; revision: string; keyRevision: string }
}
export interface UpdatersState {
  targets: Record<string, Target>
  reservation?: { key: string; kind: 'check' | 'apply'; previousLatest?: string; jobId?: string; unknown: boolean }
}
interface Dependencies {
  load(): UpdatersState
  save(state: UpdatersState): void
  online(clusterId: string, node: string): Promise<void>
  encrypt(value: string): string
  decrypt(value: string): string
  invoke(config: UpdaterTransportConfig, request: HostRequest): Promise<HostInfo | HostJob>
}
const hostSchema = z.string().max(253).refine(host => !!isIP(host) || /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
const configSchema = z.object({ host: hostSchema, port: z.number().int().min(1).max(65535), fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/), revision: z.string().min(1).max(128) }).strict()
const applySchema = z.object({ planId: updaterId, digest: z.string().regex(/^[a-f0-9]{64}$/), confirmNode: updaterNode }).strict()
function error(message: string, statusCode = 409): never { throw Object.assign(new Error(message), { statusCode }) }

export function setupCommand(key: string) {
  // Only a generated public key enters this fixed command; no request strings.
  return [
    '# Run as root on the intended Proxmox node',
    'set -eu',
    'setup_file="$(mktemp)"',
    'trap \'rm -f "$setup_file"\' EXIT',
    'commit="$(python3 -I -c \'import json,urllib.request; print(json.load(urllib.request.urlopen("https://api.github.com/repos/LasseSLambertsen/proxmiu/commits/main",timeout=30))["sha"])\')"',
    'case "$commit" in *[!a-f0-9]*|"") exit 1 ;; esac',
    '[ "${#commit}" -eq 40 ]',
    'curl -fSsL --proto \'=https\' --proto-redir \'=https\' "https://raw.githubusercontent.com/LasseSLambertsen/proxmiu/$commit/scripts/install-host-updater.py" -o "$setup_file"',
    `python3 -I "$setup_file" --ref "$commit" --public-key '${key}'`,
  ].join('\n')
}

export function createHostUpdates(deps: Dependencies) {
  let busy = false
  const identify = (clusterId: string, node: string) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(clusterId) || !updaterNode.safeParse(node).success) error('Invalid updater target.', 400)
    return `${clusterId}/${node}`
  }
  const save = (state: UpdatersState) => {
    try { deps.save(state) } catch { error('Could not save updater state. Check agent storage.', 500) }
  }
  const online = async (id: string, node: string) => {
    try { await deps.online(id, node) } catch { error('Verify the connection and selected online Proxmox node before starting an operation.', 502) }
  }
  const exclusive = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (busy) error('An updater request is active. Wait briefly and refresh.')
    busy = true
    try { return await fn() } finally { busy = false }
  }
  const targetFor = (state: UpdatersState, key: string) => state.targets[key] ?? error('Prepare restricted updater access first.', 404)
  const requireIdle = (state: UpdatersState) => {
    if (state.reservation) error('A host update is active or unresolved. Recover its status before another operation.')
  }
  const configuration = (target: Target): UpdaterTransportConfig => {
    if (!target.configuration) error('Verify restricted updater access first.')
    return { ...target.configuration, node: target.node, privateKey: deps.decrypt(target.privateKey) }
  }
  const publicTarget = (target: Target, state: UpdatersState) => ({
    clusterId: target.clusterId, node: target.node, publicKey: target.publicKey, revision: target.revision,
    configured: !!target.configuration,
    configuration: target.configuration ? { host: target.configuration.host, port: target.configuration.port, fingerprint: target.configuration.fingerprint } : undefined,
    info: target.info, job: target.job,
    unresolved: state.reservation?.key === `${target.clusterId}/${target.node}`,
    setupCommand: setupCommand(target.publicKey),
  })
  const acceptJob = (state: UpdatersState, target: Target, job: HostJob) => {
    target.job = job
    const key = `${target.clusterId}/${target.node}`
    const reservation = state.reservation
    const matches = reservation?.key === key && reservation.kind === job.phase &&
      (reservation.jobId ? reservation.jobId === job.id : reservation.previousLatest !== job.id)
    if (job.state === 'review' && job.plan && matches && reservation.kind === 'check') target.binding = { planId: job.plan.id, digest: job.plan.digest, revision: target.revision, keyRevision: target.keyRevision }
    if (matches) {
      reservation.jobId = job.id
      reservation.unknown = false
      if (job.state !== 'running') delete state.reservation
    }
    save(state)
  }
  const readInfo = async (state: UpdatersState, target: Target) => {
    const info = await deps.invoke(configuration(target), { action: 'inspect' })
    if (!('ready' in info) || (target.configuration?.machineIdHash && info.machineIdHash !== target.configuration.machineIdHash)) error('The enrolled machine identity changed. Inspect the host before reconnecting.', 502)
    target.info = info
    const reservation = state.reservation
    let jobId = reservation?.key === `${target.clusterId}/${target.node}` ? reservation.jobId : undefined
    if (reservation?.key === `${target.clusterId}/${target.node}` && !jobId && info.latestJobId !== reservation.previousLatest) jobId = info.latestJobId
    if (!jobId && !reservation && info.latestJobId) jobId = info.latestJobId
    if (jobId) {
      const job = await deps.invoke(configuration(target), { action: 'status', jobId })
      if (!('state' in job) || job.id !== jobId || (reservation && reservation.kind !== job.phase)) error('The host operation could not be reconciled. Inspect its status locally.', 502)
      if (!state.reservation && job.state === 'running') state.reservation = { key: `${target.clusterId}/${target.node}`, kind: job.phase, jobId, unknown: false }
      acceptJob(state, target, job)
    } else save(state)
    return info
  }

  const service = {
    list: () => { const state = deps.load(); return Object.values(state.targets).map(t => publicTarget(t, state)) },
    assertConnectionMutable(clusterId: string) {
      const state = deps.load()
      if (busy || state.reservation?.key.startsWith(`${clusterId}/`)) error('A host update is active or unresolved for this connection.')
    },
    removeConnection(clusterId: string) {
      service.assertConnectionMutable(clusterId)
      const state = deps.load()
      for (const [key, target] of Object.entries(state.targets)) if (target.clusterId === clusterId) delete state.targets[key]
      save(state)
    },
    setup: (clusterId: string, node: string) => exclusive(async () => {
      const key = identify(clusterId, node)
      const state = deps.load()
      requireIdle(state)
      await online(clusterId, node)
      if (!state.targets[key]) {
        const pair = ssh2.utils.generateKeyPairSync('ed25519', { comment: 'proxmiu-host-updater' })
        state.targets[key] = { clusterId, node, publicKey: pair.public.trim(), privateKey: deps.encrypt(pair.private), revision: randomUUID(), keyRevision: randomUUID() }
        save(state)
      }
      return publicTarget(state.targets[key], state)
    }),
    configure: (clusterId: string, node: string, body: unknown) => exclusive(async () => {
      const key = identify(clusterId, node), state = deps.load(), input = configSchema.safeParse(body)
      if (!input.success) error('Invalid updater configuration.', 400)
      requireIdle(state)
      const target = targetFor(state, key)
      if (input.data.revision !== target.revision) error('Updater settings changed. Reload this page.')
      await online(clusterId, node)
      const { revision: _revision, ...candidate } = input.data
      const result = await deps.invoke({ ...candidate, privateKey: deps.decrypt(target.privateKey), node }, { action: 'inspect' })
      if (!('ready' in result) || !/^[a-f0-9]{64}$/.test(result.machineIdHash)) error('The helper machine identity could not be verified.', 502)
      if (target.configuration && target.configuration.machineIdHash !== result.machineIdHash) error('The enrolled machine identity changed. Forget and manually revoke old access before enrolling another machine.')
      target.configuration = { ...candidate, machineIdHash: result.machineIdHash }
      target.info = result; target.revision = randomUUID(); delete target.binding
      save(state)
      await readInfo(state, target)
      return publicTarget(target, state)
    }),
    info: (clusterId: string, node: string) => exclusive(async () => {
      const state = deps.load(), target = targetFor(state, identify(clusterId, node))
      if (target.configuration) await readInfo(state, target)
      return publicTarget(target, state)
    }),
    status: (clusterId: string, node: string, jobId: string) => exclusive(async () => {
      const key = identify(clusterId, node), state = deps.load(), target = targetFor(state, key)
      if (!updaterId.safeParse(jobId).success || (target.job?.id !== jobId && state.reservation?.jobId !== jobId)) error('This updater job is not bound to the selected target.', 404)
      const job = await deps.invoke(configuration(target), { action: 'status', jobId })
      if (!('state' in job) || job.id !== jobId) error('Invalid host update status.', 502)
      acceptJob(state, target, job)
      return job
    }),
    forget: (clusterId: string, node: string, body: unknown) => exclusive(async () => {
      const key = identify(clusterId, node), state = deps.load()
      const parsed = z.object({ confirmNode: z.literal(node) }).strict().safeParse(body)
      if (!parsed.success) error('Type the node name to confirm forgetting updater access.', 400)
      requireIdle(state)
      delete state.targets[key]
      save(state)
      return { ok: true, message: 'Local access forgotten. Manually remove this dedicated key from the host authorized_keys file to revoke it.' }
    }),
    check: (clusterId: string, node: string) => admit(clusterId, node, 'check'),
    apply: (clusterId: string, node: string, body: unknown) => admit(clusterId, node, 'apply', body),
  }
  const admit = (clusterId: string, node: string, kind: 'check' | 'apply', body?: unknown) => exclusive(async () => {
    const key = identify(clusterId, node), state = deps.load(), target = targetFor(state, key)
    requireIdle(state)
    let request: HostRequest = { action: 'check' }
    if (kind === 'apply') {
      const parsed = applySchema.safeParse(body)
      if (!parsed.success || parsed.data.confirmNode !== node) error('Type the node name to confirm the reviewed installation.', 400)
      const { planId, digest } = parsed.data, binding = target.binding
      if (!binding || binding.planId !== planId || binding.digest !== digest || binding.revision !== target.revision || binding.keyRevision !== target.keyRevision) error('The plan review changed or expired. Check updates again.')
      request = { action: 'apply', planId, digest }
    }
    await online(clusterId, node)
    const info = await readInfo(state, target)
    requireIdle(state)
    if (!info.ready) error(info.reason?.message ?? 'The host needs administrator attention before managed updates.')
    state.reservation = { key, kind, previousLatest: info.latestJobId, unknown: true }
    // Consuming the local binding before contact prevents retries after a lost reply.
    if (kind === 'apply') delete target.binding
    save(state)
    try {
      const job = await deps.invoke(configuration(target), request)
      if (!('state' in job) || job.phase !== kind) throw new HostUpdaterError(undefined, true)
      acceptJob(state, target, job)
      return job
    } catch (cause) {
      if (cause instanceof HostUpdaterError && (!cause.sent || cause.rejected)) {
        delete state.reservation
        save(state)
      }
      if (cause instanceof HostUpdaterError) throw cause
      error('Host update contact was lost. Recover status before starting another operation.', 502)
    }
  })
  return service
}
