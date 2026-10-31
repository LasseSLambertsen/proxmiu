import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ipForMac } from './network.js'
import { guestIp, ProxmoxClient, sleep, type ClusterResource } from './proxmox.js'
import { runScript, waitForSsh } from './ssh.js'
import { store } from './store.js'
import { buildCommunityScript, fetchGitHubScript, resolveCommunityScript } from './template-sources.js'
import { buildScript, buildUpdateScript, getTemplate, type TemplateDef } from './templates.js'

export const provisionSchema = z.object({
  clusterId: z.string(),
  node: z.string(),
  templateId: z.string(),
  kind: z.enum(['lxc', 'qemu']),
  hostname: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/, 'Hostname may contain letters, digits and dashes'),
  vmid: z.number().int().min(100).optional(),
  cores: z.number().int().min(1),
  memory: z.number().int().min(128),
  disk: z.number().int().min(1),
  swap: z.number().int().min(0).default(512),
  storage: z.string(),
  bridge: z.string().default('vmbr0'),
  vlan: z.number().int().min(1).max(4094).optional(),
  ipMode: z.enum(['dhcp', 'static']).default('dhcp'),
  ipCidr: z.string().optional(),
  gateway: z.string().optional(),
  /** LXC: a volid ("local:vztmpl/...") or an appliance template name to download */
  osTemplate: z.string().optional(),
  templateStorage: z.string().optional(),
  /** QEMU: VMID of a cloud-init enabled VM template to clone */
  sourceVmid: z.number().int().optional(),
  password: z.string().optional(),
  sshKeys: z.string().optional(),
  onboot: z.boolean().default(true),
  options: z.record(z.string(), z.union([z.string(), z.boolean()])).default({}),
})
export type ProvisionRequest = z.infer<typeof provisionSchema>

export const updateSchema = z.object({
  clusterId: z.string(),
  node: z.string().regex(/^[\w.-]+$/),
  type: z.enum(['lxc', 'qemu']),
  vmid: z.number().int(),
})
export type UpdateRequest = z.infer<typeof updateSchema>

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export interface Job {
  id: string
  title: string
  kind?: 'provision' | 'update'
  templateId: string
  clusterId: string
  status: 'running' | 'success' | 'error'
  createdAt: string
  finishedAt?: string
  steps: { id: string; label: string; status: StepStatus }[]
  log: string[]
  error?: string
  result?: { vmid: number; node: string; type: 'lxc' | 'qemu'; hostname: string; ip?: string; user: string; notes: string }
}

const jobs = new Map<string, Job>()
export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
export const getJob = (id: string) => jobs.get(id)

export function startProvision(req: ProvisionRequest): Job {
  const template = getTemplate(req.templateId)
  const steps =
    req.kind === 'lxc'
      ? [['prepare', 'Prepare'], ['os', 'OS template'], ['create', 'Create container'], ['start', 'Start'], ['network', 'Wait for network'], ['provision', `Install ${template.name}`]]
      : [['prepare', 'Prepare'], ['create', 'Clone VM'], ['configure', 'Configure cloud-init'], ['start', 'Start'], ['network', 'Wait for network'], ['provision', `Install ${template.name}`]]
  const job: Job = {
    id: randomUUID(),
    title: `${template.name} → ${req.hostname}`,
    kind: 'provision',
    templateId: template.id,
    clusterId: req.clusterId,
    status: 'running',
    createdAt: new Date().toISOString(),
    steps: steps.map(([id, label]) => ({ id, label, status: 'pending' })),
    log: [],
  }
  jobs.set(job.id, job)
  // Keep memory bounded.
  for (const old of listJobs().slice(50)) jobs.delete(old.id)

  run(job, req, template).catch((err: Error) => {
    job.status = 'error'
    job.error = err.message
    job.finishedAt = new Date().toISOString()
    for (const s of job.steps) if (s.status === 'running') s.status = 'error'
    log(job, req, `ERROR: ${err.message}`)
  })
  return job
}

