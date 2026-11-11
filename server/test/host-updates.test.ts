import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHostUpdates, type UpdatersState } from '../src/host-updates.js'
import { HostUpdaterError, type HostInfo, type HostJob, type HostRequest } from '../src/host-updater-ssh.js'

function fixture() {
  let state: UpdatersState = { targets: {} }, online = true, lose = false, failSave = false
  let latest: HostJob | undefined, count = 0
  const info: HostInfo = { proxmoxVersion: '8.2.7', proxmoxMajor: 8, codename: 'bookworm', machineIdHash: 'a'.repeat(64), ready: true, rebootSuggested: false }
  const calls: HostRequest[] = []
  const deps = {
    load: () => structuredClone(state),
    save: (value: UpdatersState) => { if (failSave) throw new Error('private storage path'); state = structuredClone(value) },
    online: async () => { if (!online) throw new Error('private upstream error') },
    encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value, 'base64').toString(),
    invoke: async (_config: unknown, request: HostRequest) => {
      calls.push(request)
      if (request.action === 'inspect') return { ...info, ...(latest ? { latestJobId: latest.id } : {}) }
      if (request.action === 'status') { if (!latest) throw new Error(); return structuredClone(latest) }
      latest = { id: (++count).toString(16).padStart(32, '0'), state: 'running', phase: request.action, startedAt: new Date().toISOString(), log: ['Accepted.'] }
      if (lose) throw new HostUpdaterError('Contact lost.', true)
      return structuredClone(latest)
    },
  }
  const service = createHostUpdates(deps)
  return { service, deps, calls, state: () => state, setOnline: (value: boolean) => { online = value }, setLose: () => { lose = true }, failSave: () => { failSave = true },
    complete: () => {
      assert.ok(latest)
      latest.state = 'review'
      latest.plan = { id: latest.id, digest: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), proxmoxMajor: 8, codename: 'bookworm', kernelChange: false, packages: [{ name: 'docs', architecture: 'all', installed: '1', candidate: '2' }] }
      return latest.plan
    } }
}

async function enrolled(f: ReturnType<typeof fixture>, node = 'pve') {
  const setup = await f.service.setup('cluster', node)
  await f.service.configure('cluster', node, { host: '127.0.0.1', port: 22, fingerprint: 'SHA256:' + 'a'.repeat(43), revision: setup.revision })
}

test('updater setup is idempotent, dedicated and never exposes private material', async () => {
  const f = fixture()
  const first = await f.service.setup('cluster', 'pve')
  const second = await f.service.setup('cluster', 'pve')
  assert.equal(first.publicKey, second.publicKey)
  assert.match(first.publicKey, /^ssh-ed25519 /)
  assert.ok(!JSON.stringify(first).includes('PRIVATE KEY'))
  assert.ok(!JSON.stringify(f.state()).includes('PRIVATE KEY'))
  assert.ok(!JSON.stringify(f.service.list()).includes('privateKey'))
  assert.ok(first.setupCommand.includes('--public-key'))
  assert.ok(!first.setupCommand.includes('| bash'))
})

test('review binding and typed confirmation protect apply, while polling works offline', async () => {
  const f = fixture(); await enrolled(f)
  await f.service.check('cluster', 'pve')
  await assert.rejects(f.service.check('cluster', 'pve'), /active|unresolved/i)
  const plan = f.complete()
  f.setOnline(false)
  const result = await f.service.status('cluster', 'pve', plan.id)
  assert.equal(result.state, 'review')
  assert.equal((await f.service.info('cluster', 'pve')).info?.ready, true)
  await assert.rejects(f.service.apply('cluster', 'pve', { planId: plan.id, digest: plan.digest, confirmNode: 'wrong' }), /confirm|type/i)
  await assert.rejects(f.service.apply('cluster', 'pve', { planId: plan.id, digest: plan.digest, confirmNode: 'pve' }), /online|connection/i)
  f.setOnline(true)
  await f.service.apply('cluster', 'pve', { planId: plan.id, digest: plan.digest, confirmNode: 'pve' })
  assert.deepEqual(f.calls.at(-1), { action: 'apply', planId: plan.id, digest: plan.digest })
  await assert.rejects(f.service.forget('cluster', 'pve', { confirmNode: 'pve' }), /unresolved|active/i)
  assert.throws(() => f.service.assertConnectionMutable('cluster'), /unresolved|active/i)
})

test('lost admission reply survives agent restart and recovers without mutation retry', async () => {
  const f = fixture(); await enrolled(f); f.setLose()
  await assert.rejects(f.service.check('cluster', 'pve'), /Contact|contact/i)
  const restarted = createHostUpdates(f.deps)
  await assert.rejects(restarted.check('cluster', 'pve'), /unresolved|active/i)
  await assert.rejects(restarted.forget('cluster', 'pve', { confirmNode: 'pve' }), /unresolved|active/i)
  f.complete(); f.setOnline(false)
  const recovered = await restarted.info('cluster', 'pve')
  assert.equal(recovered.job?.state, 'review')
  assert.equal(f.calls.filter(c => c.action === 'check').length, 1)
  assert.equal(f.state().reservation, undefined)
})

test('persistence failure never contacts mutation RPC and configuration changes invalidate review', async () => {
  const f = fixture(); await enrolled(f)
  f.failSave()
  await assert.rejects(f.service.check('cluster', 'pve'), /save|storage/i)
  assert.equal(f.calls.filter(c => c.action === 'check').length, 0)
  const g = fixture(); await enrolled(g)
  const pending = await g.service.setup('cluster', 'pve')
  await assert.rejects(g.service.configure('cluster', 'pve', { host: 'pve', port: 22, fingerprint: 'SHA256:' + 'a'.repeat(43), revision: 'wrong' }), /changed|reload/i)
  await g.service.check('cluster', 'pve'); const plan = g.complete(); await g.service.status('cluster', 'pve', plan.id)
  await g.service.configure('cluster', 'pve', { host: 'pve', port: 22, fingerprint: 'SHA256:' + 'a'.repeat(43), revision: pending.revision })
  await assert.rejects(g.service.apply('cluster', 'pve', { planId: plan.id, digest: plan.digest, confirmNode: 'pve' }), /review|changed|plan/i)
})

test('a verified host refusal releases reservation while an ambiguous result does not', async () => {
  const f = fixture(); await enrolled(f)
  const original = f.deps.invoke
  f.deps.invoke = async (config, request) => {
    if (request.action === 'check') throw new HostUpdaterError('Host refused admission.', true, true)
    return original(config, request)
  }
  await assert.rejects(f.service.check('cluster', 'pve'), /refused/i)
  assert.equal(f.state().reservation, undefined)
})

test('polling a previous review cannot release an unresolved new installation', async () => {
  const f = fixture(); await enrolled(f)
  await f.service.check('cluster', 'pve'); const plan = f.complete()
  const review = await f.service.status('cluster', 'pve', plan.id)
  f.setLose()
  await assert.rejects(f.service.apply('cluster', 'pve', { planId: plan.id, digest: plan.digest, confirmNode: 'pve' }))
  const original = f.deps.invoke
  f.deps.invoke = async (config, request) => request.action === 'status' && request.jobId === review.id ? review : original(config, request)
  await f.service.status('cluster', 'pve', review.id)
  assert.ok(f.state().reservation?.unknown, 'old terminal job must not release unknown new admission')
  await assert.rejects(f.service.forget('cluster', 'pve', { confirmNode: 'pve' }), /unresolved|active/i)
})
