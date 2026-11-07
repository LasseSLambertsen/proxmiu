import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import selfsigned from 'selfsigned'

const dir = mkdtempSync(join(tmpdir(), 'proxmiu-lxc-os-'))
process.env.PROXMIU_DATA_DIR = dir
const { store } = await import('../src/store.js')
const { templateSchema, allTemplates } = await import('../src/templates.js')
const { communityScriptTemplate } = await import('../src/template-sources.js')
const { startProvision, getJob, flushJobHistory } = await import('../src/provision.js')
const { forgetClient } = await import('../src/proxmox.js')
const oldOs = 'debian-12-standard_12.7-1_amd64.tar.zst'
const newOs = 'debian-13-standard_13.1-1_amd64.tar.zst'

test('Community Scripts imports keep the declared OS instead of inventing older fallbacks', async t => {
  const original = globalThis.fetch
  let resources: { os?: string; version?: string } = {}
  globalThis.fetch = async input => {
    assert.equal(String(input), 'https://community-scripts.org/api/script-detail?slug=isponsorblocktv')
    return new Response(JSON.stringify({ script: { slug: 'isponsorblocktv', name: 'iSponsorBlockTV', install_methods: [{ type: 'default', resources: { cpu: 1, ram: 1024, hdd: 4, ...resources } }] } }))
  }
  t.after(() => { globalThis.fetch = original })
  for (const item of [
    { resources: { os: 'Debian', version: '13' }, want: ['debian-13'] },
    { resources: { os: 'Ubuntu', version: '24.04' }, want: ['ubuntu-24.04'] },
    { resources: {}, want: [] },
  ]) {
    resources = item.resources
    assert.deepEqual((await communityScriptTemplate('isponsorblocktv')).os, item.want)
  }
})

test('legacy guessed Community OS defaults are not represented as declared requirements', () => {
  const legacy = templateSchema.parse({ id: 'legacy-unknown', name: 'Legacy unknown', os: ['debian-12', 'ubuntu-24.04'], resources: { cores: 1, memory: 512, disk: 4 }, source: { type: 'community-scripts', slug: 'isponsorblocktv' } })
  store.saveTemplate(legacy)
  assert.deepEqual(allTemplates().find(t => t.id === legacy.id).os, [])
  assert.deepEqual(store.listCustomTemplates().find(t => t.id === legacy.id).os, ['debian-12', 'ubuntu-24.04'], 'read-time normalization must preserve the saved record')
})