function templateFromTags(tags?: string) {
  for (const tag of (tags ?? '').split(/[;,]/).map((t) => t.trim())) {
    if (!tag || tag === 'proxmiu') continue
    try {
      return getTemplate(tag)
    } catch {
      /* another Proxmox tag, not a template */
    }
  }
  return undefined
}

export async function startUpdate(req: UpdateRequest): Promise<Job> {
  const client = ProxmoxClient.fromRecord(store.getCluster(req.clusterId))
  const resources = await client.get<ClusterResource[]>('/cluster/resources', { type: 'vm' })
  const guest = resources.find((g) => g.vmid === req.vmid && g.type === req.type && g.node === req.node)
  if (!guest) throw Object.assign(new Error('Guest not found on that node'), { statusCode: 404 })
  if (guest.template) throw new Error('This is a template, not a running guest.')
  if (guest.status !== 'running') throw new Error('Start the guest before updating it.')
  const template = templateFromTags(guest.tags)
  if (!template) {
    throw Object.assign(new Error('This guest was not created from a Proxmiu template, or that template no longer exists.'), { statusCode: 404 })
  }

  const job: Job = {
    id: randomUUID(),
    title: `Update ${template.name} → ${guest.name ?? req.vmid}`,
    kind: 'update',
    templateId: template.id,
    clusterId: req.clusterId,
    status: 'running',
    createdAt: new Date().toISOString(),
    steps: [
      { id: 'network', label: 'Find guest address', status: 'pending' },
      { id: 'update', label: `Update ${template.name}`, status: 'pending' },
    ],
    log: [],
  }
  jobs.set(job.id, job)
  for (const old of listJobs().slice(50)) jobs.delete(old.id)

  runUpdate(job, req, template, guest).catch((err: Error) => {
    job.status = 'error'
    job.error = err.message
    job.finishedAt = new Date().toISOString()
    for (const s of job.steps) if (s.status === 'running') s.status = 'error'
    logLine(job, `ERROR: ${err.message}`)
  })
  return job
}

const secretValues = (req: ProvisionRequest) =>
  [req.password, ...Object.values(req.options).filter((v): v is string => typeof v === 'string' && v.length >= 6)].filter(
    (v): v is string => !!v,
  )

function logLine(job: Job, line: string) {
  job.log.push(line)
  if (job.log.length > 5000) job.log.splice(0, job.log.length - 5000)
}

function log(job: Job, req: ProvisionRequest, line: string) {
  let clean = line
  for (const s of secretValues(req)) clean = clean.split(s).join('••••••')
  logLine(job, clean)
}

async function step<T>(job: Job, id: string, fn: () => Promise<T>): Promise<T> {
  const s = job.steps.find((s) => s.id === id)!
  s.status = 'running'
  const out = await fn()
  s.status = 'done'
  return out
}

function optionEnv(template: TemplateDef, options: Record<string, string | boolean>) {
  const community = template.source?.type === 'community-scripts'
  const env: Record<string, string> = {}
  for (const opt of template.options) {
    const value = options[opt.key] ?? opt.default
    if (value === undefined) continue
    const name = opt.env ?? (community ? `var_${opt.key.toLowerCase()}` : `OPT_${opt.key}`)
    if (opt.type === 'boolean') env[name] = community ? (value ? 'yes' : 'no') : value ? '1' : '0'
    else if (typeof value === 'string' && value) env[name] = value
  }
  return env
}

async function templateBody(template: TemplateDef, say: (line: string) => void) {
  if (template.source?.type !== 'github') return template.script
  try {
    say(`Fetching the install script from ${template.source.repo}/${template.source.path}…`)
    return await fetchGitHubScript(template.source)
  } catch (err) {
    if (!template.script.trim()) throw err
    say(`WARNING: ${(err as Error).message}. Using the copy embedded in the template.`)
    return template.script
  }
}

