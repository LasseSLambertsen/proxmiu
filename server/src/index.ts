import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { guestInsightsParamsSchema, guestInsightsQuerySchema, guestMetadataParamsSchema, guestMetadataPatchSchema, loadGuestInsights } from './guest-insights.js'
import { discoverProxmox, localSubnets } from './network.js'
import { getJob, listJobs, provisionSchema, startProvision, startUpdate, updateSchema } from './provision.js'
import { forgetClient, guestIp, ProxmoxClient, type ClusterResource } from './proxmox.js'
import { handleTerminalSocket } from './ssh.js'
import { sign, store } from './store.js'
import { selfUpdateInfo, startSelfUpdate } from './self-update.js'
import { allTemplates, builtinTemplates, templateSchema } from './templates.js'
import { communityScriptTemplate, listCommunityScripts } from './template-sources.js'
import { tlsOptions } from './tls.js'
import { loadNotes, saveNotes, notesSchema, loadOperations, runOperation, operationSchema, readTask } from './guest-operations.js'
import { aiSettingsSchema, buildAiContext, reviewSchema, reviewSetup, chatSchema, chatWithLynx, AiRequestGate } from './ai.js'
import { loadResourceSettings, saveResourceSettings, resourceSettingsSchema } from './guest-resource-settings.js'
import { backupQuerySchema, taskLogQuerySchema, loadGuestBackups, loadTaskLog } from './guest-maintenance.js'
import { loadTaskHistory, taskHistoryQuerySchema, TaskHistoryAccess } from './task-history.js'

const VERSION = '0.2.0'
const PASSWORD = process.env.PROXMIU_PASSWORD
const HOST = process.env.HOST ?? (PASSWORD ? '0.0.0.0' : '127.0.0.1')
const PORT = Number(process.env.PORT ?? 8787)
const historyAccess = new TaskHistoryAccess()
/** Origins of hosted UIs (e.g. a Vercel or Netlify deployment) allowed to talk to this agent. */
const ALLOWED_ORIGINS = new Set(
  (process.env.PROXMIU_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
)
const isLoopback = (h: string) => h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]'

if (!PASSWORD && process.env.PROXMIU_ALLOW_NO_AUTH !== '1') {
  if (!isLoopback(HOST)) {
    console.error(
      `Refusing to listen on ${HOST} without a password: anyone on the network could control your Proxmox hosts.\n` +
        'Set PROXMIU_PASSWORD, or PROXMIU_ALLOW_NO_AUTH=1 if you really mean it.',
    )
    process.exit(1)
  }
  if (ALLOWED_ORIGINS.size) {
    console.error('PROXMIU_ALLOWED_ORIGINS lets a hosted UI use this agent, so PROXMIU_PASSWORD is required as well.')
    process.exit(1)
  }
}

const tls = await tlsOptions()
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, routerOptions: { maxParamLength: 2048 }, ...(tls ? { https: tls } : {}) })

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof z.ZodError) {
    return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') })
  }
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500
  if (status >= 500) app.log.error(err)
  reply.status(status).send({ error: err.message })
})

// --- cross-origin access --------------------------------------------------------

/** Same-origin requests, and requests from origins listed in PROXMIU_ALLOWED_ORIGINS. */
function originAllowed(req: FastifyRequest) {
  const origin = req.headers.origin
  if (!origin) return true
  if (ALLOWED_ORIGINS.has(origin)) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// Chrome asks before a public site may reach a private address; this answers its preflight.
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network'] && originAllowed(req)) {
    reply.header('Access-Control-Allow-Private-Network', 'true')
  }
})
await app.register(cors, {
  origin: (origin, cb) => cb(null, !!origin && ALLOWED_ORIGINS.has(origin)),
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600,
})
await app.register(websocket)

// --- auth -------------------------------------------------------------------------

const TOKEN_TTL_MS = 30 * 86400_000
const hash = (s: string) => createHash('sha256').update(s).digest()