test('LXC OS resolution respects declared priority before using cached fallback images', { timeout: 20000 }, async t => {
  const cert = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { keyType: 'ec', algorithm: 'sha256' })
  let local: string[] = [], available: string[] = [], failDownload = false, failCatalogue = false
  const calls: { method: string; path: string; params: Record<string, string> }[] = []
  const api = https.createServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
    const reply = (data: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ data }))
    if (req.headers.authorization !== 'PVEAPIToken=proxmiu@pve!agent=fixture-token') return reply(null, 401)
    const url = new URL(req.url!, 'https://localhost')
    const path = url.pathname.slice('/api2/json'.length)
    let body = ''; for await (const chunk of req) body += chunk
    const params = Object.fromEntries(req.method === 'GET' ? url.searchParams : new URLSearchParams(body))
    calls.push({ method: req.method!, path, params })
    if (path === '/nodes/pve1/storage') return reply([{ storage: 'local' }])
    if (path === '/nodes/pve1/storage/local/content') return reply(local.map(name => ({ volid: `local:vztmpl/${name}` })))
    if (path === '/nodes/pve1/aplinfo' && req.method === 'GET') return failCatalogue ? reply(null, 503) : reply(available.map(template => ({ template, section: 'system' })))
    if (path === '/nodes/pve1/aplinfo' && req.method === 'POST') return reply('UPID:pve1:download:')
    if (path.includes('/tasks/') && path.endsWith('/log')) return reply([])
    if (path.includes('/tasks/') && path.endsWith('/status')) return reply({ status: 'stopped', exitstatus: failDownload ? 'synthetic download failure' : 'OK' })
    if (path === '/nodes/pve1/lxc' && req.method === 'POST') {
      // Stop at the first creation request; no container, installer, networking or SSH runs.
      return res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: { fixture: 'fixture stopped before creation' } }))
    }
    return reply(null, 404)
  })
  api.listen(0, '127.0.0.1'); await once(api, 'listening')
  const cluster = store.addCluster({ name: 'OS fixture', host: '127.0.0.1', port: (api.address() as { port: number }).port, authType: 'token', username: 'proxmiu@pve!agent', secret: 'fixture-token', verifyTls: false })
  t.after(async () => {
    await flushJobHistory(); forgetClient(cluster.id); api.closeAllConnections()
    await new Promise<void>(resolve => api.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })
  const cases = [
    { id: 'legacy-community', community: true, os: ['debian-13', 'debian-12', 'ubuntu-24.04'], local: [oldOs], available: [newOs, oldOs], want: newOs, download: true },
    { id: 'strict-community', community: true, os: ['debian-13'], local: [oldOs], available: [oldOs], want: undefined, download: false },
    { id: 'legacy-no-required-os', community: true, os: ['debian-13', 'debian-12', 'ubuntu-24.04'], local: [oldOs], available: [oldOs], want: undefined, download: false },
    { id: 'ordinary-priority', community: false, os: ['debian-13', 'debian-12'], local: [oldOs], available: [newOs], want: newOs, download: true },
    { id: 'reuse-required-os', community: true, os: ['debian-13'], local: [oldOs, newOs], available: [], want: newOs, download: false },
    { id: 'ordinary-fallback', community: false, os: ['debian-13', 'debian-12'], local: [oldOs], available: [], want: oldOs, download: false },
    { id: 'explicit-override', community: true, os: ['debian-13'], local: [], available: [], explicit: `local:vztmpl/${oldOs}`, want: oldOs, download: false },
    { id: 'unknown-community-os', community: true, os: [], local: [oldOs], available: [oldOs], want: undefined, download: false },
    { id: 'legacy-guessed-os', community: true, os: ['debian-12', 'ubuntu-24.04'], local: [oldOs], available: [oldOs], want: undefined, download: false },
    { id: 'offline-ordinary-fallback', community: false, os: ['debian-13', 'debian-12'], local: [oldOs], available: [], offline: true, want: oldOs, download: false },
    { id: 'offline-community', community: true, os: ['debian-13', 'debian-12'], local: [oldOs], available: [], offline: true, want: undefined, download: false },
    { id: 'download-failure', community: true, os: ['debian-13', 'debian-12'], local: [oldOs], available: [newOs], fail: true, want: undefined, download: true },
  ]
  for (const item of cases) await t.test(item.id, async () => {
    local = item.local; available = item.available; failDownload = item.fail ?? false; failCatalogue = item.offline ?? false; calls.length = 0
    store.saveTemplate(templateSchema.parse({ id: item.id, name: item.id, os: item.os, resources: { cores: 1, memory: 512, disk: 4 }, ...(item.community ? { source: { type: 'community-scripts', slug: 'isponsorblocktv' } } : {}) }))
    const job = startProvision({ clusterId: cluster.id, node: 'pve1', templateId: item.id, kind: 'lxc', hostname: 'fixture', vmid: 100, osTemplate: item.explicit, cores: 1, memory: 512, disk: 4, swap: 512, storage: 'local', bridge: 'vmbr0', ipMode: 'dhcp', onboot: true, options: {} })
    const deadline = Date.now() + 4000
    while (getJob(job.id)!.status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    const result = getJob(job.id)!
    assert.equal(result.status, 'error', 'fixture must stop without running real provisioning')
    const creates = calls.filter(c => c.method === 'POST' && c.path === '/nodes/pve1/lxc')
    assert.equal(creates.length, item.want ? 1 : 0, result.error)
    if (item.want) assert.equal(creates[0].params.ostemplate, `local:vztmpl/${item.want}`)
    const downloads = calls.filter(c => c.method === 'POST' && c.path === '/nodes/pve1/aplinfo')
    assert.equal(downloads.length, item.download ? 1 : 0)
    if (item.download) assert.equal(downloads[0].params.template, newOs)
    if (!item.want) assert.equal(result.steps.find(s => s.id === 'os')!.status, 'error')
    if (item.id === 'reuse-required-os' || item.explicit) assert.equal(calls.some(c => c.path === '/nodes/pve1/aplinfo'), false)
    assert.equal(calls.some(c => c.path.endsWith('/status/start')), false)
  })
})
