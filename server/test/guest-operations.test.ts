import assert from 'node:assert/strict'
import { test } from 'node:test'
import { operationSchema, loadOperations, loadNotes, saveNotes, runOperation, readTask } from '../src/guest-operations.js'

const guest = { node: 'pve1', type: 'lxc' as const, vmid: 100 }
function fixture() {
  let notes = 'Already written in Proxmox'
  let digest = 'a'.repeat(40)
  const calls: { method: string; path: string; params: unknown }[] = []
  const client = {
    async get<T>(path: string): Promise<T> {
      if (path.endsWith('/config')) return { description: notes, digest } as T
      if (path.endsWith('/status/current')) return { status: 'running', name: 'services' } as T
      if (path.endsWith('/snapshot')) return [{ name: 'current' }, { name: 'before-upgrade', snaptime: 123 }] as T
      if (path.endsWith('/storage')) return [{ storage: 'local', active: 1, content: 'iso,backup' }, { storage: 'off', active: 0, content: 'backup' }] as T
      if (path === '/nodes') return [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }, { node: 'pve3', status: 'offline' }] as T
      if (path.endsWith('/tasks/UPID%3Atest/status')) return { status: 'stopped', exitstatus: 'backup failed' } as T
      throw new Error('Unexpected GET ' + path)
    },
    async put<T>(path: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method: 'PUT', path, params })
      assert.equal(params.digest, digest)
      notes = params.delete === 'description' ? '' : String(params.description)
      digest = 'b'.repeat(40)
      return null as T
    },
    async post<T>(path: string, params?: Record<string, unknown>): Promise<T> { calls.push({ method: 'POST', path, params }); return 'UPID:test' as T },
    async del<T>(path: string): Promise<T> { calls.push({ method: 'DELETE', path, params: undefined }); return 'UPID:test' as T },
  }
  return { client, calls }
}

test('notes use Proxmox descriptions and clear with delete while retaining digest protection', async () => {
  const { client, calls } = fixture()
  assert.deepEqual(await loadNotes(client, guest), { notes: 'Already written in Proxmox', digest: 'a'.repeat(40) })
  const cleared = await saveNotes(client, guest, { notes: '', digest: 'a'.repeat(40) })
  assert.deepEqual(calls[0], { method: 'PUT', path: '/nodes/pve1/lxc/100/config', params: { delete: 'description', digest: 'a'.repeat(40) } })
  assert.equal(cleared.notes, '')
  await assert.rejects(saveNotes(client, guest, { notes: 'stale', digest: 'a'.repeat(40) }), /changed in Proxmox/)
  assert.equal(calls.length, 1)
})

test('operation schema rejects path injection, reserved snapshots, extra options and invalid targets', () => {
  for (const input of [{ action: 'snapshot', name: 'current' }, { action: 'snapshot', name: '../test' }, { action: 'snapshot', name: 'a'.repeat(41) }, { action: 'backup', storage: '../local' }, { action: 'migrate', target: 'pve/2' }, { action: 'rollback', name: 'safe' }, { action: 'backup', storage: 'local', remove: true }]) assert.equal(operationSchema.safeParse(input).success, false)
  assert.equal(operationSchema.safeParse({ action: 'snapshot', name: 'before-update' }).success, true)
})

test('notes changed between GET and PUT produce a conflict, while permission failures stay permission failures', async () => {
  const { client } = fixture()
  let changed = false
  const raced = { ...client, async get<T>(path: string): Promise<T> {
    if (changed && path.endsWith('/config')) return { description: 'Changed elsewhere', digest: 'b'.repeat(40) } as T
    return client.get<T>(path)
  }, async put<T>(): Promise<T> { changed = true; throw Object.assign(new Error('Proxmox update failed'), { statusCode: 502 }) } }
  await assert.rejects(saveNotes(raced, guest, { notes: 'My draft', digest: 'a'.repeat(40) }), error => (error as { statusCode?: number }).statusCode === 409)
  const denied = { ...client, async put<T>(): Promise<T> { throw Object.assign(new Error('Permission denied'), { statusCode: 403 }) } }
  await assert.rejects(saveNotes(denied, guest, { notes: 'My draft', digest: 'a'.repeat(40) }), error => (error as { statusCode?: number }).statusCode === 403)
})

test('HA-managed guests cannot submit migration wrappers that would falsely imply completed migration', async () => {
  const { client, calls } = fixture()
  for (const type of ['qemu', 'lxc'] as const) {
    const managed = { ...client, async get<T>(path: string): Promise<T> {
      if (path.endsWith('/status/current')) return { status: 'running', ha: { managed: 1 } } as T
      return client.get<T>(path)
    } }
    await assert.rejects(runOperation(managed, { ...guest, type }, { action: 'migrate', target: 'pve2' }), /Proxmox HA controls/)
  }
  assert.equal(calls.length, 0)
})

test('operation options exclude current, offline storage and current/offline migration nodes; denial is visible', async () => {
  const { client } = fixture()
  const options = await loadOperations(client, guest)
  assert.deepEqual(options, { snapshots: [{ name: 'before-upgrade', snaptime: 123 }], storages: ['local'], targets: ['pve2'], errors: [] })
  const denied = { ...client, async get<T>(path: string): Promise<T> { if (path.endsWith('/snapshot')) throw new Error('secret upstream body'); return client.get<T>(path) } }
  const partial = await loadOperations(denied, guest)
  assert.deepEqual(partial.storages, ['local'])
  assert.equal(partial.errors.length, 1)
  assert.doesNotMatch(partial.errors.join(), /secret/)
})

test('operations validate confirmation/storage/target and choose correct QEMU vs LXC migration mode', async () => {
  const { client, calls } = fixture()
  await assert.rejects(runOperation(client, guest, { action: 'migrate', target: 'pve1' }), /online node/)
  await assert.rejects(runOperation(client, guest, { action: 'backup', storage: 'off' }), /backup storage/)
  await assert.rejects(runOperation(client, guest, { action: 'rollback', name: 'before-upgrade', confirm: 'wrong' }), /confirmation/)
  await runOperation(client, guest, { action: 'migrate', target: 'pve2' })
  assert.deepEqual(calls.at(-1)?.params, { target: 'pve2', restart: true })
  await runOperation(client, { ...guest, type: 'qemu' }, { action: 'migrate', target: 'pve2' })
  assert.deepEqual(calls.at(-1)?.params, { target: 'pve2', online: true })
  await runOperation(client, guest, { action: 'backup', storage: 'local' })
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '/nodes/pve1/vzdump', params: { vmid: 100, storage: 'local', mode: 'snapshot', compress: 'zstd' } })
  await runOperation(client, guest, { action: 'rollback', name: 'before-upgrade', confirm: 'services' })
  assert.equal(calls.at(-1)?.path, '/nodes/pve1/lxc/100/snapshot/before-upgrade/rollback')
  assert.deepEqual(await readTask(client, 'pve1', 'UPID:test'), { status: 'stopped', exitstatus: 'backup failed' })
})