async function renderInstallScript(template: TemplateDef, env: Record<string, string>, say: (line: string) => void) {
  if (template.source?.type === 'community-scripts') {
    say(`Fetching ${template.name} from Community Scripts…`)
    const resolved = await resolveCommunityScript(template.source.slug, template.source.ref)
    return buildCommunityScript(template, env, resolved)
  }
  return buildScript(template, env, await templateBody(template, say))
}

async function renderUpdateScript(template: TemplateDef, env: Record<string, string>, say: (line: string) => void) {
  if (template.source?.type === 'community-scripts') {
    say('Running the Community Scripts update entrypoint…')
    return [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'export PHS_SILENT=1 MODE=default TERM=dumb DEBIAN_FRONTEND=noninteractive',
      'if [ ! -x /usr/bin/update ]; then echo "ERROR: /usr/bin/update is missing; recreate this guest to enable updates." >&2; exit 1; fi',
      '/usr/bin/update < /dev/null',
      '',
    ].join('\n')
  }
  return buildUpdateScript(template, env, await templateBody(template, say))
}


async function run(job: Job, req: ProvisionRequest, template: TemplateDef) {
  const client = ProxmoxClient.fromRecord(store.getCluster(req.clusterId))
  const say = (line: string) => log(job, req, line)
  const appKey = store.sshKey().public
  const keys = [appKey, ...(req.sshKeys ?? '').split('\n').map((k) => k.trim()).filter(Boolean)].join('\n')
  const user = template.user
  const vlanTag = req.vlan ? `,tag=${req.vlan}` : ''
  const staticIp = req.ipMode === 'static' ? req.ipCidr?.split('/')[0] : undefined
  if (req.ipMode === 'static' && !req.ipCidr?.includes('/')) throw new Error('Static IP must be in CIDR form, e.g. 192.168.1.50/24')

  let node = req.node
  const vmid = await step(job, 'prepare', async () => {
    const id = req.vmid ?? Number(await client.get<string>('/cluster/nextid'))
    say(`Using VMID ${id} on node ${node}`)
    return id
  })

  if (req.kind === 'lxc') {
    const ostemplate = await step(job, 'os', () => resolveOsTemplate(client, node, req, template, say))
    const features = [template.nesting ? 'nesting=1' : undefined, template.source?.type === 'community-scripts' && !template.privileged ? 'keyctl=1' : undefined]
      .filter(Boolean)
      .join(',')
    await step(job, 'create', async () => {
      const ip = req.ipMode === 'static' ? `ip=${req.ipCidr}${req.gateway ? `,gw=${req.gateway}` : ''}` : 'ip=dhcp'
      const upid = await client.post<string>(`/nodes/${node}/lxc`, {
        vmid,
        hostname: req.hostname,
        ostemplate,
        cores: req.cores,
        memory: req.memory,
        swap: req.swap,
        rootfs: `${req.storage}:${req.disk}`,
        net0: `name=eth0,bridge=${req.bridge},${ip}${vlanTag}`,
        unprivileged: !template.privileged,
        features: features || undefined,
        'ssh-public-keys': keys,
        onboot: req.onboot,
        tags: `proxmiu;${template.id}`,
        description: `Created by proxmiu from template "${template.name}"`,
      })
      await client.waitForTask(node, upid, { onProgress: say })
    })
    await step(job, 'start', async () => {
      await client.waitForTask(node, await client.post<string>(`/nodes/${node}/lxc/${vmid}/status/start`))
    })
  } else {
    if (!req.sourceVmid) throw new Error('Pick a cloud-init VM template to clone')
    await step(job, 'create', async () => {
      const resources = await client.get<{ vmid: number; node: string; type: string }[]>('/cluster/resources', { type: 'vm' })
      const src = resources.find((r) => r.vmid === req.sourceVmid)
      if (!src) throw new Error(`VM template ${req.sourceVmid} not found`)
      node = src.node
      say(`Cloning VM ${req.sourceVmid} on ${node}`)
      const upid = await client.post<string>(`/nodes/${node}/qemu/${req.sourceVmid}/clone`, {
        newid: vmid,
        name: req.hostname,
        full: true,
        storage: req.storage,
      })
      await client.waitForTask(node, upid, { onProgress: say, timeoutMs: 30 * 60_000 })
    })
    await step(job, 'configure', async () => {
      const ip = req.ipMode === 'static' ? `ip=${req.ipCidr}${req.gateway ? `,gw=${req.gateway}` : ''}` : 'ip=dhcp'
      await client.post(`/nodes/${node}/qemu/${vmid}/config`, {
        cores: req.cores,
        memory: req.memory,
        ciuser: user,
        cipassword: req.password,
        // Proxmox expects sshkeys URL-encoded on top of the form encoding.
        sshkeys: encodeURIComponent(keys),
        ipconfig0: ip,
        agent: 'enabled=1',
        onboot: req.onboot,
        tags: `proxmiu;${template.id}`,
      })
      const config = await client.get<Record<string, string>>(`/nodes/${node}/qemu/${vmid}/config`)
      const net0 = config.net0 ?? ''
      if ((req.bridge && !net0.includes(`bridge=${req.bridge}`)) || req.vlan) {
        const model = net0.split(',')[0] || 'virtio'
        await client.post(`/nodes/${node}/qemu/${vmid}/config`, { net0: `${model},bridge=${req.bridge}${vlanTag}` })
      }
      const disk = ['scsi0', 'virtio0', 'sata0', 'ide0'].find((d) => config[d] && !config[d].includes('media=cdrom'))
      if (disk) {
        try {
          await client.put(`/nodes/${node}/qemu/${vmid}/resize`, { disk, size: `${req.disk}G` })
          say(`Resized ${disk} to ${req.disk}G`)
        } catch (err) {
          say(`Skipped disk resize: ${(err as Error).message}`)
        }
      }
    })
    await step(job, 'start', async () => {
      await client.waitForTask(node, await client.post<string>(`/nodes/${node}/qemu/${vmid}/status/start`))
    })
  }

  const ip = await step(job, 'network', async () => {
    if (staticIp) return staticIp
    say('Waiting for the guest to get an address via DHCP…')
    const deadline = Date.now() + 5 * 60_000
    let mac: string | undefined
    for (let attempt = 0; Date.now() < deadline; attempt++) {
      const found = await guestIp(client, node, req.kind, vmid).catch(() => undefined)
      if (found) return found
      // VM images without the guest agent: fall back to finding the NIC's MAC in our ARP table.
      if (req.kind === 'qemu' && attempt % 5 === 4) {
        mac ??= /([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i.exec((await client.get<Record<string, string>>(`/nodes/${node}/qemu/${vmid}/config`)).net0 ?? '')?.[1]
        const viaArp = mac && (await ipForMac(mac))
        if (viaArp) return viaArp
      }
      await sleep(3000)
    }
    throw new Error('The guest never reported an IP address. Check that the bridge has DHCP, or use a static IP.')
  })
  say(`Guest address: ${ip}`)
  store.rememberSshUser(ip, user)

  await step(job, 'provision', async () => {
    const sshUser = req.kind === 'lxc' ? 'root' : user
    say(`Connecting over SSH as ${sshUser}@${ip}…`)
    const conn = await waitForSsh({ host: ip, username: sshUser, useAppKey: true })
    try {
      const env: Record<string, string> = { PM_USER: user, PM_HOSTNAME: req.hostname, PM_SSH_KEYS: keys, ...optionEnv(template, req.options) }
      if (req.password) env.PM_PASSWORD = req.password
      const script = await renderInstallScript(template, env, say)
      const code = await runScript(conn, script, { sudo: sshUser !== 'root', onLine: say })
      if (code !== 0) throw new Error(`Provisioning script exited with code ${code}`)
    } finally {
      conn.end()
    }
  })

  job.result = {
    vmid,
    node,
    type: req.kind,
    hostname: req.hostname,
    ip,
    user,
    notes: template.notes.replaceAll('{ip}', ip).replaceAll('{user}', user).replaceAll('{hostname}', req.hostname),
  }
  job.status = 'success'
  job.finishedAt = new Date().toISOString()
  say('All done.')
}

async function runUpdate(job: Job, req: UpdateRequest, template: TemplateDef, guest: ClusterResource) {
  const client = ProxmoxClient.fromRecord(store.getCluster(req.clusterId))
  const say = (line: string) => logLine(job, line)

  const ip = await step(job, 'network', async () => {
    say('Looking for the guest address…')
    const known = await guestIp(client, req.node, req.type, req.vmid).catch(() => undefined)
    if (known) return known
    if (req.type === 'qemu') {
      const config = await client.get<Record<string, string>>(`/nodes/${req.node}/qemu/${req.vmid}/config`)
      const mac = /([0-9A-F]{2}(?::[0-9A-F]{2}){5})/i.exec(config.net0 ?? '')?.[1]
      if (mac) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const found = await ipForMac(mac)
          if (found) return found
          await sleep(3000)
        }
      }
    }
    throw new Error('Could not find the guest IP address. Check that it is running and reachable from the agent.')
  })
  say(`Guest address: ${ip}`)

  await step(job, 'update', async () => {
    const user = req.type === 'lxc' ? 'root' : (store.sshUser(ip) ?? template.user)
    store.rememberSshUser(ip, user)
    say(`Connecting over SSH as ${user}@${ip}…`)
    const conn = await waitForSsh({ host: ip, username: user, useAppKey: true })
    try {
      const env: Record<string, string> = { PM_USER: user, PM_HOSTNAME: guest.name ?? String(req.vmid), ...optionEnv(template, {}) }
      const script = await renderUpdateScript(template, env, say)
      const code = await runScript(conn, script, { sudo: user !== 'root', onLine: say })
      if (code !== 0) throw new Error(`Update script exited with code ${code}`)
    } finally {
      conn.end()
    }
  })

  job.status = 'success'
  job.finishedAt = new Date().toISOString()
  say('Update finished.')
}