/** Stateless session tokens ("<expiry>.<hmac>"), so sessions survive agent restarts. */
const issueToken = () => {
  const payload = String(Date.now() + TOKEN_TTL_MS)
  return `${payload}.${sign(`session:${payload}`)}`
}
function tokenValid(token?: string | null) {
  if (!PASSWORD) return true
  const [payload, mac] = (token ?? '').split('.')
  if (!payload || !mac || Number(payload) < Date.now()) return false
  const expected = Buffer.from(sign(`session:${payload}`))
  const given = Buffer.from(mac)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
const bearer = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer\s+/i, '')

app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/') || req.method === 'OPTIONS') return
  // Without a password the agent only listens on loopback; insist on a loopback Host too, which blocks DNS rebinding.
  if (!PASSWORD && !isLoopback(req.hostname)) return reply.status(403).send({ error: 'Host not allowed' })
  if (!originAllowed(req)) return reply.status(403).send({ error: `Origin ${req.headers.origin} is not allowed. Add it to PROXMIU_ALLOWED_ORIGINS.` })
  if (req.url === '/api/health' || req.url.startsWith('/api/auth/') || req.url.startsWith('/api/ssh?') || req.url === '/api/ssh') return
  if (!tokenValid(bearer(req))) return reply.status(401).send({ error: 'Not logged in' })
})

app.get('/api/health', async () => ({ name: 'proxmiu-agent', version: VERSION, authRequired: !!PASSWORD }))

app.get('/api/auth/status', async (req) => ({ authRequired: !!PASSWORD, authenticated: tokenValid(bearer(req)) }))

app.post('/api/auth/login', async (req, reply) => {
  const { password } = z.object({ password: z.string() }).parse(req.body)
  if (!PASSWORD || !timingSafeEqual(hash(password), hash(PASSWORD))) {
    await new Promise((r) => setTimeout(r, 750))
    return reply.status(401).send({ error: 'Wrong password' })
  }
  return { token: issueToken() }
})

// --- connections ------------------------------------------------------------

const connectionSchema = z.object({
  name: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().default(8006),
  authType: z.enum(['token', 'password']),
  username: z.string().min(1),
  secret: z.string().min(1),
  verifyTls: z.boolean().default(false),
})

async function probe(conn: z.infer<typeof connectionSchema>) {
  const client = new ProxmoxClient(conn)
  const version = await client.get<{ version: string; release: string }>('/version')
  const status = await client.get<{ type: string; name: string }[]>('/cluster/status').catch(() => [])
  const nodes = await client.get<{ node: string; status: string }[]>('/nodes')
  const clusterName = status.find((s) => s.type === 'cluster')?.name
  return { version: version.version, clusterName, nodes: nodes.map((n) => ({ node: n.node, status: n.status })) }
}

const publicCluster = (c: ReturnType<typeof store.getCluster>) => {
  const { secret: _secret, ...rest } = c
  return rest
}

app.get('/api/clusters', async () => store.listClusters().map(publicCluster))

app.post('/api/clusters/test', async (req) => probe(connectionSchema.parse(req.body)))

app.post('/api/clusters', async (req) => {
  const input = connectionSchema.parse(req.body)
  const info = await probe(input)
  const rec = store.addCluster({ ...input, name: input.name || info.clusterName || info.nodes[0]?.node || input.host })
  return publicCluster(rec)
})

app.delete<{ Params: { id: string } }>('/api/clusters/:id', async (req) => {
  store.removeCluster(req.params.id)
  historyAccess.removeConnection(req.params.id)
  forgetClient(req.params.id)
  return { ok: true }
})

const clientFor = (id: string) => ProxmoxClient.fromRecord(store.getCluster(id))

app.get('/api/guest-metadata', async () => store.listGuestMetadata())

app.put('/api/guest-metadata/:id/:type/:vmid', async (req) => {
  const p = guestMetadataParamsSchema.parse(req.params)
  const patch = guestMetadataPatchSchema.parse(req.body)
  if (patch.notes !== undefined) return reqNotesMoved()
  return store.updateGuestMetadata(p.id, p.type, p.vmid, patch)
})

