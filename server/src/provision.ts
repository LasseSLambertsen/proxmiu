import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ipForMac } from './network.js'
import { guestIp, ProxmoxClient, sleep } from './proxmox.js'
import { runScript, waitForSsh } from './ssh.js'
import { store } from './store.js'
import { buildScript, getTemplate, type TemplateDef } from './templates.js'

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

type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'
export interface Job {
  id: string
  title: string
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

const secretValues = (req: ProvisionRequest) =>
  [req.password, ...Object.values(req.options).filter((v): v is string => typeof v === 'string' && v.length >= 6)].filter(
    (v): v is string => !!v,
  )

function log(job: Job, req: ProvisionRequest, line: string) {
  let clean = line
  for (const s of secretValues(req)) clean = clean.split(s).join('••••••')
  job.log.push(clean)
  if (job.log.length > 5000) job.log.splice(0, job.log.length - 5000)
}

async function step<T>(job: Job, id: string, fn: () => Promise<T>): Promise<T> {
  const s = job.steps.find((s) => s.id === id)!
  s.status = 'running'
  const out = await fn()
  s.status = 'done'
  return out
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
        unprivileged: true,
        features: template.nesting ? 'nesting=1' : undefined,
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
      const env: Record<string, string> = { PM_USER: user, PM_HOSTNAME: req.hostname, PM_SSH_KEYS: keys }
      if (req.password) env.PM_PASSWORD = req.password
      for (const opt of template.options) {
        const v = req.options[opt.key] ?? opt.default
        if (opt.type === 'boolean') env[`OPT_${opt.key}`] = v ? '1' : '0'
        else if (typeof v === 'string' && v) env[`OPT_${opt.key}`] = v
      }
      const code = await runScript(conn, buildScript(template, env), { sudo: sshUser !== 'root', onLine: say })
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