async function resolveOsTemplate(client: ProxmoxClient, node: string, req: ProvisionRequest, template: TemplateDef, say: (l: string) => void) {
  if (req.osTemplate?.includes(':')) return req.osTemplate
  const stores = await client.get<{ storage: string }[]>(`/nodes/${node}/storage`, { content: 'vztmpl', enabled: 1 })
  if (!stores.length) throw new Error(`Node ${node} has no storage that can hold container templates (content "vztmpl")`)
  const wanted = req.osTemplate ? [req.osTemplate] : template.os

  const local: string[] = []
  for (const s of stores) {
    const content = await client.get<{ volid: string }[]>(`/nodes/${node}/storage/${s.storage}/content`, { content: 'vztmpl' })
    local.push(...content.map((c) => c.volid))
  }
  const base = (volid: string) => volid.split('/').pop() ?? volid
  for (const prefix of wanted) {
    const hit = local.filter((v) => base(v).startsWith(prefix)).sort().pop()
    if (hit) {
      say(`Using existing OS template ${hit}`)
      return hit
    }
  }

  const available = await client.get<{ template: string; section: string }[]>(`/nodes/${node}/aplinfo`)
  for (const prefix of wanted) {
    const name = available.map((a) => a.template).filter((t) => t.startsWith(prefix)).sort().pop()
    if (!name) continue
    const target = req.templateStorage ?? stores[0].storage
    say(`Downloading ${name} to ${target}…`)
    await client.waitForTask(node, await client.post<string>(`/nodes/${node}/aplinfo`, { storage: target, template: name }), {
      onProgress: say,
      timeoutMs: 20 * 60_000,
    })
    return `${target}:vztmpl/${name}`
  }
  throw new Error(`None of the OS templates ${wanted.join(', ')} are available on ${node}`)
}
