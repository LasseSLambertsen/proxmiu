import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import selfsigned from 'selfsigned'

test('LXC creation with a limited Proxmox token sends only the requested nesting feature', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'proxmiu-lxc-features-'))
  process.env.PROXMIU_DATA_DIR = dir
  const { store } = await import('../src/store.js')
  const { templateSchema } = await import('../src/templates.js')
  const { startProvision, getJob, flushJobHistory } = await import('../src/provision.js')
  const { forgetClient } = await import('../src/proxmox.js')
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keyType: 'ec', algorithm: 'sha256' })
  const creates: Record<string, string>[] = []
  let starts = 0
  const api = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    const reply = (data: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ data }))
    if (req.headers.authorization !== 'PVEAPIToken=proxmiu@pve!agent=fixture-token') return reply(null, 401)
    const path = new URL(req.url!, 'https://localhost').pathname
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.method === 'POST' && path === '/api2/json/nodes/pve1/lxc') {
      const params = Object.fromEntries(new URLSearchParams(body))
      creates.push(params)
      // Proxmox permits a non-root caller to set only nesting on an unprivileged container.
      if (params.features?.split(',').some(flag => flag.split('=')[0] !== 'nesting')) {
        return res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: { features: 'changing feature flags (except nesting) is only allowed for root@pam' } }))
      }
      return reply('UPID:pve1:00000001:00000000:00000001:vzcreate:100:proxmiu@pve:')
    }
    if (req.method === 'GET' && path.includes('/tasks/')) {
      if (path.endsWith('/log')) return reply([])
      if (path.endsWith('/status')) return reply({ status: 'stopped', exitstatus: 'OK' })
    }
    if (req.method === 'POST' && path === '/api2/json/nodes/pve1/lxc/100/status/start') {
      starts++
      // End the synthetic run before guest networking, script downloads or SSH.
      return res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: { fixture: 'fixture stopped before guest start' } }))
    }
    return reply(null, 404)
  })
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  const cluster = store.addCluster({ name: 'Local fixture', host: '127.0.0.1', port: (api.address() as { port: number }).port, authType: 'token', username: 'proxmiu@pve!agent', secret: 'fixture-token', verifyTls: false })
  t.after(async () => {
    await flushJobHistory()
    forgetClient(cluster.id)
    api.closeAllConnections()
    await new Promise<void>(resolve => api.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })
  for (const item of [
    { id: 'community-nesting', community: true, nesting: true, want: 'nesting=1' },
    { id: 'community-no-nesting', community: true, nesting: false, want: undefined },
    { id: 'inline-nesting', community: false, nesting: true, want: 'nesting=1' },
    { id: 'inline-no-nesting', community: false, nesting: false, want: undefined },
  ]) {
    await t.test(item.id, async () => {
      const template = templateSchema.parse({ id: item.id, name: item.id, nesting: item.nesting, privileged: false, resources: { cores: 1, memory: 512, disk: 4 }, ...(item.community ? { source: { type: 'community-scripts', slug: 'isponsorblocktv' } } : {}) })
      store.saveTemplate(template)
      const oldCreates = creates.length, oldStarts = starts
      const job = startProvision({ clusterId: cluster.id, node: 'pve1', templateId: template.id, kind: 'lxc', hostname: 'fixture', vmid: 100, osTemplate: 'local:vztmpl/debian-12-standard.tar.zst', cores: 1, memory: 512, disk: 4, swap: 512, storage: 'local', bridge: 'vmbr0', ipMode: 'dhcp', onboot: true, options: {} })
      const deadline = Date.now() + 4000
      while (getJob(job.id)!.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
      const result = getJob(job.id)!
      assert.equal(result.steps.find(step => step.id === 'create')?.status, 'done', result.error)
      assert.equal(creates.length, oldCreates + 1, 'creation is submitted once, without privileged retries')
      assert.equal(creates.at(-1)!.features, item.want)
      assert.equal(creates.at(-1)!.unprivileged, '1')
      assert.equal(starts, oldStarts + 1)
      assert.equal(result.status, 'error')
      assert.match(result.error!, /fixture stopped before guest start/)
    })
  }
})
