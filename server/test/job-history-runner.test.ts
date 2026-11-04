import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

process.env.PROXMIU_DATA_DIR = mkdtempSync(join(tmpdir(), 'proxmiu-runner-journal-'))
const { store, DATA_DIR, decrypt } = await import('../src/store.js')
const { templateSchema } = await import('../src/templates.js')
const { ProxmoxClient } = await import('../src/proxmox.js')
const { startProvision, startUpdate, getJob } = await import('../src/provision.js')
const template = templateSchema.parse({ id: 'redaction-fixture', name: 'Fixture', user: 'root', resources: { cores: 1, memory: 512, disk: 4 }, options: [{ key: 'TOKEN', label: 'Token', type: 'secret', default: 'zz\ndefault-fragment' }] })
store.saveTemplate(template)
const cluster = store.addCluster({ name: 'Fixture only', host: '127.0.0.1', port: 9, authType: 'token', username: 'fixture', secret: 'fixture-credential', verifyTls: false })
async function finished(id: string) {
  for (let i = 0; i < 100; i++) {
    const job = getJob(id)!
    if (job.status !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Fixture run did not finish')
}

test('provision runner saves initial registration before external calls and redacts actual failure snapshots', async () => {
  const original = ProxmoxClient.prototype.request
  let nextId = false
  ProxmoxClient.prototype.request = async function<T>(_method: string, path: string): Promise<T> {
    const saved = JSON.parse(decrypt(readFileSync(join(DATA_DIR, 'jobs.json'), 'utf8')))
    assert.equal(saved.jobs[0].status, 'running')
    assert.equal(saved.jobs[0].steps[0].status, path === '/cluster/nextid' ? 'running' : 'done')
    if (path === '/cluster/nextid') { nextId = true; return '421' as T }
    throw new Error('Synthetic xy zz default-fragment long-option-token')
  }
  try {
    const job = startProvision({ clusterId: cluster.id, node: 'pve1', templateId: template.id, kind: 'lxc', hostname: 'fixture', cores: 1, memory: 512, disk: 4, swap: 512, storage: 'local', bridge: 'vmbr0', ipMode: 'dhcp', password: 'xy', onboot: true, options: { TOKEN: 'xy', OTHER: 'long-option-token' } })
    const terminal = await finished(job.id)
    assert.equal(nextId, true)
    assert.equal(terminal.status, 'error')
    assert.equal(terminal.target?.vmid, 421)
    for (const value of ['xy', 'zz', 'default-fragment', 'long-option-token']) {
      assert.ok(!JSON.stringify(terminal).includes(value), `API job snapshot must redact ${value}`)
      assert.ok(!decrypt(readFileSync(join(DATA_DIR, 'jobs.json'), 'utf8')).includes(value), `Saved snapshot must redact ${value}`)
    }
    assert.match(terminal.error!, /Synthetic/)
  } finally { ProxmoxClient.prototype.request = original }
})

test('update runner registers before execution and redacts short/multiline template defaults on failure', async () => {
  const original = ProxmoxClient.prototype.request
  // guestIp intentionally catches read errors, so make its final diagnostic include a secret default.
  const second = templateSchema.parse({ ...template, id: 'redaction-update', options: [{ key: 'TOKEN', label: 'Token', type: 'secret', default: 'guest IP\nzz' }] })
  store.saveTemplate(second)
  ProxmoxClient.prototype.request = async function<T>(_method: string, path: string): Promise<T> {
    if (path === '/cluster/resources') return [{ vmid: 123, node: 'pve1', type: 'lxc', name: 'fixture', status: 'running', tags: 'proxmiu;redaction-update' }] as T
    const saved = JSON.parse(decrypt(readFileSync(join(DATA_DIR, 'jobs.json'), 'utf8')))
    assert.ok(saved.jobs.some((job: { kind: string; status: string }) => job.kind === 'update' && job.status === 'running'))
    throw new Error('fixture address unavailable')
  }
  try {
    const job = await startUpdate({ clusterId: cluster.id, node: 'pve1', type: 'lxc', vmid: 123 })
    const terminal = await finished(job.id)
    assert.equal(terminal.status, 'error')
    assert.ok(!terminal.error?.includes('guest IP'))
    assert.ok(!JSON.stringify(terminal.log).includes('guest IP'))
    assert.equal(terminal.target?.vmid, 123)
    assert.ok(!decrypt(readFileSync(join(DATA_DIR, 'jobs.json'), 'utf8')).includes('guest IP'))
  } finally { ProxmoxClient.prototype.request = original }
})