function reqNotesMoved(): never {
  throw Object.assign(new Error('Notes now use the Proxmox description. Update this UI and save notes from the guest workspace.'), { statusCode: 400 })
}

app.get('/api/clusters/:id/guests/:node/:type/:vmid/notes', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  const notes = await loadNotes(clientFor(p.id), p)
  const legacyNotes = store.listGuestMetadata()[`${p.id}/${p.type}/${p.vmid}`]?.notes
  return { ...notes, ...(legacyNotes ? { legacyNotes } : {}) }
})

app.put('/api/clusters/:id/guests/:node/:type/:vmid/notes', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  return saveNotes(clientFor(p.id), p, notesSchema.parse(req.body))
})

app.get('/api/clusters/:id/guests/:node/:type/:vmid/resource-settings', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  return loadResourceSettings(clientFor(p.id), p)
})

app.put('/api/clusters/:id/guests/:node/:type/:vmid/resource-settings', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  return saveResourceSettings(clientFor(p.id), p, resourceSettingsSchema.parse(req.body))
})

app.get('/api/clusters/:id/guests/:node/:type/:vmid/operations', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  return loadOperations(clientFor(p.id), p)
})

app.get('/api/clusters/:id/guests/:node/:type/:vmid/backups', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  const { storage } = backupQuerySchema.parse(req.query)
  return loadGuestBackups(clientFor(p.id), p, storage)
})

app.get('/api/clusters/:id/task-history', async (req) => {
  const { id } = z.object({ id: guestMetadataParamsSchema.shape.id }).parse(req.params)
  const { node, ...query } = taskHistoryQuerySchema.parse(req.query)
  const page = await loadTaskHistory(clientFor(id), node, query)
  historyAccess.remember(id, node, page.tasks)
  return page
})

// Only locally started tasks or tasks returned by validated native history are eligible.
const operationTasks = new Map<string, number>()
const taskKey = (id: string, node: string, upid: string) => JSON.stringify([id, node, upid])
app.post('/api/clusters/:id/guests/:node/:type/:vmid/operations', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  const op = operationSchema.parse(req.body)
  const result = await runOperation(clientFor(p.id), p, op)
  for (const [key, at] of operationTasks) if (Date.now() - at > 7 * 86400_000) operationTasks.delete(key)
  if (operationTasks.size >= 1000) operationTasks.delete(operationTasks.keys().next().value!)
  operationTasks.set(taskKey(p.id, result.node, result.upid), Date.now())
  return result
})

const taskParamsSchema = z.object({ id: z.string().min(1).max(200).regex(/^[\w-]+$/), node: z.string().min(1).max(253).regex(/^[\w][\w.-]*$/), upid: z.string().startsWith('UPID:').max(1024).refine(s => !/[\/\r\n]/.test(s)) })
app.get('/api/clusters/:id/tasks/:node/:upid', async (req, reply) => {
  const p = taskParamsSchema.parse(req.params)
  if (!operationTasks.has(taskKey(p.id, p.node, p.upid)) && !historyAccess.canRead(p.id, p.node, p.upid)) return reply.status(404).send({ error: 'Task access is not current. Refresh Proxmox task history, select the task again and retry.' })
  return readTask(clientFor(p.id), p.node, p.upid)
})

app.get('/api/clusters/:id/tasks/:node/:upid/log', async (req, reply) => {
  const p = taskParamsSchema.parse(req.params)
  const { start } = taskLogQuerySchema.parse(req.query)
  if (!operationTasks.has(taskKey(p.id, p.node, p.upid)) && !historyAccess.canRead(p.id, p.node, p.upid)) return reply.status(404).send({ error: 'Task access is not current. Refresh Proxmox task history, select the task again and retry.' })
  return loadTaskLog(clientFor(p.id), p.node, p.upid, start)
})

app.get('/api/clusters/:id/guests/:node/:type/:vmid/insights', async (req) => {
  const p = guestInsightsParamsSchema.parse(req.params)
  const { timeframe } = guestInsightsQuerySchema.parse(req.query)
  return loadGuestInsights(clientFor(p.id), p, timeframe)
})

// --- overview & actions -------------------------------------------------------

app.get('/api/overview', async () => {
  const clusters = await Promise.all(
    store.listClusters().map(async (c) => {
      try {
        const client = clientFor(c.id)
        const [resources, status] = await Promise.all([
          client.get<ClusterResource[]>('/cluster/resources'),
          client.get<{ type: string; name: string; ip?: string }[]>('/cluster/status').catch(() => []),
        ])
        const ips = Object.fromEntries(status.filter((s) => s.type === 'node' && s.ip).map((s) => [s.name, s.ip]))
        const standalone = resources.filter((r) => r.type === 'node').length === 1
        const nodes = resources
          .filter((r) => r.type === 'node')
          .map((n) => ({ ...n, ip: standalone ? c.host : (ips[n.node!] ?? c.host) }))
        const guests = resources.filter((r) => r.type === 'qemu' || r.type === 'lxc')
        return { id: c.id, name: c.name, host: c.host, ok: true, nodes, guests }
      } catch (err) {
        return { id: c.id, name: c.name, host: c.host, ok: false, error: (err as Error).message, nodes: [], guests: [] }
      }
    }),
  )
  return { clusters }
})

const ipCache = new Map<string, { at: number; ips: Record<string, string> }>()
app.get<{ Params: { id: string } }>('/api/clusters/:id/ips', async (req) => {
  const cached = ipCache.get(req.params.id)
  if (cached && Date.now() - cached.at < 20_000) return cached.ips
  const client = clientFor(req.params.id)
  const guests = (await client.get<ClusterResource[]>('/cluster/resources', { type: 'vm' })).filter(
    (g) => g.status === 'running' && !g.template,
  )
  const ips: Record<string, string> = {}
  let next = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < guests.length) {
        const g = guests[next++]
        const ip = await guestIp(client, g.node!, g.type as 'qemu' | 'lxc', g.vmid!).catch(() => undefined)
        if (ip) ips[`${g.type}/${g.vmid}`] = ip
      }
    }),
  )
  ipCache.set(req.params.id, { at: Date.now(), ips })
  return ips
})

const guestParams = z.object({
  id: z.string(),
  node: z.string().regex(/^[\w.-]+$/),
  type: z.enum(['qemu', 'lxc']),
  vmid: z.coerce.number().int(),
})

app.post('/api/clusters/:id/guests/:node/:type/:vmid/:action', async (req) => {
  const p = guestParams.extend({ action: z.enum(['start', 'shutdown', 'stop', 'reboot']) }).parse(req.params)
  const client = clientFor(p.id)
  const upid = await client.post<string>(`/nodes/${p.node}/${p.type}/${p.vmid}/status/${p.action}`)
  ipCache.delete(p.id)
  // Give fast actions a moment so the UI refreshes into the new state; long ones continue in the background.
  await client.waitForTask(p.node, upid, { timeoutMs: 15_000 }).catch(() => undefined)
  return { upid }
})

app.delete('/api/clusters/:id/guests/:node/:type/:vmid', async (req) => {
  const p = guestParams.parse(req.params)
  const client = clientFor(p.id)
  const base = `/nodes/${p.node}/${p.type}/${p.vmid}`
  const status = await client.get<{ status: string }>(`${base}/status/current`)
  if (status.status === 'running') await client.waitForTask(p.node, await client.post<string>(`${base}/status/stop`))
  await client.waitForTask(p.node, await client.del<string>(base, { purge: 1, 'destroy-unreferenced-disks': 1 }))
  ipCache.delete(p.id)
  return { ok: true }
})

app.post('/api/clusters/:id/nodes/:node/:action', async (req) => {
  const p = z.object({ id: z.string(), node: z.string().regex(/^[\w.-]+$/), action: z.enum(['reboot', 'shutdown']) }).parse(req.params)
  await clientFor(p.id).post(`/nodes/${p.node}/status`, { command: p.action })
  return { ok: true }
})

app.get('/api/clusters/:id/create-options', async (req) => {
  const { id } = z.object({ id: z.string() }).parse(req.params)
  const q = z.object({ node: z.string().optional() }).parse(req.query)
  const client = clientFor(id)
  const resources = await client.get<ClusterResource[]>('/cluster/resources')
  const nodes = resources.filter((r) => r.type === 'node' && r.status === 'online').map((r) => r.node!)
  const node = q.node && nodes.includes(q.node) ? q.node : nodes[0]
  if (!node) throw Object.assign(new Error('No online nodes in this cluster'), { statusCode: 409 })

  type Storage = { storage: string; content: string; type: string; avail?: number; total?: number; active?: number }
  const [storages, bridges, aplinfo, nextid] = await Promise.all([
    client.get<Storage[]>(`/nodes/${node}/storage`, { enabled: 1 }),
    client.get<{ iface: string; comments?: string }[]>(`/nodes/${node}/network`, { type: 'any_bridge' }).catch(() => []),
    client.get<{ template: string; section: string; headline?: string }[]>(`/nodes/${node}/aplinfo`).catch(() => []),
    client.get<string>('/cluster/nextid'),
  ])
  const pick = (content: string) =>
    storages.filter((s) => s.content.split(',').includes(content)).map((s) => ({ storage: s.storage, type: s.type, avail: s.avail, total: s.total }))
  const local: string[] = []
  for (const s of pick('vztmpl')) {
    const content = await client.get<{ volid: string }[]>(`/nodes/${node}/storage/${s.storage}/content`, { content: 'vztmpl' }).catch(() => [])
    local.push(...content.map((c) => c.volid))
  }
  const aptBased = (name: string) => /^(debian|ubuntu)-/.test(name.split('/').pop() ?? '')
  return {
    node,
    nodes,
    nextid: Number(nextid),
    storages: { rootdir: pick('rootdir'), images: pick('images'), vztmpl: pick('vztmpl') },
    bridges: bridges.map((b) => b.iface).sort(),
    osTemplates: {
      downloaded: local.filter(aptBased),
      available: aplinfo.filter((a) => a.section === 'system' && aptBased(a.template)).map((a) => a.template).sort().reverse(),
    },
    vmTemplates: resources
      .filter((r) => r.type === 'qemu' && r.template)
      .map((r) => ({ vmid: r.vmid!, name: r.name ?? `VM ${r.vmid}`, node: r.node! })),
  }
})

// --- discovery ---------------------------------------------------------------

app.get('/api/discover', async (req) => {
  const { cidr } = z.object({ cidr: z.string().optional() }).parse(req.query)
  const subnets = localSubnets()
  const ranges = cidr ? cidr.split(',').map((c) => c.trim()).filter(Boolean) : subnets.map((s) => s.cidr)
  const hosts = await discoverProxmox(ranges)
  const known = new Set(store.listClusters().map((c) => c.host))
  return { subnets, scanned: ranges, hosts: hosts.map((h) => ({ ...h, known: known.has(h.ip) || (!!h.hostname && known.has(h.hostname)) })) }
})

// --- templates & provisioning ------------------------------------------------------

app.get('/api/templates', async () => allTemplates())

app.put<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
  const t = templateSchema.parse({ ...(req.body as object), id: req.params.id })
  if (builtinTemplates.some((b) => b.id === t.id)) {
    throw Object.assign(new Error('Built-in templates cannot be changed. Duplicate it first.'), { statusCode: 409 })
  }
  store.saveTemplate({ ...t, builtin: undefined })
  return t
})

app.delete<{ Params: { id: string } }>('/api/templates/:id', async (req) => {
  store.removeTemplate(req.params.id)
  return { ok: true }
})

app.get<{ Querystring: { q?: string } }>('/api/community-scripts', async (req) => {
  const q = req.query.q?.trim().toLowerCase()
  const scripts = await listCommunityScripts()
  return {
    scripts: q
      ? scripts.filter((s) => `${s.name} ${s.slug} ${s.description} ${s.category ?? ''}`.toLowerCase().includes(q))
      : scripts,
  }
})

app.get<{ Params: { slug: string }; Querystring: { ref?: string } }>('/api/community-scripts/:slug', async (req) => ({
  template: await communityScriptTemplate(req.params.slug, req.query.ref ?? 'main'),
}))

app.post('/api/provision', async (req) => {
  const body = provisionSchema.parse(req.body)
  store.getCluster(body.clusterId)
  return startProvision(body)
})

app.post('/api/updates', async (req) => {
  const body = updateSchema.parse(req.body)
  store.getCluster(body.clusterId)
  return startUpdate(body)
})

app.get('/api/jobs', async () => listJobs().map(({ log: _log, ...j }) => j))
app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
  const job = getJob(req.params.id)
  if (!job) return reply.status(404).send({ error: 'Unknown job' })
  return job
})

// --- settings & ssh -------------------------------------------------------------

app.get('/api/ai/settings', async () => store.aiSettings())
app.put('/api/ai/settings', async (req) => store.saveAiSettings(aiSettingsSchema.parse(req.body)))
app.delete('/api/ai/settings', async () => store.removeAiSettings())
app.get('/api/ai/context', async () => {
  const connections = store.listClusters()
  if (connections.length > 50) throw Object.assign(new Error('Review supports up to 50 connections.'), { statusCode: 400 })
  const resources = await Promise.all(connections.map(async connection => {
    try {
      return { resources: await clientFor(connection.id).get<Record<string, unknown>[]>('/cluster/resources') }
    } catch { return { error: true } }
  }))
  return buildAiContext(resources)
})

const aiRequests = new AiRequestGate()
app.post('/api/ai/review', async (req, reply) => {
  const { context } = reviewSchema.parse(req.body)
  const settings = store.aiCredentials()
  if (!context.clusters.some(c => c.nodes.length || c.guests.length)) return reply.status(400).send({ error: 'No resource readings are available. Reconnect a Proxmox host before requesting advice.' })
  return aiRequests.run('review', () => reviewSetup(settings, context))
})

app.post('/api/ai/chat', async (req) => {
  const conversation = chatSchema.parse(req.body)
  const settings = store.aiCredentials()
  return aiRequests.run('chat', () => chatWithLynx(settings, conversation))
})

app.get('/api/settings', async () => {
  const key = store.sshKey()
  return { sshPublicKey: key.public, sshKeyCreatedAt: key.createdAt, authRequired: !!PASSWORD }
})

app.post('/api/settings/ssh-key/regenerate', async () => {
  const key = store.regenerateSshKey()
  return { sshPublicKey: key.public, sshKeyCreatedAt: key.createdAt }
})

app.get('/api/self-update', async () => selfUpdateInfo())
app.post('/api/self-update', async () => startSelfUpdate())

app.get<{ Querystring: { host: string } }>('/api/ssh/user', async (req) => ({ username: store.sshUser(req.query.host) ?? null }))

app.get('/api/ssh', { websocket: true }, (socket) => {
  // Browsers cannot set headers on WebSockets, so the token travels in the first message.
  handleTerminalSocket(socket, tokenValid)
})

// --- static frontend ----------------------------------------------------------------

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')
if (existsSync(webDir)) {
  await app.register(fastifyStatic, { root: webDir, wildcard: false })
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found' })
    return reply.sendFile('index.html')
  })
}

await app.listen({ host: HOST, port: PORT })
if (ALLOWED_ORIGINS.size) app.log.info(`Hosted UIs allowed: ${[...ALLOWED_ORIGINS].join(', ')}`)
if (tls) app.log.info('Serving HTTPS')
if (!PASSWORD) app.log.warn('PROXMIU_PASSWORD is not set; the UI is open to anyone who can reach it.')
